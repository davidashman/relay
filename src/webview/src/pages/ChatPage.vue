<template>
  <div class="chat-page">
    <div class="main">
      <!-- <div class="chatContainer"> -->
        <TerminalView
          v-if="isTerminalMode && activeSessionRaw && session?.connection.value"
          ref="terminalViewRef"
          :session="activeSessionRaw"
          :connection="session!.connection.value!"
          class="terminalContainer"
        />
        <div
          v-else
          ref="containerEl"
          :class="['messagesContainer', 'custom-scroll-container']"
          :style="containerHeight > 0 ? { '--thread-height': containerHeight + 'px' } : {}"
        >
          <div class="messages-inner">
          <template v-if="sessionLoading || isSessionLoading || messages.length === 0">
            <div class="emptyState" @animationiteration="handleIconAnimationIteration">
              <template v-if="sessionError">
                <div v-if="sessionError" class="errorBox">
                  <span class="codicon codicon-error errorBoxIcon"></span>
                  <div class="errorBoxText">{{ sessionError }}</div>
                </div>
                <button class="retryBtn" @click="handleRetry">Retry</button>
              </template>
              <RelayIcon v-else :class="['relay-icon-loading', showLoadingAnimation ? 'relay-icon-working' : 'relay-icon-waiting']" />
            </div>
          </template>
          <template v-else>
            <template v-for="section in chatSections" :key="section.key">
              <!-- Pre-section: messages before the first user prompt -->
              <template v-if="section.header === null">
                <template v-for="seg in section.body" :key="seg.key">
                  <div v-if="seg.type === 'tool-group'" class="tool-group-msg">
                    <ToolGroup :wrappers="getGroupWrappers(seg.messages)" :context="toolContext" />
                  </div>
                  <MessageRenderer v-else :message="seg.message" :context="toolContext" />
                </template>
              </template>
              <!-- Section: sticky user prompt header + its responses -->
              <div
                v-else
                class="chat-section"
                :data-section-key="section.key"
                :style="section.key === lastSectionKey && containerHeight > 0 ? { minHeight: containerHeight + 'px' } : {}"
              >
                <div class="section-sticky-header" @click="scrollToSection(section.key)">
                  <UserMessage
                    :message="section.header.message"
                    :context="toolContext"
                    :pinned="true"
                    :is-active="isBusy && section.key === lastSectionKey"
                    :is-compacting="isCompacting"
                    :permission-mode="permissionMode"
                    @interrupt="handleTurnInterrupt"
                  />
                </div>
                <div class="section-body">
                  <div v-for="seg in section.body" :key="seg.key" class="section-content">
                    <div v-if="seg.type === 'tool-group'" class="tool-group-msg">
                      <ToolGroup :wrappers="getGroupWrappers(seg.messages)" :context="toolContext" />
                    </div>
                    <MessageRenderer v-else :message="seg.message" :context="toolContext" />
                  </div>
                  <template v-if="section.key === lastSectionKey">
                    <StreamingMessage v-if="streamingText" :text="streamingText" />
                    <div class="busy-indicator">
                      <RelayIcon :class="['relay-icon', relayIconClass]" />
                    </div>
                    <div class="end-spacer" />
                  </template>
                </div>
              </div>
            </template>
            <div ref="endEl" />
          </template>

          <!-- Jump to latest button (floating over messages) -->
          <Transition name="jump-button">
            <div v-if="showJumpToLatest" class="jumpToLatestContainer">
              <button class="jumpToLatestButton" @click="jumpToLatest">
                <span class="codicon codicon-arrow-down"></span>
              </button>
            </div>
          </Transition>

          <div class="bottom-fade" />
          </div>
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
          <template v-if="!terminalInputHidden">
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
              :conversation-working="isBusy"
              :attachments="attachments"
              :effort-level="session?.effortLevel.value"
              :permission-mode="session?.permissionMode.value"
              :selected-model="session?.modelSelection.value"
              :selected-agent="session?.agentSelection.value"
              :hide-controls="isTerminalMode"
              :rate-limit-info="rateLimitInfo"
              @submit="handleSubmit"
              @stop="handleStop"
              @add-attachment="handleAddAttachment"
              @remove-attachment="handleRemoveAttachment"
              @mode-select="handleModeSelect"
              @model-select="handleModelSelect"
              @effort-select="handleEffortSelect"
            />
          </template>
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
  import RelayIcon from '@/components/RelayIcon.vue';
  import TerminalView from '../components/TerminalView.vue';
  import MessageRenderer from '../components/Messages/MessageRenderer.vue';
  import StreamingMessage from '../components/Messages/StreamingMessage.vue';
  import UserMessage from '../components/Messages/UserMessage.vue';
  import ToolGroup from '../components/Messages/blocks/ToolGroup.vue';
  import type { ContentBlockWrapper } from '../models/ContentBlockWrapper';
  import { useKeybinding } from '../utils/useKeybinding';
  import { isEditableTarget } from '../utils/keyNormalize';
  import { isGroupableTool } from '../utils/toolGroups';
  import { useSignal } from '@gn8/alien-signals-vue';
  import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
  import { prepareSendAnimation, captureQueueItemSnapshot, type SendSnapshot } from '../composables/useSendAnimation';

  const isTerminalMode = (window as any).RELAY_BOOTSTRAP?.terminalMode === true;
  const terminalInputHidden = isTerminalMode && (window as any).RELAY_BOOTSTRAP?.terminalInputHidden === true;

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

  const relayIconClass = computed(() => {
    if (isBusy.value) {
      if (pendingPermission.value) {
        return 'relay-icon-pending';
      }

      if (isCompacting.value) {
        return 'relay-icon-squeezing';
      }

      return 'relay-icon-working';
    }

    return 'relay-icon-waiting';
  })

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
  const isSessionLoading = computed(() => session.value?.isLoading.value ?? false);

  // Animation runs until the transport connection is established — that's when
  // config is loaded and the model/mode are set, making the UI ready for input.
  const connectionReady = computed(() => !!session.value?.connection.value);

  // panelEverConnected: set true on the first connection, never resets.
  const panelEverConnected = ref(false);
  watch(connectionReady, (ready) => {
    if (ready) panelEverConnected.value = true;
  });

  // keepAnimating drives the startup spin for brand-new panels.
  // Cleared cleanly at the next animation cycle boundary, or immediately when
  // the session is replaced (clear / Shift+Cmd+K) after the panel has connected.
  const keepAnimating = ref(true);
  watch(activeSessionRaw, () => {
    if (panelEverConnected.value) keepAnimating.value = false;
  });

  // Spin during initial startup OR while loading a session from history.
  const showLoadingAnimation = computed(() => keepAnimating.value || isSessionLoading.value);

  function handleIconAnimationIteration() {
    if (panelEverConnected.value) keepAnimating.value = false;
  }
  const sessionError = computed(() => session.value?.error.value ?? null);
  const isCompacting = computed(() => session.value?.compactingMode.value ?? false);
  const currentThinking = computed(() => session.value?.currentThinking.value);
  const streamingText = computed(() => session.value?.streamingText.value);
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

  const usageComputed = computed(() => {
    const s = session.value;
    if (!s) return { percentage: 0, contextTokens: 0, contextWindow: 200000 };

    const usage = s.usageData.value;
    const windowSize = usage.contextWindow || 200000;
    const percentage = (usage.contextTokens > 0)
      ? Math.max(0, Math.min(100, (usage.contextTokens / windowSize) * 100))
      : 0;

    return { percentage, contextTokens: usage.contextTokens, contextWindow: windowSize };
  });

  const progressPercentage = computed(() => usageComputed.value.percentage);

  const rateLimitInfo = computed(() => session.value?.rateLimitInfo.value);

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
  const terminalViewRef = ref<InstanceType<typeof TerminalView> | null>(null);
  let unsubPanelFocus: (() => void) | undefined;
  const containerHeight = ref(0);
  let resizeObserver: ResizeObserver | null = null;

  type ChatSection = {
    key: string;
    header: MessageSegment | null;
    body: MessageSegment[];
  };

  const chatSections = computed((): ChatSection[] => {
    const sections: ChatSection[] = [];
    let current: ChatSection = { key: 'pre', header: null, body: [] };

    for (const seg of messageSegments.value) {
      const isUserHeader =
        seg.type === 'single' &&
        (seg as any).message?.type === 'user' &&
        !(seg as any).message?.isEmpty;

      if (isUserHeader) {
        if (current.header !== null || current.body.length > 0) {
          sections.push(current);
        }
        current = { key: seg.key, header: seg as MessageSegment & { type: 'single' }, body: [] };
      } else {
        current.body.push(seg);
      }
    }

    if (current.header !== null || current.body.length > 0) {
      sections.push(current);
    }

    return sections;
  });

  const lastSectionKey = computed(() => {
    const sections = chatSections.value;
    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i].header !== null) return sections[i].key;
    }
    return null;
  });

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

    // Check whether actual message content is scrolled below the visible area.
    // Using scrollHeight would count the minHeight padding on the last section as
    // scrollable content, causing the button to appear when only blank space is hidden.
    const sectionBodies = container.querySelectorAll<HTMLElement>('.chat-section .section-body');
    const lastSectionBody = sectionBodies[sectionBodies.length - 1] ?? null;
    if (lastSectionBody) {
      const containerRect = container.getBoundingClientRect();
      const bodyRect = lastSectionBody.getBoundingClientRect();
      // Allow 30px of tolerance for the end-spacer and bottom fade.
      const contentHiddenBelow = bodyRect.bottom > containerRect.bottom + 30;
      isUserScrolledUp.value = contentHiddenBelow;
      showJumpToLatest.value = contentHiddenBelow;
      return;
    }

    // Fallback for empty state (no user-message sections).
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

  function scrollToSection(sectionKey: string): void {
    const container = containerEl.value;
    if (!container) return;
    const sectionEl = container.querySelector<HTMLElement>(
      `.chat-section[data-section-key="${sectionKey}"]`
    );
    if (!sectionEl) return;
    isUserScrolledUp.value = true;
    showJumpToLatest.value = true;
    sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  watch(session, async () => {
    await nextTick();
    scrollToBottom(true); // Force scroll on session change
    chatInputRef.value?.focus();
  });

  // When the session loading gate (sessionLoading || isSessionLoading) clears,
  // endEl enters the DOM for the first time — force-scroll so we land at the bottom.
  watch(
    () => sessionLoading.value || isSessionLoading.value,
    (loading) => { if (!loading) scrollToBottom(true); },
    { flush: 'post' }
  );

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
      focusActiveInput();
    }
  });

  function focusActiveInput() {
    if (isTerminalMode) {
      terminalViewRef.value?.focus();
    } else if (!pendingPermission.value) {
      chatInputRef.value?.focus();
    }
  }

  function handleWindowFocus() {
    if (!pendingPermission.value) focusActiveInput();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && !pendingPermission.value) focusActiveInput();
  }

  function handleEditCancelled() {
    chatInputRef.value?.focus();
  }

  function handleSetInput(event: Event) {
    const text = (event as CustomEvent<string>).detail;
    if (text) {
      chatInputRef.value?.setContent(text);
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
      resizeObserver = new ResizeObserver(() => {
        containerHeight.value = container.clientHeight;
      });
      resizeObserver.observe(container);
      containerHeight.value = container.clientHeight;
    }

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('keydown', handleDoubleEscape);
    document.addEventListener('relay:edit-cancelled', handleEditCancelled);
    document.addEventListener('relay:set-input', handleSetInput);

    const conn = await runtime.connectionManager.get();
    unsubPanelFocus = conn.panelFocusedEvents.add(() => {
      if (!pendingPermission.value) focusActiveInput();
    });
  });

  onUnmounted(() => {
    try { unregisterToggle?.(); } catch {}
    unsubPanelFocus?.();

    resizeObserver?.disconnect();

    // Remove scroll listener
    const container = containerEl.value;
    if (container) {
      container.removeEventListener('scroll', checkScrollPosition);
    }

    window.removeEventListener('focus', handleWindowFocus);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.removeEventListener('keydown', handleDoubleEscape);
    document.removeEventListener('relay:edit-cancelled', handleEditCancelled);
    document.removeEventListener('relay:set-input', handleSetInput);
  });

  // ChatInput
  async function handleSubmit(content: string, snapshot?: SendSnapshot | null) {
    const trimmed = (content || '').trim();

    // Handle built-in /clear command
    if (trimmed === '/clear') {
      await runtime!.tabs.replaceCurrentTab();
      return;
    }

    // In terminal mode, forward input directly to the PTY
    if (isTerminalMode) {
      if (trimmed) activeSessionRaw.value?.sendPtyInput(trimmed + '\r');
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

  async function handleRetry() {
    await session.value?.restartClaude();
  }

  // "Interrupt then send" path — triggered by Cmd/Ctrl+Enter.
  async function handleSubmitAndInterrupt(content: string, snapshot?: SendSnapshot | null) {
    const s = session.value;
    if (!s) return;
    try {
      await s.interruptAll();
    } catch (e) {
      console.error('[ChatPage] interrupt before send failed', e);
    }
    await handleSubmit(content, snapshot);
  }

  function handleQueueRemove(id: string) {
    session.value?.removeFromQueue(id);
  }

  function handleQueueSendNow(id: string) {
    void session.value?.interruptAndSendNow(id);
  }


  async function handleModeSelect(mode: PermissionMode) {
    if (isTerminalMode) {
      const rawSession = activeSessionRaw.value;
      if (rawSession) {
        const order: PermissionMode[] = ['default', 'acceptEdits', 'plan'];
        const cur = rawSession.permissionMode() ?? 'default';
        const curIdx = Math.max(0, order.indexOf(cur));
        const targetIdx = order.indexOf(mode);
        if (targetIdx >= 0) {
          const steps = (targetIdx - curIdx + order.length) % order.length;
          for (let i = 0; i < steps; i++) {
            rawSession.sendPtyInput('\x1b[Z');
          }
          rawSession.permissionMode(mode);
        }
      }
      return;
    }
    const s = session.value;
    if (!s) return;

    await s.setPermissionMode(mode);
    chatInputRef.value?.focus();
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

  // shift+tab → permissionMode.toggle (or forward to PTY in terminal mode)
  useKeybinding({
    keys: 'shift+tab',
    handler: () => {
      if (isTerminalMode) {
        activeSessionRaw.value?.sendPtyInput('\x1b[Z');
      } else {
        togglePermissionMode();
      }
    },
    allowInEditable: true,
    priority: 100,
  });

  async function handleModelSelect(modelId: string) {
    if (isTerminalMode) {
      const rawSession = activeSessionRaw.value;
      if (rawSession) {
        rawSession.sendPtyInput(`/model ${modelId}\r`);
        rawSession.modelSelection(modelId);
      }
      return;
    }
    const s = session.value;
    if (!s) return;

    await s.setModel({ value: modelId });
    chatInputRef.value?.focus();
  }

  async function handleEffortSelect(level: string | undefined) {
    if (isTerminalMode) {
      const rawSession = activeSessionRaw.value;
      if (rawSession) {
        if (level) rawSession.sendPtyInput(`/effort ${level}\r`);
        rawSession.effortLevel(level);
      }
      return;
    }
    const s = session.value;
    if (!s) return;

    await s.setEffortLevel(level);
    chatInputRef.value?.focus();
  }

  function handleStop() {
    const s = session.value;
    if (s) {
      // useSession
      void s.interruptAll();
    }
  }

  function handleTurnInterrupt() {
    void session.value?.interrupt();
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

    if (isTerminalMode) {
      // Stage files to disk and inject @path references into the input
      try {
        const connection = await runtime.connectionManager.get();
        for (const file of Array.from(files)) {
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              // Strip the data:...;base64, prefix
              resolve(result.split(',')[1] ?? '');
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          const { filePath } = await connection.stageFile(file.name, data);
          chatInputRef.value?.appendText(`@${filePath}`);
        }
      } catch (e) {
        console.error('[ChatPage] Failed to stage file for terminal:', e);
      }
      chatInputRef.value?.focus();
      return;
    }

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
    chatInputRef.value?.focus();
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
  .terminalContainer {
    flex: 1;
    min-height: 0;
    max-width: 1380px;
    width: 100%;
    align-self: center;
  }

  .messagesContainer {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0px 0 0;
    position: relative;
  }

  .messages-inner {
    max-width: 1400px;
    width: 100%;
    margin: 0 auto;
    min-height: 100%;
    display: flex;
    flex-direction: column;
  }

  .bottom-fade {
    position: sticky;
    bottom: 0;
    height: 7px;
    margin-top: -7px;
    pointer-events: none;
    z-index: 5;
    background: linear-gradient(
      to bottom,
      transparent 0%,
      color-mix(in srgb, var(--vscode-panel-background) 45%, transparent) 100%
    );
  }

  .end-spacer {
    height: 18px;
    flex-shrink: 0;
  }

  /* Mirror AssistantMessage padding so grouped tool messages align with regular messages */
  .tool-group-msg {
    padding: 0 16px 4px;
    background-color: var(--vscode-sideBar-background);
    font-size: 12px;
    line-height: 1.6;
    color: var(--vscode-editor-foreground);
    word-wrap: break-word;
  }

.spinnerRow {
    padding-left: 16px;
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
  .inputContainer {
    padding: 0px 12px;
  }

  .inputContainer {
    flex-shrink: 0;
    max-width: 1400px;
    width: 100%;
    align-self: center;
    position: relative;
    z-index: 20;
  }

  /* */
  .emptyState {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: 32px 16px;
  }

  .emptyWordmark {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 12px;
  }

  .errorBox {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground) 60%, transparent);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    border-radius: 6px;
    margin: 12px;
    padding: 14px;
    max-width: 420px;
  }

  .errorBoxIcon {
    color: var(--vscode-inputValidation-errorForeground, #f48771);
    font-size: 14px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .errorBoxText {
    color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
    font-size: 12px;
    line-height: 1.5;
    word-break: break-word;
  }

  .retryBtn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    padding: 5px 14px;
    font-size: 12px;
    cursor: pointer;
  }

  .retryBtn:hover {
    background: var(--vscode-button-hoverBackground);
  }

  /* Jump to latest button */
  .jumpToLatestContainer {
    position: sticky;
    bottom: 18px;
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
    padding: 8px;
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

  /* Section-based sticky prompt headers */
  .chat-section {
    /* transparent wrapper — just provides the sticky constraint boundary */
  }

  .section-body {
    padding-top: 6px;
  }

  .section-sticky-header {
    position: sticky;
    top: 0;
    z-index: 10;
    padding-bottom: 6px;
    cursor: pointer;
    background: linear-gradient(
      to bottom,
      var(--vscode-panel-background) 0px,
      var(--vscode-panel-background) calc(100% - 12px),
      transparent 100%
    );
  }

  .relay-icon {
    width: 30px;
    height: 30px;
    color: #D97757;
  }

  .busy-indicator {
    display: flex;
    justify-content: center;
    padding: 6px;
  }

  .relay-icon-loading {
    width: 60px;
    height: 60px;
    color: #D97757;
  }

  .relay-icon-working {
    animation: relay-flip 2.2s ease-in-out infinite;
  }

  .relay-icon-squeezing {
    transform-origin: center bottom;
    animation: relay-squeeze 3s ease-in-out infinite;
  }

  .relay-icon-pending {
    color: #3794ff;
  }

  @keyframes relay-squeeze {
    0%   { transform: scaleY(1)    scaleX(1); }
    35%  { transform: scaleY(0.35) scaleX(1.3); }
    42%  { transform: scaleY(1.2)  scaleX(0.88); }
    49%  { transform: scaleY(0.92) scaleX(1.04); }
    56%  { transform: scaleY(1.04) scaleX(0.98); }
    63%  { transform: scaleY(1)    scaleX(1); }
    100% { transform: scaleY(1)    scaleX(1); }
  }

  @keyframes relay-flip {
    0%   { transform: rotate(0deg); }
    30%  { transform: rotate(235deg); animation-timing-function: ease-out; }
    40%  { transform: rotate(160deg); animation-timing-function: ease-in; }
    47%  { transform: rotate(190deg); animation-timing-function: ease-in; }
    53%  { transform: rotate(180deg); animation-timing-function: ease-in; }
    100% { transform: rotate(180deg); }
  }
</style>
