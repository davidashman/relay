import { signal, computed, effect } from 'alien-signals';
import type { BaseTransport } from '../transport/BaseTransport';
import type { PermissionRequest } from './PermissionRequest';
import type { ModelOption } from '../../../shared/messages';
import type { SessionSummary } from './types';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { processAndAttachMessage, findToolUseBlock /*, mergeConsecutiveReadMessages */ } from '../utils/messageUtils';
import { parseMessageContent } from '../models/contentParsers';
import { normalizeModelId } from '../utils/modelUtils';
import { Message as MessageModel } from '../models/Message';
import type { Message } from '../models/Message';
import { ContentBlockWrapper } from '../models/ContentBlockWrapper';
import type { CompactionBlock } from '../models/ContentBlock';
import type { QueuedMessage } from '../types/queue';

export interface SelectionRange {
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  selectedText?: string;
}

export interface UsageData {
  inputTokens: number;   // cumulative session total (all turns × full context re-send)
  outputTokens: number;  // cumulative session total
  contextTokens: number; // latest turn's input only — used for context window meter
  totalCost: number;
  contextWindow: number;
}

export interface AttachmentPayload {
  fileName: string;
  mediaType: string;
  data: string;
  fileSize?: number;
}

const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

export interface SessionOptions {
  isExplicit?: boolean;
  existingWorktree?: { name: string; path: string };
  resumeId?: string;
}

export interface SessionContext {
  currentSelection: ReturnType<typeof signal<SelectionRange | undefined>>;
  commandRegistry: { registerAction: (...args: any[]) => void };
  fileOpener: {
    open: (filePath: string, location?: any) => Promise<void> | void;
    openContent: (
      content: string,
      fileName: string,
      editable: boolean
    ) => Promise<string | undefined>;
  };
  showNotification?: (
    message: string,
    severity: 'info' | 'warning' | 'error',
    buttons?: string[],
    onlyIfNotVisible?: boolean
  ) => Promise<string | undefined>;
  startNewConversationTab?: (initialPrompt?: string) => boolean;
  renameTab?: (title: string) => boolean;
  updatePanelSession?: (sessionId: string | null) => void;
  openURL?: (url: string) => void;
}

export class Session {
  private readonly claudeChannelId = signal<string | undefined>(undefined);
  private currentConnectionPromise?: Promise<BaseTransport>;
  private lastSentSelection?: SelectionRange;
  private effectCleanup?: () => void;

  // Context-compaction interception state. When the SDK streams a compacting
  // window, we buffer the summary assistant output here and surface it as a
  // single collapsible "compaction" message once `compact_boundary` arrives.
  //
  // compactionStartMessages: snapshot of messages[] taken at the moment
  // compaction begins (either via status(compacting) or the first isReplay
  // user message).  When compact_boundary arrives we restore from this
  // snapshot so that any assistant turns the model emitted while generating
  // the summary are stripped out and replaced by the single CompactionBlock.
  private compactingMode = false;
  private compactionBuffer: string[] = [];
  private compactionStartMessages: Message[] | undefined;
  // Holds the ContentBlockWrapper for the most-recently-created CompactionBlock
  // so the isSynthetic user message that follows can be attached to it.
  private pendingCompactionWrapper: ContentBlockWrapper | undefined;

  readonly connection = signal<BaseTransport | undefined>(undefined);

  // Counter of user turns that have been sent but not yet completed (init → result).
  // Exposed directly so callers that care can read it; `busy` (below) is the derived
  // boolean that most of the app uses.
  readonly outstandingTurns = signal(0);
  // Derived boolean view of `outstandingTurns` — true whenever any turn is in flight.
  // Kept as a computed signal so existing call-sites that subscribe to `session.busy`
  // (useSession, useRuntime, etc.) keep working unchanged.
  readonly busy = computed(() => this.outstandingTurns() > 0);
  readonly isLoading = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly sessionId = signal<string | undefined>(undefined);
  readonly isExplicit = signal(false);
  readonly lastModifiedTime = signal<number>(Date.now());
  readonly messages = signal<Message[]>([]);
  readonly messageCount = signal<number>(0);
  readonly cwd = signal<string | undefined>(undefined);
  readonly permissionMode = signal<PermissionMode>('default');
  private prePlanMode: PermissionMode | null = null;
  readonly summary = signal<string | undefined>(undefined);
  readonly modelSelection = signal<string | undefined>(undefined);
  readonly thinkingLevel = signal<string>('default_on');
  readonly effortLevel = signal<string | undefined>(undefined);
  readonly todos = signal<any[]>([]);
  readonly worktree = signal<{ name: string; path: string } | undefined>(undefined);
  readonly selection = signal<SelectionRange | undefined>(undefined);
  readonly usageData = signal<UsageData>({
    inputTokens: 0,
    outputTokens: 0,
    contextTokens: 0,
    totalCost: 0,
    contextWindow: 200000
  });

