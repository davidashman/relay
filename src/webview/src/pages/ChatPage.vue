<template>
  <div class="chat-page">
    <div class="main">
      <!-- <div class="chatContainer"> -->
        <div
          ref="containerEl"
          :class="['messagesContainer', 'custom-scroll-container']"
        >
          <template v-if="sessionLoading">
            <div class="emptyState">
              <div class="emptyLoadingWordmark">
                <ClaudeWordmark class="emptyWordmarkSvg" />
              </div>
              <div class="loadingSpinnerRow">
                <Spinner :size="20" :permission-mode="'default'" label="Loading..." :showIcon="false" />
              </div>
            </div>
          </template>
          <template v-else-if="messages.length === 0">
            <div v-if="isBusy" class="emptyState">
              <div class="emptyWordmark">
                <ClaudeWordmark class="emptyWordmarkSvg" />
              </div>
            </div>
            <div v-else class="emptyState">
              <div class="emptyWordmark">
                <ClaudeWordmark class="emptyWordmarkSvg" />
              </div>
              <RandomTip :platform="platform" />
            </div>
          </template>
          <template v-else>
            <!-- <div class="msg-list"> -->
              <template v-for="segment in messageSegments" :key="segment.key">
                <div v-if="segment.type === 'tool-group'" class="tool-group-msg">
                  <ToolGroup
                    :wrappers="getGroupWrappers(segment.messages)"
                    :context="toolContext"
                  />
                </div>
                <MessageRenderer
                  v-else
                  :message="segment.message"
                  :context="toolContext"
                />
              </template>
            <!-- </div> -->
            <StreamingMessage v-if="streamingText" :text="streamingText" />
            <div v-if="isBusy && !pendingPermission && !streamingText" class="spinnerRow">
              <Spinner :size="18" :permission-mode="permissionMode" :label="spinnerLabel" />
            </div>
            <div ref="endEl" />
          </template>

          <!-- Jump to latest button (floating over messages) -->
          <Transition name="jump-button">
            <div v-if="showJumpToLatest" class="jumpToLatestContainer">
              <button class="jumpToLatestButton" @click="jumpToLatest">
                <span class="codicon codicon-arrow-down"></span>
                Jump to Latest
              </button>
            </div>
          </Transition>
        </div>

        <div class="inputContainer">
          <AskUserQuestionModal
            v-if="pendingPermission && toolContext && pendingPermission.toolName === 'AskUserQuestion'"
            :request="pendingPermission"
            :context="toolContext"
            :on-resolve="handleResolvePermission"
            data-permission-panel="1"
          />
          <PermissionRequestModal
            v-else-if="pendingPermission && toolContext"
            :request="pendingPermission"
            :context="toolContext"
            :on-resolve="handleResolvePermission"
            data-permission-panel="1"
          />
          <MessageQueueList
            :queued-messages="outboundQueue"
            :visible="outboundQueue.length > 0"
            @remove="handleQueueRemove"
            @send-now="handleQueueSendNow"
          />
          <ChatInputBox
            ref="chatInputRef"
            :show-progress="true"
            :progress-percentage="progressPercentage"
            :context-tooltip="contextTooltip"
            :input-tokens="inputTokens"
            :output-tokens="outputTokens"
            :show-token-usage="showTokenUsage"
            :conversation-working="isBusy"
            :attachments="attachments"
            :thinking-enabled="session?.thinkingLevel.value !== 'off'"
            :effort-level="session?.effortLevel.value"
            :permission-mode="session?.permissionMode.value"
            :selected-model="session?.modelSelection.value"
            @submit="handleSubmit"
            @submit-and-interrupt="handleSubmitAndInterrupt"
            @stop="handleStop"
            @add-attachment="handleAddAttachment"
            @remove-attachment="handleRemoveAttachment"
            @thinking-toggle="handleToggleThinking"
            @mode-select="handleModeSelect"
            @model-select="handleModelSelect"
            @effort-select="handleEffortSelect"
          />
        </div>
      <!-- </div> -->
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, inject, onMounted, onUnmounted, nextTick, watch } from 'vue';
  import { RuntimeKey } from '../composables/runtimeContext';
  import { useSession } from '../composables/useSession';
  import type { Session } from '../core/Session';
  import type { PermissionRequest } from '../core/PermissionRequest';
  import type { ToolContext } from '../types/tool';
  import type { AttachmentItem } from '../types/attachment';
  import { convertFileToAttachment } from '../types/attachment';
  import ChatInputBox from '../components/ChatInputBox.vue';
  import MessageQueueList from '../components/MessageQueueList.vue';
  import PermissionRequestModal from '../components/PermissionRequestModal.vue';
  import AskUserQuestionModal from '../components/AskUserQuestionModal.vue';
  import Spinner from '../components/Messages/WaitingIndicator.vue';
  import ClaudeWordmark from '../components/ClaudeWordmark.vue';
  import RandomTip from '../components/RandomTip.vue';
  import MessageRenderer from '../components/Messages/MessageRenderer.vue';
  import StreamingMessage from '../components/Messages/StreamingMessage.vue';
  import ToolGroup from '../components/Messages/blocks/ToolGroup.vue';
  import type { ContentBlockWrapper } from '../models/ContentBlockWrapper';
  import { useKeybinding } from '../utils/useKeybinding';
  import { isGroupableTool } from '../utils/toolGroups';
  import { useSignal } from '@gn8/alien-signals-vue';
  import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
  import { prepareSendAnimation, captureQueueItemSnapshot, type SendSnapshot } from '../composables/useSendAnimation';

  const runtime = inject(RuntimeKey);
  if (!runtime) throw new Error('[ChatPage] runtime not provided');

  const toolContext = computed<ToolContext>(() => ({
    fileOpener: {
      open: (filePath: string, location?: any) => {
        void runtime.appContext.fileOpener.open(filePath, location);
      },
      openContent: (content: string, fileName: string, editable: boolean) => {
        return runtime.appContext.fileOpener.openContent(
          content,
          fileName,
          editable
        );
      },
      openAttachment: (fileName: string, mediaType: string, data: string) => {
        void runtime.appContext.fileOpener.openAttachment(fileName, mediaType, data);
      },
    },
  }));

  // Session loading state (true while fetching an existing session from sidebar click)
  const sessionLoading = useSignal<boolean>(runtime.sessionLoading);

  // activeSessionalien-signal → Vue ref
  const activeSessionRaw = useSignal<Session | undefined>(
    runtime.sessionStore.activeSession
  );

  // useSession alien-signals Vue Refs
  const session = computed(() => {
    const raw = activeSessionRaw.value;
    return raw ? useSession(raw) : null;
  });

  // Vue Ref.value
  const title = computed(() => session.value?.summary.value || 'New Conversation');
  const messages = computed<any[]>(() => session.value?.messages.value ?? []);

  // Only these tool types are collapsed into a group; others render individually
  // True if the message contains only groupable tool_use blocks (ignoring empty text
  // and thinking blocks, which the Claude API commonly emits alongside tool_use on reload).
  function isToolOnlyAssistantMessage(msg: any): boolean {
    if (msg.type !== 'assistant') return false;
    const content = msg.message?.content;
    if (!Array.isArray(content) || content.length === 0) return false;

    let hasGroupableTool = false;
    for (const w of content) {
      const type = w?.content?.type;
      if (type === 'tool_use') {
        if (!isGroupableTool(w?.content?.name)) return false;
        hasGroupableTool = true;
      } else if (type === 'text') {
        // Ignore empty text blocks (Claude often emits these alongside tool_use)
        if (w?.content?.text?.trim()) return false;
      } else if (type === 'thinking' || type === 'redacted_thinking') {
        // Ignore thinking blocks
      } else {
        return false;
      }
    }
    return hasGroupableTool;
  }

  // True for messages that are visually transparent and should not break a tool group.
  // - User messages containing only tool_results
  // - Assistant messages containing only thinking/redacted_thinking or empty text blocks
  //   (the SDK emits these between tool calls during streaming)
  function isTransparentMessage(msg: any): boolean {
    if (msg.type === 'user') {
      const content = msg.message?.content;
      if (!Array.isArray(content)) return false;
      return content.length === 0 || content.every((w: any) => w?.content?.type === 'tool_result');
    }
    if (msg.type === 'assistant') {
      const content = msg.message?.content;
      if (!Array.isArray(content) || content.length === 0) return false;
      return content.every((w: any) => {
        const type = w?.content?.type;
        return type === 'thinking' || type === 'redacted_thinking' ||
               (type === 'text' && !w?.content?.text?.trim());
      });
    }
    return false;
  }

  // Collect all ContentBlockWrappers from a list of messages
  function getGroupWrappers(groupMessages: any[]): ContentBlockWrapper[] {
    return groupMessages.flatMap((msg: any) => {
      const content = msg.message?.content;
      return Array.isArray(content) ? content : [];
    });
  }

  type MessageSegment =
    | { type: 'single'; message: any; key: string }
    | { type: 'tool-group'; messages: any[]; key: string };

  // Group consecutive tool-only assistant messages into a single ToolGroup segment.
  // User messages containing only tool_results are "transparent" — they don't break a group.
  const messageSegments = computed((): MessageSegment[] => {
    const result: MessageSegment[] = [];
    let currentGroup: any[] | null = null;
    let groupKey = '';

    for (let i = 0; i < messages.value.length; i++) {
      const msg = messages.value[i];

      if (isTransparentMessage(msg)) {
        // Invisible user messages — render as singles but don't break the current group
        result.push({ type: 'single', message: msg, key: `m-${i}` });
        continue;
      }

      if (isToolOnlyAssistantMessage(msg)) {
        if (!currentGroup) {
          currentGroup = [];
          groupKey = `g-${i}`;
        }
        currentGroup.push(msg);
      } else {
        if (currentGroup) {
          result.push({ type: 'tool-group', messages: currentGroup, key: groupKey });
          currentGroup = null;
        }
        result.push({ type: 'single', message: msg, key: `m-${i}` });
      }
    }

    if (currentGroup) {
      result.push({ type: 'tool-group', messages: currentGroup, key: groupKey });
    }

    return result;
  });

  const isBusy = computed(() => session.value?.busy.value ?? false);
  const isCompacting = computed(() => session.value?.compactingMode.value ?? false);
  const currentThinking = computed(() => session.value?.currentThinking.value);
  const streamingText = computed(() => session.value?.streamingText.value);
  const spinnerLabel = computed(() => {
    if (isCompacting.value) return 'Compacting...';
    if (currentThinking.value) return 'Thinking...';
    return 'Working...';
  });
  // Slash commands (e.g. /compact) are SDK directives, not user messages — hide them from the queue display.
  const outboundQueue = computed(() =>
    (session.value?.outboundQueue.value ?? []).filter(m => !m.content.startsWith('/'))
  );
  const permissionMode = computed(
    () => session.value?.permissionMode.value ?? 'default'
  );
  const permissionRequests = computed(
    () => session.value?.permissionRequests.value ?? []
  );
  const permissionRequestsLen = computed(() => permissionRequests.value.length);
  const pendingPermission = computed(() => permissionRequests.value[0] as any);
  const platform = computed(() => runtime.appContext.platform);

  // permissionMode.toggle

  // Token usageData
  const usageComputed = computed(() => {
    const s = session.value;
    if (!s) return { percentage: 0, inputTokens: 0, outputTokens: 0, contextTokens: 0, contextWindow: 200000 };

    const usage = s.usageData.value;
    const windowSize = usage.contextWindow || 200000;
    // contextTokens is the latest turn's input — the true measure of how full
    // the context window is right now (not the cumulative session total).
    const percentage = (usage.contextTokens > 0)
      ? Math.max(0, Math.min(100, (usage.contextTokens / windowSize) * 100))
      : 0;

    return { percentage, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, contextTokens: usage.contextTokens, contextWindow: windowSize };
  });

  const progressPercentage = computed(() => usageComputed.value.percentage);
  const inputTokens = computed(() => usageComputed.value.inputTokens);
  const outputTokens = computed(() => usageComputed.value.outputTokens);
  const showTokenUsage = computed(() => runtime.appContext.showTokenUsage);

  const contextTooltip = computed(() => {
    const { contextTokens, contextWindow } = usageComputed.value;
    const fmt = (n: number) => {
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return `${n}`;
    };
    return `${fmt(contextTokens)} / ${fmt(contextWindow)} context used`;
  });

  // DOM refs
  const containerEl = ref<HTMLDivElement | null>(null);
  const endEl = ref<HTMLDivElement | null>(null);
  const chatInputRef = ref<InstanceType<typeof ChatInputBox> | null>(null);

  const attachments = ref<AttachmentItem[]>([]);

  // Scroll state management
  const showJumpToLatest = ref(false);
  const isUserScrolledUp = ref(false);

  function stringify(m: any): string {
    try {
      return JSON.stringify(m ?? {}, null, 2);
    } catch {
      return String(m);
    }
  }

  function isNearBottom(container: HTMLElement, threshold = 100): boolean {
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < threshold;
  }

  function checkScrollPosition(): void {
    const container = containerEl.value;
    if (!container) return;

    const nearBottom = isNearBottom(container);
    isUserScrolledUp.value = !nearBottom;
    showJumpToLatest.value = !nearBottom;
  }

  function scrollToBottom(force = false): void {
    const end = endEl.value;
    const container = containerEl.value;
    if (!end || !container) return;

    // Only auto-scroll if user is near bottom or force is true
    if (force || !isUserScrolledUp.value) {
      requestAnimationFrame(() => {
        try {
          end.scrollIntoView({ block: 'end' });
          showJumpToLatest.value = false;
          isUserScrolledUp.value = false;
        } catch {}
      });
    }
  }

  function jumpToLatest(): void {
    scrollToBottom(true);
  }

  watch(session, async () => {
    await nextTick();
    scrollToBottom(true); // Force scroll on session change
    chatInputRef.value?.focus();
  });

  // Scroll to bottom on any messages change (new messages or content updates within
  // existing messages) and when the spinner appears — but only if already at bottom.
  watch(messages, () => { scrollToBottom(); }, { flush: 'post' });
  watch(streamingText, () => { scrollToBottom(); }, { flush: 'post' });
  watch(isBusy, (newVal) => { if (newVal) scrollToBottom(); }, { flush: 'post' });

  watch(
    () => outboundQueue.value.length,
    async (len, prevLen) => {
      if (len > prevLen) {
        await nextTick();
        scrollToBottom(true);
      }
    }
  );

  watch(permissionRequestsLen, async (newLen) => {
    await nextTick();
    scrollToBottom(); // Only auto-scroll if near bottom
    // Restore focus to input after last permission modal is dismissed
    if (newLen === 0) {
      chatInputRef.value?.focus();
    }
  });

  function handleWindowFocus() {
    // Restore focus to the input box when the tab/window regains focus,
    // but only when there is no permission modal blocking the input.
    if (!pendingPermission.value) {
      chatInputRef.value?.focus();
    }
  }

  onMounted(async () => {
    await nextTick();
    scrollToBottom(true); // Force scroll on mount
    chatInputRef.value?.focus();

    // Add scroll listener to track user scroll position
    const container = containerEl.value;
    if (container) {
      container.addEventListener('scroll', checkScrollPosition);
    }

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('keydown', handleDoubleEscape);
  });

  onUnmounted(() => {
    try { unregisterToggle?.(); } catch {}

    // Remove scroll listener
    const container = containerEl.value;
    if (container) {
      container.removeEventListener('scroll', checkScrollPosition);
    }

    window.removeEventListener('focus', handleWindowFocus);
    document.removeEventListener('keydown', handleDoubleEscape);
  });

  // ChatInput
  async function handleSubmit(content: string, snapshot?: SendSnapshot | null) {
    const trimmed = (content || '').trim();

    // Handle built-in /clear command
    if (trimmed === '/clear') {
      await runtime!.tabs.replaceCurrentTab();
      return;
    }

    const s = session.value;
    if (!s || (!trimmed && attachments.value.length === 0)) return;

    // Determine whether Session.send will queue or land in the thread. This
    // dictates which animation variant we run and which DOM target to glide to.
    const rawSession = activeSessionRaw.value;
    const willLandInMessages =
      !!rawSession &&
      rawSession.outstandingTurns() === 0 &&
      rawSession.outboundQueue().length === 0;
    const willQueue = !!rawSession && !willLandInMessages;

    try {
      // send
      // Note: we no longer gate on isBusy — the SDK's long-lived query loop
      // interleaves user turns, so submitting mid-turn is expected.
      await s.send(trimmed || ' ', attachments.value);

      attachments.value = [];

      await nextTick();

      // CRITICAL: find the just-rendered target and hide it synchronously,
      // BEFORE the browser has a chance to paint it. `nextTick` flushes as a
      // microtask, so no paint has occurred yet — this sync code runs first.
      let animation: { play: () => Promise<void> } | null = null;
      if (snapshot && willLandInMessages) {
        const container = containerEl.value;
        const userMessages = container?.querySelectorAll<HTMLElement>('.user-message');
        const targetEl = userMessages?.[userMessages.length - 1];
        if (targetEl) {
          animation = prepareSendAnimation(snapshot, targetEl, 'thread');
        }
      } else if (snapshot && willQueue) {
        // The queue list may be collapsed — if no queue-item is currently in
        // the DOM, skip the animation.
        const queueItems = document.querySelectorAll<HTMLElement>(
          '.message-queue-section .queue-item'
        );
        const targetEl = queueItems[queueItems.length - 1];
        if (targetEl) {
          animation = prepareSendAnimation(snapshot, targetEl, 'queue');
        }
      }

      // Thread-variant sends should scroll the new message into view; queue
      // sends don't add anything to the thread so the scroll is unnecessary.
      if (willLandInMessages) {
        scrollToBottom(true);
      }

      if (animation) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        // Fire-and-forget: don't block the handler on the glide.
        void animation.play();
      }
    } catch (e) {
      console.error('[ChatPage] send failed', e);
    }
  }

  // "Interrupt then send" path — triggered by Cmd/Ctrl+Enter.
  async function handleSubmitAndInterrupt(content: string, snapshot?: SendSnapshot | null) {
    const s = session.value;
    if (!s) return;
    try {
      await s.interrupt();
    } catch (e) {
      console.error('[ChatPage] interrupt before send failed', e);
    }
    await handleSubmit(content, snapshot);
  }

  function handleQueueRemove(id: string) {
    session.value?.removeFromQueue(id);
  }

  async function handleQueueSendNow(id: string) {
    // Capture the queue item's visual position BEFORE sendQueuedNow removes it
    // from the queue, so we can animate it gliding into the thread.
    const queueItemEl = document.querySelector<HTMLElement>(
      `.message-queue-section .queue-item[data-message-id="${id}"]`
    );
    const snapshot = queueItemEl ? captureQueueItemSnapshot(queueItemEl) : null;

    session.value?.sendQueuedNow(id);

    if (!snapshot) return;

    await nextTick();

    // Find the new user message that just landed in the thread.
    const container = containerEl.value;
    const userMessages = container?.querySelectorAll<HTMLElement>('.user-message');
    const targetEl = userMessages?.[userMessages.length - 1];
    if (!targetEl) return;

    const animation = prepareSendAnimation(snapshot, targetEl, 'thread');
    scrollToBottom(true);

    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    void animation.play();
  }

  async function handleToggleThinking() {
    const s = session.value;
    if (!s) return;

    const currentLevel = s.thinkingLevel.value;
    const newLevel = currentLevel === 'off' ? 'default_on' : 'off';

    await s.setThinkingLevel(newLevel);
  }

  async function handleModeSelect(mode: PermissionMode) {
    const s = session.value;
    if (!s) return;

    await s.setPermissionMode(mode);
  }

  // permissionMode.toggle
  const togglePermissionMode = () => {
    const s = session.value;
    if (!s) return;
    const order: PermissionMode[] = ['default', 'acceptEdits', 'plan'];
    const cur = (s.permissionMode.value as PermissionMode) ?? 'default';
    const idx = Math.max(0, order.indexOf(cur));
    const next = order[(idx + 1) % order.length];
    void s.setPermissionMode(next);
  };

  // toggle
  const unregisterToggle = runtime.appContext.commandRegistry.registerAction(
    {
      id: 'permissionMode.toggle',
      label: 'Toggle Permission Mode',
      description: 'Cycle permission mode in fixed order'
    },
    'App Shortcuts',
    () => {
      togglePermissionMode();
    }
  );

  // shift+tab → permissionMode.toggle
  useKeybinding({
    keys: 'shift+tab',
    handler: togglePermissionMode,
    allowInEditable: true,
    priority: 100,
  });

  async function handleModelSelect(modelId: string) {
    const s = session.value;
    if (!s) return;

    await s.setModel({ value: modelId });
  }

  async function handleEffortSelect(level: string) {
    const s = session.value;
    if (!s) return;

    await s.setEffortLevel(level);
  }

  function handleStop() {
    const s = session.value;
    if (s) {
      // useSession
      void s.interrupt();
    }
  }

  // Esc-Esc interrupts the current turn, matching the stop button. Any Esc
  // already handled (history-nav exit, dropdown/modal close, etc.) is
  // ignored via defaultPrevented so it doesn't count toward the pair.
  const ESC_DOUBLE_PRESS_MS = 750;
  let lastEscapeAt: number | null = null;

  function handleDoubleEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape') {
      lastEscapeAt = null;
      return;
    }
    if (event.defaultPrevented) {
      lastEscapeAt = null;
      return;
    }
    const now = performance.now();
    if (lastEscapeAt != null && now - lastEscapeAt < ESC_DOUBLE_PRESS_MS) {
      lastEscapeAt = null;
      handleStop();
      return;
    }
    lastEscapeAt = now;
  }

  async function handleAddAttachment(files: FileList) {
    if (!files || files.length === 0) return;

    try {
      // AttachmentItem
      const conversions = await Promise.all(
        Array.from(files).map(convertFileToAttachment)
      );

      attachments.value = [...attachments.value, ...conversions];

      console.log('[ChatPage] Added attachments:', conversions.map(a => a.fileName));
    } catch (e) {
      console.error('[ChatPage] Failed to convert files:', e);
    }
  }

  function handleRemoveAttachment(id: string) {
    attachments.value = attachments.value.filter(a => a.id !== id);
  }

  // Permission modal handler
  function handleResolvePermission(request: PermissionRequest, allow: boolean) {
    try {
      if (allow) {
        request.accept(request.inputs);
        // Approving an ExitPlanMode call means the user has accepted the plan
        // and wants Claude to proceed. Restore the permission mode that was
        // active before entering plan mode so Claude actually has the tools to
        // execute.
        if (request.toolName === 'ExitPlanMode') {
          void session.value?.exitPlanMode();
        }
      } else {
        request.reject('User denied', true);
      }
    } catch (e) {
      console.error('[ChatPage] permission resolve failed', e);
    }
  }
