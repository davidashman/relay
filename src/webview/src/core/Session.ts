import { signal, computed, effect } from 'alien-signals';
import type { BaseTransport } from '../transport/BaseTransport';
import type { PermissionRequest } from './PermissionRequest';
import type { ModelOption } from '../../../shared/messages';
import type { SessionSummary } from './types';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { processAndAttachMessage, findToolUseBlock /*, mergeConsecutiveReadMessages */ } from '../utils/messageUtils';
import { isGroupableTool } from '../utils/toolGroups';
import { parseMessageContent } from '../models/contentParsers';
import { normalizeModelId, contextWindowForModel } from '../utils/modelUtils';
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
  contextTokens: number; // latest turn's input — used for context window meter
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
  static readonly ROAMING_TOOL_CALL_THRESHOLD = 30;

  private readonly claudeChannelId = signal<string | undefined>(undefined);
  private currentConnectionPromise?: Promise<BaseTransport>;
  private lastSentSelection?: SelectionRange;
  private effectCleanup?: () => void;
  private autoInterruptTriggered = false;
  // The session ID that the CLI assigned on the most recent resume. The CLI
  // forks a new branch (new session_id) on every resume, but that branch has
  // no JSONL content until the user sends a message. We defer updating the
  // public sessionId (which drives persistence / window-restore) until the
  // first `result` proves the fork's JSONL was written to disk.
  private _sdkSessionId?: string;

  // Context-compaction interception state. When the SDK streams a compacting
  // window, we buffer the summary assistant output here and surface it as a
  // single collapsible "compaction" message once `compact_boundary` arrives.
  //
  // compactionStartMessages: snapshot of messages[] taken at the moment
  // compaction begins (either via status(compacting) or the first isReplay
  // user message).  When compact_boundary arrives we restore from this
  // snapshot so that any assistant turns the model emitted while generating
  // the summary are stripped out and replaced by the single CompactionBlock.
  readonly compactingMode = signal(false);
  private compactionBuffer: string[] = [];
  private compactionStartMessages: Message[] | undefined;
  // Holds the ContentBlockWrapper for the most-recently-created CompactionBlock
  // so the isSynthetic user message that follows can be attached to it.
  private pendingCompactionWrapper: ContentBlockWrapper | undefined;
  // Set when compact_boundary has already settled the compact turn counter so
  // that a subsequent `result` event from the SDK (which may or may not arrive)
  // is absorbed without double-decrementing a subsequent user turn's counter.
  private compactResultExpected = false;
  // Stores the last non-slash user message sent to the SDK. If auto-compaction
  // absorbs that turn before the SDK answers, compact_boundary re-submits it
  // silently (no UI add) so the user gets a response.
  private pendingReplayMessage: {
    input: string;
    attachments: AttachmentPayload[];
    selectionPayload?: SelectionRange;
  } | undefined;

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
    contextTokens: 0,
    contextWindow: 200000
  });

  // Local outbound queue: when the user submits while a turn is already in
  // flight we buffer the new message here instead of pushing it into the SDK
  // input stream. This keeps entries cancellable/editable up until the prior
  // turn's `result` arrives, at which point the next queued entry is drained
  // into the SDK.
  readonly outboundQueue = signal<QueuedMessage[]>([]);
  readonly currentThinking = signal<string | undefined>(undefined);
  readonly hasActiveTool = signal(false);
  readonly streamingText = signal<string | undefined>(undefined);
  readonly currentTurnToolCallCount = signal(0);
  readonly roamingWarningDismissed = signal(false);
  readonly roamingWarning = computed(
    () =>
      this.currentTurnToolCallCount() > Session.ROAMING_TOOL_CALL_THRESHOLD &&
      this.busy() &&
      !this.roamingWarningDismissed()
  );

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

  isSessionRoaming(): boolean {
    return this.currentTurnToolCallCount() > Session.ROAMING_TOOL_CALL_THRESHOLD;
  }

  dismissRoamingWarning(): void {
    this.roamingWarningDismissed(true);
  }

  /** Mark a new user turn as in-flight. */
  private incrementOutstandingTurns(): void {
    this.outstandingTurns(this.outstandingTurns() + 1);
    this.currentTurnToolCallCount(0);
    this.roamingWarningDismissed(false);
    this.autoInterruptTriggered = false;
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

    // Keep contextWindow in sync with the selected model
    effect(() => {
      const model = this.modelSelection();
      const window = contextWindowForModel(model);
      const current = this.usageData();
      if (current.contextWindow !== window) {
        this.usageData({ ...current, contextWindow: window });
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

    console.log(`[Session.loadFromServer] sessionId=${sessionId}`);
    this.isLoading(true);
    try {
      const connection = await this.getConnection();
      const response = await connection.getSession(sessionId);
      console.log(`[Session.loadFromServer] getSession response: messages=${response?.messages?.length ?? 'null/undefined'} sessionId=${sessionId}`);
      const accumulator: Message[] = [];
      // Holds the most-recently-created CompactionBlock so the isSynthetic
      // message that follows can attach its text as injectedContext.
      let pendingRestoredCompactionWrapper: ContentBlockWrapper | undefined;
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

        // Compaction: compact_boundary → create a CollapsibleBlock.
        if (raw?.type === 'system' && raw?.subtype === 'compact_boundary') {
          const block = new ContentBlockWrapper({
            type: 'compaction',
            summary: '',
            preTokens: raw.compact_metadata?.pre_tokens,
            trigger: raw.compact_metadata?.trigger,
          });
          pendingRestoredCompactionWrapper = block;
          const msg = new MessageModel(
            'compaction',
            { role: 'system', content: [block] },
            Date.now(),
          );
          accumulator.push(msg as Message);
          continue;
        }

        // Compaction: isSynthetic/isCompactSummary user message → attach as
        // injectedContext.  isSynthetic is set by convertMessage (main path);
        // isCompactSummary is the raw JSONL field (direct .jsonl import path).
        if (raw?.type === 'user' && ((raw as any).isSynthetic === true || (raw as any).isCompactSummary === true)) {
          if (pendingRestoredCompactionWrapper) {
            const parts: string[] = [];
            if (Array.isArray(raw.message?.content)) {
              for (const part of raw.message.content) {
                if (part?.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
                  parts.push(part.text);
                }
              }
            }
            if (parts.length > 0) {
              (pendingRestoredCompactionWrapper.content as CompactionBlock).injectedContext =
                parts.join('\n\n');
            }
            pendingRestoredCompactionWrapper = undefined;
          }
          continue;
        }

        this.processMessage(raw);
        // processAndAttachMessage tool_result
        // tool_result tool_use
        processAndAttachMessage(accumulator, raw);
      }
      // ReadCoalesced
      // this.messages(mergeConsecutiveReadMessages(accumulator));
      console.log(`[Session.loadFromServer] accumulated ${accumulator.length} messages for sessionId=${sessionId}`);
      this.messages(accumulator);
      console.log(`[Session.loadFromServer] messages signal set, calling launchClaude for sessionId=${sessionId}`);
      await this.launchClaude();
      console.log(`[Session.loadFromServer] launchClaude returned for sessionId=${sessionId}`);
    } catch (e) {
      console.error(`[Session.loadFromServer] error loading sessionId=${sessionId}:`, e);
      throw e;
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

    // Slash commands (e.g. /compact) are internal SDK directives — don't
    // render them as visible user messages in the thread.
    if (messageModel && !isSlash) {
      this.messages([...this.messages(), messageModel]);
      // Track for silent replay if auto-compaction absorbs this turn.
      this.pendingReplayMessage = { input, attachments, selectionPayload };
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

  /** Re-send a message to the SDK after auto-compaction without adding it to the UI. */
  private async replayAfterCompaction(
    input: string,
    attachments: AttachmentPayload[],
    selectionPayload?: SelectionRange
  ): Promise<void> {
    const connection = await this.getConnection();
    const channelId = this.claudeChannelId();
    if (!channelId) return;
    const userMessage = this.buildUserMessage(input, attachments, selectionPayload);
    this.incrementOutstandingTurns();
    connection.sendInput(channelId, userMessage, false);
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


    // Resume from the latest SDK-assigned branch if we have one; otherwise
    // resume from the stable (persisted) sessionId.
    const resumeId = this._sdkSessionId ?? this.sessionId();
    console.log(`[Session.launchClaude] sending launch_claude: channel=${channelId} resume=${resumeId ?? 'null'}`);
    const stream = connection.launchClaude(
      channelId,
      resumeId ?? undefined,
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
    this.pendingReplayMessage = undefined;
    this.hasActiveTool(false);
    this.streamingText(undefined);
    this.outboundQueue([]);
    this.currentTurnToolCallCount(0);
    this.roamingWarningDismissed(false);
    this.autoInterruptTriggered = false;
  }

  async restartClaude(): Promise<void> {
    // Promote any deferred SDK session ID so the restart resumes from the
    // most recent fork rather than the original pre-resume session.
    if (this._sdkSessionId) {
      this.sessionId(this._sdkSessionId);
      this._sdkSessionId = undefined;
    }
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

  async setEffortLevel(level: string | undefined): Promise<void> {
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
      this.hasActiveTool(false);
      this.streamingText(undefined);
      // Don't drop the outbound queue here — if the stream ended because the
      // SDK naturally closed between turns, we still want the next queued
      // entry to drain when the channel comes back up. `interrupt()` is the
      // explicit path that clears the queue.
      this.claudeChannelId(undefined);
    }
  }

  private processIncomingMessage(event: any): void {
    const detail = event?.type === 'stream_event'
      ? `stream_event/${event.event?.type}${event.event?.delta?.type ? `/${event.event.delta.type}` : ''}`
      : event?.type;
    console.log('[Session] io_message:', detail);

    // Settle counter FIRST, before heavier processing that might throw.
    // If we crash rendering a `result`, we still want the spinner to stop
    // and the queue to drain.
    if (event?.type === 'result') {
      this.currentThinking(undefined);
      this.hasActiveTool(false);
      this.streamingText(undefined);
      // The user sent a message and the CLI wrote a turn to the forked session's
      // JSONL. It's now safe to promote the deferred SDK session ID so future
      // window restores use the up-to-date session.
      if (this._sdkSessionId) {
        this.sessionId(this._sdkSessionId);
        this._sdkSessionId = undefined;
      }
      if (this.compactResultExpected) {
        // compact_boundary already settled the compact turn — absorb this result
        // without touching outstandingTurns so subsequent user turns aren't miscounted.
        this.compactResultExpected = false;
        if (this.outstandingTurns() === 0 && this.outboundQueue().length > 0) {
          void this.drainOutboundQueue();
        }
      } else {
        this.pendingReplayMessage = undefined;
        this.decrementOutstandingTurns();
        if (this.outstandingTurns() === 0 && this.outboundQueue().length > 0) {
          void this.drainOutboundQueue();
        }
      }
    }

    // Streaming partial text deltas — accumulate into streamingText for live preview.
    // These are emitted because includePartialMessages: true; cleared when the
    // complete assistant message arrives.
    if (event?.type === 'stream_event') {
      const sdkEvent = event.event;
      if (sdkEvent?.type === 'content_block_delta' && sdkEvent.delta?.type === 'text_delta') {
        // Text is now flowing — thinking phase is definitively over.
        if (this.currentThinking()) this.currentThinking(undefined);
        const current = this.streamingText() ?? '';
        this.streamingText(current + sdkEvent.delta.text);
      }
      return;
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
        this.compactingMode(true);
        this.compactionBuffer = [];
        this.compactionStartMessages = [...this.messages()] as Message[];
      } else if (this.compactingMode()) {
        // Status cleared without boundary (e.g. interrupted): drop buffer.
        this.compactingMode(false);
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
      if (!this.compactingMode()) {
        this.compactingMode(true);
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
      // Compaction creates a new session JSONL file with real content — update
      // sessionId immediately (no need to defer) and clear any pending fork ID.
      if (event.session_id) {
        this.sessionId(event.session_id);
        this._sdkSessionId = undefined;
      }
      const summary = this.compactionBuffer.join('\n\n').trim();
      this.compactingMode(false);
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

      // The compact turn is consumed by compaction itself. Settle the counter
      // now so the thread doesn't get stuck busy.
      //
      // If a real user message was in flight when auto-compact fired, replay it
      // silently (no UI add) so the SDK answers it in the new compact session.
      //
      // For manual /compact there's no message to replay; set compactResultExpected
      // so any stray `result` event that arrives is absorbed harmlessly.
      if (this.outstandingTurns() > 0) {
        this.decrementOutstandingTurns();
        const replayMsg = this.pendingReplayMessage;
        this.pendingReplayMessage = undefined;
        if (replayMsg) {
          void this.replayAfterCompaction(replayMsg.input, replayMsg.attachments, replayMsg.selectionPayload);
        } else {
          this.compactResultExpected = true;
          if (this.outstandingTurns() === 0 && this.outboundQueue().length > 0) {
            void this.drainOutboundQueue();
          }
        }
      }
      return;
    }
    if (
      this.compactingMode() &&
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
    //
    // The SDK sets `isSynthetic` when converting live-stream messages through
    // its `case "user"` emitter.  However, compact-summary messages that are
    // yielded *raw* (auto-compact / manual-compact fast path) only carry the
    // original `isCompactSummary` flag, not `isSynthetic`.  Check both so the
    // message is suppressed regardless of which code path produced it.
    if (event?.type === 'user' && (
      (event as any).isSynthetic === true ||
      (event as any).isCompactSummary === true
    )) {
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
      if (Array.isArray(event.message?.content) &&
          event.message.content.some((b: any) => b?.type === 'tool_result')) {
        this.hasActiveTool(false);
      }
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
      // Complete assistant message arrived — the streamed text is now in the thread.
      this.streamingText(undefined);

      // Track latest thinking text for the waiting indicator; clear it when a
      // non-thinking message arrives so the hint disappears between thoughts.
      const thinkingBlock = event.message.content.find(
        (b: any) => b?.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()
      );
      this.currentThinking(thinkingBlock ? thinkingBlock.thinking.trim() : undefined);

      const hasToolUse = event.message.content.some((b: any) => b?.type === 'tool_use');
      if (hasToolUse) {
        this.hasActiveTool(true);
        const passiveToolCount = event.message.content.filter(
          (b: any) => b?.type === 'tool_use' && isGroupableTool(b.name)
        ).length;
        this.currentTurnToolCallCount(this.currentTurnToolCallCount() + passiveToolCount);
        this.checkRoaming();
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

    // 6. Session ID update from system/init.
    // For brand-new sessions there's no prior ID, so accept whatever the CLI assigns.
    // For resumed sessions the CLI forks a new branch (new session_id) that has no
    // JSONL content yet — store it in _sdkSessionId and defer the public update until
    // the first `result` event proves the fork's JSONL was written.
    if (event?.type === 'system' && event.session_id) {
      const existing = this.sessionId();
      if (!existing) {
        this.sessionId(event.session_id);
      } else if (event.session_id !== existing) {
        this._sdkSessionId = event.session_id;
      }
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

  private checkRoaming(): void {
    if (!this.isSessionRoaming() || this.autoInterruptTriggered) return;
    const autoInterrupt = (this.config() as any)?.autoInterruptOnRoaming ?? false;
    if (autoInterrupt) {
      this.autoInterruptTriggered = true;
      void this.interrupt();
    }
  }

  /**
   * TodoWrite, context window meter
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

      if (event.message.usage) {
        this.updateContextUsage(event.message.usage);
      }
    }
  }

  private updateContextUsage(usage: any): void {
    const contextTokens =
      (usage.input_tokens ?? 0)
      + (usage.cache_creation_input_tokens ?? 0)
      + (usage.cache_read_input_tokens ?? 0);

    const current = this.usageData();
    this.usageData({
      contextTokens,
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