  // Local outbound queue: when the user submits while a turn is already in
  // flight we buffer the new message here instead of pushing it into the SDK
  // input stream. This keeps entries cancellable/editable up until the prior
  // turn's `result` arrives, at which point the next queued entry is drained
  // into the SDK.
  readonly outboundQueue = signal<QueuedMessage[]>([]);

  readonly claudeConfig = computed(() => {
    const conn = this.connection();
    return conn?.claudeConfig?.();
  });

  readonly config = computed(() => {
    const conn = this.connection();
    return conn?.config?.();
  });

  readonly permissionRequests = computed<PermissionRequest[]>(() => {
    const conn = this.connection();
    const channelId = this.claudeChannelId();
    if (!conn || !channelId) {
      return [];
    }

    return conn
      .permissionRequests()
      .filter((request) => request.channelId === channelId);
  });

  isOffline(): boolean {
    return (
      !this.connection() &&
      !!this.sessionId() &&
      this.messages().length === 0 &&
      !this.currentConnectionPromise
    );
  }

  /** Mark a new user turn as in-flight. */
  private incrementOutstandingTurns(): void {
    this.outstandingTurns(this.outstandingTurns() + 1);
  }

  /** Mark a turn as finished. Floors at 0 and warns on underflow. */
  private decrementOutstandingTurns(): void {
    const current = this.outstandingTurns();
    if (current <= 0) {
      console.warn('[Session] outstandingTurns underflow prevented (already 0)');
      this.outstandingTurns(0);
      return;
    }
    this.outstandingTurns(current - 1);
  }

  /** Reset the counter (used by restartClaude and terminal error paths). */
  private resetOutstandingTurns(): void {
    this.outstandingTurns(0);
  }


  constructor(
    private readonly connectionProvider: () => Promise<BaseTransport>,
    private readonly context: SessionContext,
    options: SessionOptions = {}
  ) {
    this.isExplicit(options.isExplicit ?? true);

    effect(() => {
      this.selection(this.context.currentSelection());
    });

    // Initialize modelSelection from config when it becomes available
    effect(() => {
      const configModel = this.config()?.modelSetting;
      const currentModel = this.modelSelection();
      console.log('[Session] Config model:', configModel, 'Current model:', currentModel);
      if (configModel && !currentModel) {
        const normalizedModel = normalizeModelId(configModel);
        console.log('[Session] Setting modelSelection to:', normalizedModel, '(normalized from:', configModel, ')');
        this.modelSelection(normalizedModel);
      }
    });

    // Initialize effortLevel from config when it becomes available
    effect(() => {
      const configEffort = (this.config() as any)?.effortLevel;
      const currentEffort = this.effortLevel();
      if (configEffort && !currentEffort) {
        this.effortLevel(configEffort);
      }
    });

    // Initialize permissionMode from config when it becomes available (one-shot)
    let modeInitialized = false;
    effect(() => {
      const configMode = this.config()?.permissionMode;
      if (configMode && !modeInitialized) {
        modeInitialized = true;
        console.log('[Session] Setting permissionMode from config to:', configMode);
        this.permissionMode(configMode as PermissionMode);
      }
    });
  }

  static fromServer(
    summary: SessionSummary,
    connectionProvider: () => Promise<BaseTransport>,
    context: SessionContext
  ): Session {
    const session = new Session(connectionProvider, context, { isExplicit: true });
    session.sessionId(summary.id);
    session.lastModifiedTime(summary.lastModified);
    session.summary(summary.summary);
    session.worktree(summary.worktree);
    session.messageCount(summary.messageCount ?? 0);
    return session;
  }

  async getConnection(): Promise<BaseTransport> {
    const current = this.connection();
    if (current) {
      return current;
    }
    if (this.currentConnectionPromise) {
      return this.currentConnectionPromise;
    }

    this.currentConnectionPromise = this.connectionProvider().then((conn) => {
      this.connection(conn);
      return conn;
    });

    return this.currentConnectionPromise;
  }

