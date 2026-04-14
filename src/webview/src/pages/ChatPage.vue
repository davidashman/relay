<template>
  <div class="chat-page">
    <!-- 主体：消息容器 -->
    <div class="main">
      <!-- <div class="chatContainer"> -->
        <div
          ref="containerEl"
          :class="['messagesContainer', 'custom-scroll-container', { dimmed: permissionRequestsLen > 0 }]"
        >
          <template v-if="messages.length === 0">
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
              <MessageRenderer
                v-for="(m, i) in messages"
                :key="m?.id ?? i"
                :message="m"
                :context="toolContext"
              />
            <!-- </div> -->
            <div v-if="isBusy" class="spinnerRow">
              <Spinner :size="16" :permission-mode="permissionMode" :fun-spinner="funSpinner" />
            </div>
            <div v-if="queuedMessages.length > 0" class="queuedMessagesContainer">
              <div v-for="(msg, idx) in queuedMessages" :key="idx" class="queuedMessageRow">
                <div class="queuedMessageBubble">
                  <span class="queuedMessageLabel">Queued</span>
                  <span class="queuedMessageText">{{ msg }}</span>
                  <button class="queuedMessageCancel" @click="queuedMessages.splice(idx, 1)" title="Cancel">✕</button>
                </div>
              </div>
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
          <ChatInputBox
            ref="chatInputRef"
            :show-progress="true"
            :progress-percentage="progressPercentage"
            :context-tooltip="contextTooltip"
            :conversation-working="isBusy"
            :attachments="attachments"
            :thinking-level="session?.thinkingLevel.value"
            :permission-mode="session?.permissionMode.value"
            :selected-model="session?.modelSelection.value"
            @submit="handleSubmit"
            @queue-message="handleQueueMessage"
            @stop="handleStop"
            @add-attachment="handleAddAttachment"
            @remove-attachment="handleRemoveAttachment"
            @thinking-toggle="handleToggleThinking"
            @mode-select="handleModeSelect"
            @model-select="handleModelSelect"
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
  import PermissionRequestModal from '../components/PermissionRequestModal.vue';
  import AskUserQuestionModal from '../components/AskUserQuestionModal.vue';
  import Spinner from '../components/Messages/WaitingIndicator.vue';
  import ClaudeWordmark from '../components/ClaudeWordmark.vue';
  import RandomTip from '../components/RandomTip.vue';
  import MessageRenderer from '../components/Messages/MessageRenderer.vue';
  import { useKeybinding } from '../utils/useKeybinding';
  import { useSignal } from '@gn8/alien-signals-vue';
  import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

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
    },
  }));

  // 订阅 activeSession（alien-signal → Vue ref）
  const activeSessionRaw = useSignal<Session | undefined>(
    runtime.sessionStore.activeSession
  );

  // 使用 useSession 将 alien-signals 转换为 Vue Refs
  const session = computed(() => {
    const raw = activeSessionRaw.value;
    return raw ? useSession(raw) : null;
  });

  // 现在所有访问都使用 Vue Ref（.value）
  const title = computed(() => session.value?.summary.value || 'New Conversation');
  const messages = computed<any[]>(() => session.value?.messages.value ?? []);
  const isBusy = computed(() => session.value?.busy.value ?? false);
  const permissionMode = computed(
    () => session.value?.permissionMode.value ?? 'default'
  );
  const permissionRequests = computed(
    () => session.value?.permissionRequests.value ?? []
  );
  const permissionRequestsLen = computed(() => permissionRequests.value.length);
  const pendingPermission = computed(() => permissionRequests.value[0] as any);
  const platform = computed(() => runtime.appContext.platform);
  const funSpinner = computed(() => runtime.appContext.funSpinner);

  // 注册命令：permissionMode.toggle（在下方定义函数后再注册）

  // 估算 Token 使用占比（基于 usageData）
  const usageComputed = computed(() => {
    const s = session.value;
    if (!s) return { percentage: 0, totalTokens: 0, contextWindow: 200000 };

    const usage = s.usageData.value;
    const total = usage.totalTokens;
    const windowSize = usage.contextWindow || 200000;
    const percentage = (typeof total === 'number' && total > 0)
      ? Math.max(0, Math.min(100, (total / windowSize) * 100))
      : 0;

    return { percentage, totalTokens: total, contextWindow: windowSize };
  });

  const progressPercentage = computed(() => usageComputed.value.percentage);

  const contextTooltip = computed(() => {
    const { totalTokens, contextWindow } = usageComputed.value;
    const fmt = (n: number) => {
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return `${n}`;
    };
    return `${fmt(totalTokens)} / ${fmt(contextWindow)} context used`;
  });

  // Queued messages (submitted while busy)
  const queuedMessages = ref<string[]>([]);

  function handleQueueMessage(content: string) {
    queuedMessages.value.push(content);
  }

  watch(isBusy, async (busy) => {
    if (!busy && queuedMessages.value.length > 0) {
      // Process all queued messages sequentially
      while (queuedMessages.value.length > 0) {
        const msg = queuedMessages.value.shift();
        if (msg) {
          await handleSubmit(msg);
          // Wait for this message to complete before sending the next one
          await new Promise<void>((resolve) => {
            const unwatch = watch(isBusy, (newBusy) => {
              if (!newBusy) {
                unwatch();
                resolve();
              }
            });
          });
        }
      }
    }
  });

  // DOM refs
  const containerEl = ref<HTMLDivElement | null>(null);
  const endEl = ref<HTMLDivElement | null>(null);
  const chatInputRef = ref<InstanceType<typeof ChatInputBox> | null>(null);

  // 附件状态管理
  const attachments = ref<AttachmentItem[]>([]);

  // 记录上次消息数量，用于判断是否需要滚动
  let prevCount = 0;

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
    // 切换会话：复位并滚动底部
    prevCount = 0;
    queuedMessages.value = [];
    await nextTick();
    scrollToBottom(true); // Force scroll on session change
  });

  // moved above

  watch(
    () => messages.value.length,
    async len => {
      const increased = len > prevCount;
      prevCount = len;
      if (increased) {
        await nextTick();
        scrollToBottom(); // Only auto-scroll if near bottom
      }
    }
  );

  watch(queuedMessages, async (val) => {
    if (val.length > 0) {
      await nextTick();
      scrollToBottom(true); // Force scroll to show queued message
    }
  });

  watch(permissionRequestsLen, async (newLen) => {
    // 有权限请求出现时也确保滚动到底部
    await nextTick();
    scrollToBottom(); // Only auto-scroll if near bottom
    // Restore focus to input after last permission modal is dismissed
    if (newLen === 0) {
      chatInputRef.value?.focus();
    }
  });

  onMounted(async () => {
    prevCount = messages.value.length;
    await nextTick();
    scrollToBottom(true); // Force scroll on mount
    chatInputRef.value?.focus();

    // Add scroll listener to track user scroll position
    const container = containerEl.value;
    if (container) {
      container.addEventListener('scroll', checkScrollPosition);
    }
  });

  onUnmounted(() => {
    try { unregisterToggle?.(); } catch {}

    // Remove scroll listener
    const container = containerEl.value;
    if (container) {
      container.removeEventListener('scroll', checkScrollPosition);
    }
  });

  // ChatInput 事件处理
  async function handleSubmit(content: string) {
    const trimmed = (content || '').trim();

    // Handle built-in /clear command
    if (trimmed === '/clear') {
      await runtime.tabs.replaceCurrentTab();
      return;
    }

    const s = session.value;
    if (!s || (!trimmed && attachments.value.length === 0) || isBusy.value) return;

    try {
      // 传递附件给 send 方法
      await s.send(trimmed || ' ', attachments.value);

      // 发送成功后清空附件
      attachments.value = [];

      // Scroll to bottom when user submits a prompt
      await nextTick();
      scrollToBottom(true);
    } catch (e) {
      console.error('[ChatPage] send failed', e);
    }
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

  // permissionMode.toggle：按固定顺序轮转
  const togglePermissionMode = () => {
    const s = session.value;
    if (!s) return;
    const order: PermissionMode[] = ['default', 'acceptEdits', 'plan'];
    const cur = (s.permissionMode.value as PermissionMode) ?? 'default';
    const idx = Math.max(0, order.indexOf(cur));
    const next = order[(idx + 1) % order.length];
    void s.setPermissionMode(next);
  };

  // 现在注册命令（toggle 已定义）
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

  // 注册快捷键：shift+tab → permissionMode.toggle（允许在输入区生效）
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

  function handleStop() {
    const s = session.value;
    if (s) {
      // 方法已经在 useSession 中绑定，可以直接调用
      void s.interrupt();
    }
  }

  async function handleAddAttachment(files: FileList) {
    if (!files || files.length === 0) return;

    try {
      // 将所有文件转换为 AttachmentItem
      const conversions = await Promise.all(
        Array.from(files).map(convertFileToAttachment)
      );

      // 添加到附件列表
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

  /* Chat 容器与消息滚动容器（对齐 React） */
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
  .messagesContainer.dimmed {
    filter: blur(1px);
    opacity: 0.5;
    pointer-events: none;
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

  /* 其他样式复用 */

  /* 输入区域容器 */
  .inputContainer {
    padding: 8px 12px 12px;
  }

  /* 底部对话框区域钉在底部 */
  .main > :last-child {
    flex-shrink: 0;
    background-color: var(--vscode-sideBar-background);
    /* border-top: 1px solid var(--vscode-panel-border); */
    max-width: 1200px;
    width: 100%;
    align-self: center;
  }

  /* 空状态样式 */
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

  .queuedMessagesContainer {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .queuedMessageRow {
    padding: 4px 12px 8px;
  }

  .queuedMessageBubble {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
    background: var(--vscode-input-background);
    border: 1px dashed var(--vscode-input-border);
    border-radius: 6px;
    width: 100%;
    box-sizing: border-box;
  }

  .queuedMessageLabel {
    flex-shrink: 0;
    font-size: 11px;
    font-style: italic;
    color: var(--vscode-descriptionForeground);
    opacity: 0.8;
    padding-top: 1px;
  }

  .queuedMessageText {
    flex: 1;
    font-size: 13px;
    font-style: italic;
    color: var(--vscode-descriptionForeground);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .queuedMessageCancel {
    flex-shrink: 0;
    background: none;
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 13px;
    opacity: 0.8;
    padding: 1px 5px;
    line-height: 1.4;
  }

  .queuedMessageCancel:hover {
    opacity: 1;
    background: var(--vscode-button-hoverBackground);
    border-color: var(--vscode-focusBorder);
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