</script>

<style scoped>
  .chat-page {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
    isolation: isolate; /* Create stacking context */
  }

  /* Chat React */
  .chatContainer {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .messagesContainer {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 8px 0 12px;
    position: relative;
  }

  /* Mirror AssistantMessage padding so grouped tool messages align with regular messages */
  .tool-group-msg {
    padding: 0 16px 0.4rem 12px;
    background-color: var(--vscode-sideBar-background);
    font-size: 12px;
    line-height: 1.6;
    color: var(--vscode-editor-foreground);
    word-wrap: break-word;
  }

  .loadingSpinnerRow {
    padding-left: 0px;
  }
  .spinnerRow {
    padding-left: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .msg-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 12px;
  }

  .msg-item {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 8px;
  }

  .json-block {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(
      --app-monospace-font-family,
      ui-monospace,
      SFMono-Regular,
      Menlo,
      Monaco,
      Consolas,
      'Liberation Mono',
      'Courier New',
      monospace
    );
    font-size: var(--app-monospace-font-size, 12px);
    line-height: 1.5;
    color: var(--vscode-editor-foreground);
  }

  /* */

  /* */
  .inputContainer {
    padding: 8px 12px 12px;
  }

  /* */
  .main > :last-child {
    flex-shrink: 0;
    background-color: var(--vscode-panel-background);
    /* border-top: 1px solid var(--vscode-panel-border); */
    max-width: 1200px;
    width: 100%;
    align-self: center;
  }

  /* */
  .emptyState {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 32px 16px;
  }

  .emptyWordmark {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 24px;
  }

  .emptyLoadingWordmark {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 12px;
  }

  /* Jump to latest button */
  .jumpToLatestContainer {
    position: sticky;
    bottom: 8px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    pointer-events: none;
    z-index: 100;
    margin-top: -48px; /* Negative margin to overlay content */
  }

  .jumpToLatestButton {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    pointer-events: auto;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
    transition: all 0.2s ease;
  }

  .jumpToLatestButton:hover {
    background: var(--vscode-button-hoverBackground);
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  }

  .jumpToLatestButton .codicon {
    font-size: 14px;
  }

  /* Transition animations */
  .jump-button-enter-active,
  .jump-button-leave-active {
    transition: all 0.25s ease;
  }

  .jump-button-enter-from,
  .jump-button-leave-to {
    opacity: 0;
    transform: translateY(-10px);
  }

  .jump-button-enter-to,
  .jump-button-leave-from {
    opacity: 1;
    transform: translateY(0);
  }
</style>