  async preloadConnection(): Promise<void> {
    await this.getConnection();
    await this.launchClaude();
  }

  async loadFromServer(): Promise<void> {
    const sessionId = this.sessionId();
    if (!sessionId) return;

    this.isLoading(true);
    try {
      const connection = await this.getConnection();
      const response = await connection.getSession(sessionId);
      const accumulator: Message[] = [];
      for (const raw of response?.messages ?? []) {
        // Subagent (sidechain) messages: hoist their tool_use/tool_result
        // blocks onto the parent Task wrapper's childTools instead of
        // rendering as top-level messages. Mirrors the live-stream path.
        if (
          (raw?.type === 'user' || raw?.type === 'assistant') &&
          raw.parent_tool_use_id != null
        ) {
          this.attachSubagentMessage(raw, accumulator);
          continue;
        }

        this.processMessage(raw);
        // processAndAttachMessage tool_result
        // tool_result tool_use
        processAndAttachMessage(accumulator, raw);
      }
      // ReadCoalesced
      // this.messages(mergeConsecutiveReadMessages(accumulator));
      this.messages(accumulator);
      await this.launchClaude();
    } finally {
      this.isLoading(false);
    }
  }

  async send(
    input: string,
    attachments: AttachmentPayload[] = [],
    includeSelection = false
  ): Promise<void> {
    // Ensure a channel is up so `busy` reflects real SDK state (the first
    // send may create the channel before there's a turn in flight).
    await this.launchClaude();

    // If a turn is already in flight OR entries are already queued ahead of
    // us, buffer locally. The queued entry stays cancellable/editable until
    // it drains into the SDK on the next `result`.
    if (this.outstandingTurns() > 0 || this.outboundQueue().length > 0) {
      const entry: QueuedMessage = {
        id: Math.random().toString(36).slice(2),
        content: input,
        timestamp: Date.now(),
        attachments: attachments.length ? attachments : undefined,
        includeSelection,
      };
      this.outboundQueue([...this.outboundQueue(), entry]);
      this.lastModifiedTime(Date.now());
      return;
    }

    await this.submitToSdk(input, attachments, includeSelection);
  }

  /** Push a user message directly into the SDK input stream. */
  private async submitToSdk(
    input: string,
    attachments: AttachmentPayload[] = [],
    includeSelection = false
  ): Promise<void> {
    const connection = await this.getConnection();
    const isSlash = this.isSlashCommand(input);

    await this.launchClaude();

    const shouldIncludeSelection = includeSelection && !isSlash;
    let selectionPayload: SelectionRange | undefined;

    if (shouldIncludeSelection && !this.isSameSelection(this.lastSentSelection, this.selection())) {
      selectionPayload = this.selection();
      this.lastSentSelection = selectionPayload;
    }

    const userMessage = this.buildUserMessage(input, attachments, selectionPayload);
    const messageModel = MessageModel.fromRaw(userMessage);

    if (messageModel) {
      this.messages([...this.messages(), messageModel]);
    }

    if (!this.summary()) {
      this.summary(input);
    }
    this.isExplicit(false);
    this.lastModifiedTime(Date.now());
    this.incrementOutstandingTurns();

    try {
      const channelId = this.claudeChannelId();
      if (!channelId) throw new Error('No active channel');
      connection.sendInput(channelId, userMessage, false);
    } catch (error) {
      this.decrementOutstandingTurns();
      throw error;
    }
  }

  /** Remove a queued message by id (before it reaches the SDK). */
  removeFromQueue(id: string): void {
    const next = this.outboundQueue().filter((m) => m.id !== id);
    if (next.length !== this.outboundQueue().length) {
      this.outboundQueue(next);
    }
  }

  /**
   * Move a queued message to the front of the queue so it drains next. If
   * no turn is in flight, drain it immediately.
   */
  sendQueuedNow(id: string): void {
    const queue = this.outboundQueue();
    const idx = queue.findIndex((m) => m.id === id);
    if (idx <= 0) {
      // Already at front or not present — if it's the single front entry
      // and the SDK is idle, drain now.
      if (this.outstandingTurns() === 0 && queue.length > 0) {
        void this.drainOutboundQueue();
      }
      return;
    }
    const entry = queue[idx];
    const reordered = [entry, ...queue.slice(0, idx), ...queue.slice(idx + 1)];
    this.outboundQueue(reordered);
    if (this.outstandingTurns() === 0) {
      void this.drainOutboundQueue();
    }
  }

  /** Pop the oldest queued message and push it into the SDK. */
  private async drainOutboundQueue(): Promise<void> {
    const queue = this.outboundQueue();
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    this.outboundQueue(rest);
    try {
      await this.submitToSdk(
        next.content,
        next.attachments ?? [],
        next.includeSelection ?? false
      );
    } catch (err) {
      console.error('[Session] Failed to drain queued message', err);
    }
  }

  async launchClaude(): Promise<string> {
    const existingChannel = this.claudeChannelId();
    if (existingChannel) {
      return existingChannel;
    }

    this.error(undefined);
    const channelId = Math.random().toString(36).slice(2);
    this.claudeChannelId(channelId);

    const connection = await this.getConnection();

    if (!this.cwd()) {
      this.cwd(connection.config()?.defaultCwd);
    }

    if (!this.modelSelection()) {
      const configModel = connection.config()?.modelSetting;
      // Normalize model aliases to full model IDs
      const normalizedModel = normalizeModelId(configModel);
      console.log('[Session.launchClaude] Setting modelSelection from config:', configModel, '-> normalized:', normalizedModel);
      this.modelSelection(normalizedModel);
    } else {
      console.log('[Session.launchClaude] modelSelection already set:', this.modelSelection());
    }

    if (!this.thinkingLevel()) {
      this.thinkingLevel(connection.config()?.thinkingLevel || 'default_on');
    }

    if (!this.effortLevel()) {
      this.effortLevel((connection.config() as any)?.effortLevel || 'high');
    }

    const stream = connection.launchClaude(
      channelId,
      this.sessionId() ?? undefined,
      this.cwd() ?? undefined,
      this.modelSelection() ?? undefined,
      this.permissionMode(),
      this.thinkingLevel(),
      this.effortLevel()
    );

    void this.readMessages(stream);
    return channelId;
  }

  async interrupt(): Promise<void> {
    const channelId = this.claudeChannelId();
    if (!channelId) {
      return;
    }
    const connection = await this.getConnection();
    connection.interruptClaude(channelId);
    // The SDK may not emit a `result` for interrupted turns. Clear the
    // counter and drop any queued work now so the UI recovers immediately
    // rather than waiting on the stream to tear down.
    this.resetOutstandingTurns();
    this.outboundQueue([]);
  }

  async restartClaude(): Promise<void> {
    await this.interrupt();
    this.claudeChannelId(undefined);
    // Channel is gone — any turns that were in flight will never produce a
    // `result`, so clear the counter.
    this.resetOutstandingTurns();
    await this.launchClaude();
  }

  async listFiles(pattern?: string, signal?: AbortSignal): Promise<any> {
    const connection = await this.getConnection();
    return connection.listFiles(pattern, signal);
  }

  async setPermissionMode(mode: PermissionMode, applyToConnection = true): Promise<boolean> {
    const previous = this.permissionMode();
    // Remember the mode in effect before entering plan mode, so we can
    // restore it when the user approves ExitPlanMode.
    if (mode === 'plan' && previous !== 'plan') {
      this.prePlanMode = previous;
    } else if (mode !== 'plan') {
      this.prePlanMode = null;
    }
    this.permissionMode(mode);

    const channelId = this.claudeChannelId();
    if (!channelId || !applyToConnection) {
      return true;
    }
    const connection = await this.getConnection();
    const success = await connection.setPermissionMode(channelId, mode);
    if (!success) {
      this.permissionMode(previous);
    }
    return success;
  }

  /**
   * Called after the user approves an ExitPlanMode tool call. Restores the
   * permission mode that was active before entering plan mode. Falls back to
   * 'default' if no pre-plan mode was recorded (e.g. on a session loaded mid-plan).
   */
  async exitPlanMode(): Promise<void> {
    const restore = this.prePlanMode ?? 'default';
    this.prePlanMode = null;
    if (this.permissionMode() === restore) return;
    await this.setPermissionMode(restore);
  }

  async setModel(model: ModelOption): Promise<boolean> {
    const previous = this.modelSelection();
    this.modelSelection(model.value);

    const channelId = this.claudeChannelId();
    if (!channelId) {
      return true;
    }

    const connection = await this.getConnection();
    const response = await connection.setModel(channelId, model);

    if (!response?.success) {
      this.modelSelection(previous);
      return false;
    }

    return true;
  }

  async setThinkingLevel(level: string): Promise<void> {
    this.thinkingLevel(level);

    const channelId = this.claudeChannelId();
    if (!channelId) {
      return;
    }

    const connection = await this.getConnection();
    await connection.setThinkingLevel(channelId, level);
  }

  async setEffortLevel(level: string): Promise<void> {
    this.effortLevel(level);

    const channelId = this.claudeChannelId();
    if (!channelId) {
      return;
    }

    const connection = await this.getConnection();
    await connection.setEffortLevel(channelId, level);
  }

  async getMcpServers(): Promise<any> {
    const connection = await this.getConnection();
    const channelId = await this.launchClaude();
    return connection.getMcpServers(channelId);
  }

  async openConfigFile(configType: string): Promise<void> {
    const connection = await this.getConnection();
    await connection.openConfigFile(configType);
  }

  onPermissionRequested(callback: (request: PermissionRequest) => void): () => void {
    const connection = this.connection();
    if (!connection) {
      return () => {};
    }

    return connection.permissionRequested.add((request) => {
      // channelId
      if (request.channelId === this.claudeChannelId()) {
        callback(request);
      }
    });
  }

  dispose(): void {
    if (this.effectCleanup) {
      this.effectCleanup();
    }
  }

  private async readMessages(stream: AsyncIterable<any>): Promise<void> {
    try {
      for await (const event of stream) {
        this.processIncomingMessage(event);
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    } finally {
      // Stream ended (cleanly or via error): any turns that never produced
      // a `result` are orphaned. Reset unconditionally so the UI recovers.
      this.resetOutstandingTurns();
      // Don't drop the outbound queue here — if the stream ended because the
      // SDK naturally closed between turns, we still want the next queued
      // entry to drain when the channel comes back up. `interrupt()` is the
      // explicit path that clears the queue.
      this.claudeChannelId(undefined);
    }
  }

  private processIncomingMessage(event: any): void {
    // Settle counter FIRST, before heavier processing that might throw.
    // If we crash rendering a `result`, we still want the spinner to stop
    // and the queue to drain.
    if (event?.type === 'result') {
      this.decrementOutstandingTurns();
      if (this.outstandingTurns() === 0 && this.outboundQueue().length > 0) {
        void this.drainOutboundQueue();
      }
    }

    // LLM SDK stderr
    // - busy=true→ tip LLMErrorBlock
    // - busy=false Profile → VSCode Notification
    if (event?.type === '__llm_request_error__') {
      if (this.busy()) {
        // LLM raw fromRaw → contentParsers
        // Interrupt user → llm_error content block → tip
        const syntheticEvent = {
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'llm_error', message: event.error }],
          },
        };
        const currentMessages = [...this.messages()] as Message[];
        processAndAttachMessage(currentMessages, syntheticEvent);
        this.messages(currentMessages);
        // Terminal error for this turn — decrement the in-flight counter.
        this.decrementOutstandingTurns();
        if (this.outstandingTurns() === 0 && this.outboundQueue().length > 0) {
          void this.drainOutboundQueue();
        }
      } else {
        // Profile channel VSCode Notification
        this.context.showNotification?.(event.error, 'error');
      }
      return;
    }

    // Messages originating from a Task subagent share the SDK stream but
    // should not be rendered as top-level chat messages. Instead, hoist
    // their tool_use blocks into the parent Task wrapper's childTools so
    // the Task UI can display them as an inline group, and attach any
    // tool_result blocks to the matching child tool_use.
    if (
      (event?.type === 'user' || event?.type === 'assistant') &&
      event.parent_tool_use_id != null
    ) {
      this.attachSubagentMessage(event, this.messages() as Message[]);
      return;
    }

    // Context-compaction interception.
    //
    // The CLI never emits system/status(compacting). Instead the SDK yields the
    // model-generated summary as a user message with isReplay:true, followed by
    // system/compact_boundary.  We intercept those replay messages to populate
    // the compactionBuffer and suppress them from the regular message list,
    // then fold everything into a single collapsible "compaction" Message.
    //
    // The legacy status(compacting) path is kept as a no-op safety net in case
    // a future CLI version starts emitting it.
    if (event?.type === 'system' && event?.subtype === 'status') {
      if (event.status === 'compacting') {
        this.compactingMode = true;
        this.compactionBuffer = [];
        this.compactionStartMessages = [...this.messages()] as Message[];
      } else if (this.compactingMode) {
        // Status cleared without boundary (e.g. interrupted): drop buffer.
        this.compactingMode = false;
        this.compactionBuffer = [];
        this.compactionStartMessages = undefined;
      }
      return;
    }

    // Compact summary messages arrive as user events with isReplay:true.
    // Buffer their text content; do NOT render them as regular messages.
    // On the first replay event we also snapshot the current message list so
    // that compact_boundary can restore it, stripping any assistant turns the
    // model emitted while generating the summary.
    if (event?.type === 'user' && (event as any).isReplay === true) {
      if (!this.compactingMode) {
        this.compactingMode = true;
        this.compactionStartMessages = [...this.messages()] as Message[];
      }
      if (Array.isArray(event.message?.content)) {
        for (const part of event.message.content) {
          if (part?.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
            this.compactionBuffer.push(part.text);
          }
        }
      }
      return;
    }

    if (event?.type === 'system' && event?.subtype === 'compact_boundary') {
      const summary = this.compactionBuffer.join('\n\n').trim();
      this.compactingMode = false;
      this.compactionBuffer = [];
      // Restore to the pre-compaction snapshot so that any assistant turns
      // the model emitted while generating the summary are discarded.
      const baseMessages = this.compactionStartMessages ?? [...this.messages()];
      this.compactionStartMessages = undefined;
      const block = new ContentBlockWrapper({
        type: 'compaction',
        summary,
        preTokens: event.compact_metadata?.pre_tokens,
        trigger: event.compact_metadata?.trigger,
      });
      // Keep a reference so the isSynthetic message that follows can attach
      // its text as the injectedContext on this block.
      this.pendingCompactionWrapper = block;
      const msg = new MessageModel(
        'compaction',
        { role: 'system', content: [block] },
        Date.now(),
      );
      const next = [...baseMessages, msg] as Message[];
      this.messages(next);
      return;
    }
    if (
      this.compactingMode &&
      (event?.type === 'assistant' || event?.type === 'user') &&
      Array.isArray(event.message?.content)
    ) {
      for (const part of event.message.content) {
        if (part?.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
          this.compactionBuffer.push(part.text);
        }
      }
      return;
    }

    // Synthetic user messages are system-generated context injections — e.g.
    // the compacted-context message that opens a new post-compaction session.
    // Attach their text to the preceding CompactionBlock instead of rendering
    // them as a regular user message.
    if (event?.type === 'user' && (event as any).isSynthetic === true) {
      if (this.pendingCompactionWrapper) {
        const parts: string[] = [];
        if (Array.isArray(event.message?.content)) {
          for (const part of event.message.content) {
            if (part?.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
              parts.push(part.text);
            }
          }
        }
        if (parts.length > 0) {
          (this.pendingCompactionWrapper.content as CompactionBlock).injectedContext =
            parts.join('\n\n');
          // Nudge the messages signal so Vue picks up the mutation.
          this.messages([...this.messages()] as Message[]);
        }
        this.pendingCompactionWrapper = undefined;
      }
      return;
    }

    // A real (non-replay, non-synthetic) user message means a new turn is
    // starting — clear any stale compaction buffer so old content doesn't
    // bleed into a future CompactionBlock.
    if (event?.type === 'user' && !(event as any).isReplay) {
      this.compactionBuffer = [];
    }

    // Claude EnterPlanMode UI
    // SDK
    // live UI 'plan'
    // ExitPlanMode
    if (
      event?.type === 'assistant' &&
      Array.isArray(event.message?.content)
    ) {
      for (const block of event.message.content) {
        if (block?.type === 'tool_use' && block.name === 'EnterPlanMode') {
          void this.setPermissionMode('plan', false);
          break;
        }
      }
    }

    // 🔥

    // 1.
    const currentMessages = [...this.messages()] as Message[];

    // 2. TodoWrite, usage
    this.processMessage(event);

    // 3.
    // - tool_result tool_use
    // - Message
    processAndAttachMessage(currentMessages, event);

    // 4. Read ReadCoalesced
    // const merged = mergeConsecutiveReadMessages(currentMessages);

    // 5. messages signal
    // this.messages(merged);
    this.messages(currentMessages);

    // 6. — counter/pending already handled at the top of this
    // method; only `system/init` still needs to update the session id here.
    if (event?.type === 'system') {
      this.sessionId(event.session_id);
    }
  }

  /**
   * Hoist a subagent (sidechain) message onto its parent Task wrapper's
   * childTools. Shared by the live stream and session reload paths so the
   * restored Task group renders identically to a live one.
   */
  private attachSubagentMessage(event: any, messages: Message[]): void {
    const parentId = event.parent_tool_use_id as string;

    if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
      const parentWrapper = findToolUseBlock(messages, parentId);
      if (parentWrapper) {
        const parsedBlocks = parseMessageContent(event.message.content);
        for (const block of parsedBlocks) {
          if (block.type === 'tool_use') {
            parentWrapper.addChildTool(new ContentBlockWrapper(block));
          }
        }
      }
    } else if (event.type === 'user' && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block?.type === 'tool_result') {
          const childWrapper = findToolUseBlock(messages, block.tool_use_id);
          if (childWrapper) {
            childWrapper.setToolResult(block);
            if ((event as any).toolUseResult) {
              childWrapper.toolUseResult = (event as any).toolUseResult;
            }
          }
        }
      }
    }
  }

  /**
   * TodoWrite, usage
   */
  private processMessage(event: any): void {
    if (
      event.type === 'assistant' &&
      event.message?.content &&
      Array.isArray(event.message.content)
    ) {
      // TodoWrite
      for (const block of event.message.content) {
        if (
          block.type === 'tool_use' &&
          block.name === 'TodoWrite' &&
          block.input &&
          typeof block.input === 'object' &&
          'todos' in block.input
        ) {
          this.todos(block.input.todos);
        }
      }

      // usage
      if (event.message.usage) {
        this.updateUsage(event.message.usage);
      }
    }
  }

  /**
   * token
   */
  private updateUsage(usage: any): void {
    // The SDK re-sends the full conversation context each turn, so each call's
    // input_tokens represents the entire context at that point — accumulate all
    // of them to get the true session total.  contextTokens tracks only the
    // latest turn's input for the context-window-fill meter.
    const turnInput =
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);
    const turnOutput = usage.output_tokens ?? 0;

    const current = this.usageData();
    this.usageData({
      inputTokens: current.inputTokens + turnInput,
      outputTokens: current.outputTokens + turnOutput,
      contextTokens: turnInput,
      totalCost: current.totalCost,
      contextWindow: current.contextWindow
    });
  }

  private buildUserMessage(
    input: string,
    attachments: AttachmentPayload[],
    selection?: SelectionRange
  ): any {
    const content: any[] = [];

    if (selection?.selectedText) {
      content.push({
        type: 'text',
        text: `<ide_selection>The user selected the lines ${selection.startLine} to ${selection.endLine} from ${selection.filePath}:
${selection.selectedText}

This may or may not be related to the current task.</ide_selection>`
      });
    }

    for (const attachment of attachments) {
      const { fileName, mediaType, data } = attachment;
      if (!data) {
        console.error(`Attachment missing data: ${fileName}`);
        continue;
      }

      const normalizedType = (mediaType || 'application/octet-stream').toLowerCase();

      if (IMAGE_MEDIA_TYPES.includes(normalizedType as (typeof IMAGE_MEDIA_TYPES)[number])) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: normalizedType,
            data
          }
        });
        continue;
      }

      if (normalizedType === 'text/plain') {
        try {
          const decoded = typeof globalThis.atob === 'function' ? globalThis.atob(data) : '';
          content.push({
            type: 'document',
            source: {
              type: 'text',
              media_type: 'text/plain',
              data: decoded
            },
            title: fileName
          });
          continue;
        } catch (error) {
          console.error('Failed to decode text attachment', error);
        }
      }

      if (normalizedType === 'application/pdf') {
        content.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data
          },
          title: fileName
        });
        continue;
      }

      console.error(`Unsupported attachment type: ${fileName} (${normalizedType})`);
    }

    content.push({ type: 'text', text: input });

    return {
      type: 'user',
      session_id: '',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content
      }
    };
  }

  private isSlashCommand(input: string): boolean {
    return input.trim().startsWith('/');
  }

  private isSameSelection(a?: SelectionRange, b?: SelectionRange): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
      a.filePath === b.filePath &&
      a.startLine === b.startLine &&
      a.endLine === b.endLine &&
      a.startColumn === b.startColumn &&
      a.endColumn === b.endColumn &&
      a.selectedText === b.selectedText
    );
  }
}
