<template>
  <div class="user-message">
    <div class="message-wrapper">
      <div
        ref="containerRef"
        class="message-content"
        :class="{ editing: isEditing }"
      >
        <!-- 普通显示模式 -->
        <div
          v-if="!isEditing"
          class="message-view"
          role="button"
          tabindex="0"
          @click.stop="startEditing"
          @keydown.enter.prevent="startEditing"
          @keydown.space.prevent="startEditing"
        >
          <div
            v-if="displayAttachments.length > 0"
            class="attachment-tiles"
          >
            <button
              v-for="attachment in displayAttachments"
              :key="attachment.id"
              type="button"
              class="attachment-tile"
              :title="attachment.fileName"
              @click.stop="handleOpenAttachment(attachment)"
            >
              <FileIcon :file-name="attachment.fileName" :size="14" />
              <span class="attachment-tile-name">{{ attachment.fileName }}</span>
            </button>
          </div>
          <div class="message-text">
            <div>{{ displayContent }}</div>
            <Tooltip content="Restore checkpoint">
              <button
                class="restore-button"
                @click.stop="handleRestore"
              >
                <span class="codicon codicon-restore"></span>
              </button>
            </Tooltip>
          </div>
        </div>

        <!-- 编辑模式 -->
        <div v-else class="edit-mode">
          <ChatInputBox
            :show-progress="false"
            :conversation-working="false"
            :attachments="attachments"
            :selected-model="sessionModel"
            :thinking-level="sessionThinkingLevel"
            :permission-mode="sessionPermissionMode"
            ref="chatInputRef"
            @submit="handleSaveEdit"
            @stop="cancelEdit"
            @remove-attachment="handleRemoveAttachment"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, inject } from 'vue';
import type { Message } from '../../models/Message';
import type { ToolContext } from '../../types/tool';
import type { AttachmentItem } from '../../types/attachment';
import Tooltip from '../Common/Tooltip.vue';
import ChatInputBox from '../ChatInputBox.vue';
import FileIcon from '../FileIcon.vue';
import { RuntimeKey } from '../../composables/runtimeContext';

interface Props {
  message: Message;
  context: ToolContext;
}

const props = defineProps<Props>();

const runtime = inject(RuntimeKey);

const activeSession = computed(() => runtime?.sessionStore?.activeSession?.() ?? null);
const sessionModel = computed(() => activeSession.value?.modelSelection?.value);
const sessionThinkingLevel = computed(() => activeSession.value?.thinkingLevel?.value);
const sessionPermissionMode = computed(() => activeSession.value?.permissionMode?.value);

const isEditing = ref(false);
const chatInputRef = ref<InstanceType<typeof ChatInputBox>>();
const containerRef = ref<HTMLElement>();
const attachments = ref<AttachmentItem[]>([]);

// 显示内容（纯文本）
const displayContent = computed(() => {
  if (typeof props.message.message.content === 'string') {
    return props.message.message.content;
  }
  // 如果是 content blocks，提取文本
  if (Array.isArray(props.message.message.content)) {
    return props.message.message.content
      .map(wrapper => {
        const block = wrapper.content;
        if (block.type === 'text') {
          return block.text;
        }
        return '';
      })
      .join(' ');
  }
  return '';
});

// 用于在普通显示模式下展示附件磁贴
const displayAttachments = computed<AttachmentItem[]>(() => extractAttachments());

function handleOpenAttachment(attachment: AttachmentItem) {
  props.context.fileOpener.openAttachment(
    attachment.fileName,
    attachment.mediaType,
    attachment.data
  );
}

// 从消息内容中提取附件（image 和 document blocks）
function extractAttachments(): AttachmentItem[] {
  if (typeof props.message.message.content === 'string') {
    return [];
  }

  if (!Array.isArray(props.message.message.content)) {
    return [];
  }

  const extracted: AttachmentItem[] = [];
  let index = 0;

  for (const wrapper of props.message.message.content) {
    const block = wrapper.content;

    if (block.type === 'image' && block.source?.type === 'base64') {
      const ext = block.source.media_type?.split('/')[1] || 'png';
      extracted.push({
        id: `image-${index++}`,
        fileName: `image.${ext}`,
        mediaType: block.source.media_type || 'image/png',
        data: block.source.data,
        fileSize: 0, // 历史消息无法获取原始大小
      });
    } else if (block.type === 'document' && block.source) {
      const title = block.title || 'document';
      extracted.push({
        id: `document-${index++}`,
        fileName: title,
        mediaType: block.source.media_type || 'application/octet-stream',
        data: block.source.data,
        fileSize: 0,
      });
    }
  }

  return extracted;
}

async function startEditing() {
  isEditing.value = true;

  // 提取附件
  attachments.value = extractAttachments();

  // 等待 DOM 更新后设置输入框内容和焦点
  await nextTick();
  if (chatInputRef.value) {
    chatInputRef.value.setContent?.(displayContent.value || '');
    chatInputRef.value.focus?.();
  }
}

function handleRemoveAttachment(id: string) {
  attachments.value = attachments.value.filter(a => a.id !== id);
}

function cancelEdit() {
  isEditing.value = false;
  attachments.value = []; // 清空附件列表
}

function handleSaveEdit(content?: string) {
  const finalContent = (content || displayContent.value).trim();

  if (finalContent && runtime) {
    const session = runtime.sessionStore.activeSession();
    if (session) {
      void session.send(finalContent, attachments.value);
    }
  }

  cancelEdit();
}

function handleRestore() {
  const content = displayContent.value.trim();
  if (content && runtime) {
    const session = runtime.sessionStore.activeSession();
    if (session) {
      void session.send(content, []);
    }
  }
}

// 监听键盘事件
function handleKeydown(event: KeyboardEvent) {
  if (isEditing.value && event.key === 'Escape') {
    event.preventDefault();
    cancelEdit();
  }
}

// 监听点击外部取消编辑
function handleClickOutside(event: MouseEvent) {
  if (!isEditing.value) return;

  const target = event.target as HTMLElement;

  // 检查是否点击了组件内部
  if (containerRef.value?.contains(target)) return;

  // 点击外部，取消编辑
  cancelEdit();
}

// 生命周期管理
onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
.user-message {
  display: block;
  outline: none;
  padding: 1px 12px 8px;
  background-color: var(--vscode-sideBar-background);
  opacity: 1;
}

.message-wrapper {
  background-color: transparent;
}

/* 消息内容容器 - 负责背景色和圆角 */
.message-content {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  background-color: color-mix(
    in srgb,
    var(--vscode-sideBar-background) 60%,
    transparent
  );
  outline: none;
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 6px;
  position: relative;
  transition: all 0.2s ease;
}

.message-content.editing {
  z-index: 200;
  border: none;
  background-color: transparent;
}

/* 普通显示模式 */
.message-view {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  cursor: pointer;
  transition: all 0.2s ease;
  gap: 4px;
}

/* 附件磁贴行 */
.attachment-tiles {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 2px 4px;
  scrollbar-width: thin;
}

.attachment-tile {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  max-width: 180px;
  padding: 3px 8px;
  background-color: color-mix(
    in srgb,
    var(--vscode-input-background) 60%,
    transparent
  );
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 10px;
  color: var(--vscode-input-foreground);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.attachment-tile:hover {
  background-color: color-mix(
    in srgb,
    var(--vscode-input-background) 85%,
    transparent
  );
}

.attachment-tile-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.message-view .message-text {
  cursor: pointer;
  background-color: color-mix(
    in srgb,
    var(--vscode-input-background) 60%,
    transparent
  );
  outline: none;
  border-radius: 6px;
  width: 100%;
  padding: 6px 8px;
  box-sizing: border-box;
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.message-view .message-text:hover {
  background-color: color-mix(
    in srgb,
    var(--vscode-input-background) 70%,
    transparent
  );
}

.message-text > div:first-child {
  min-width: 0;
  height: min-content;
  line-height: 1.5;
  font-family: inherit;
  font-size: 13px;
  color: var(--vscode-input-foreground);
  background-color: transparent;
  outline: none;
  border: none;
  overflow-wrap: break-word;
  word-break: break-word;
  padding: 0;
  user-select: text;
  white-space: pre-wrap;
  flex: 1;
}

/* restore checkpoint 按钮 */
.restore-button {
  background: transparent;
  border: none;
  color: var(--vscode-foreground);
  display: flex;
  width: 20px;
  align-items: center;
  justify-content: center;
  line-height: 17px;
  padding: 0 6px;
  height: 26px;
  box-sizing: border-box;
  flex-shrink: 0;
  cursor: pointer;
  border-radius: 3px;
  transition: background-color 0.1s ease;
}

.restore-button:hover {
  background-color: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
}

.restore-button .codicon {
  font-size: 12px;
  color: var(--vscode-foreground);
}

/* 编辑模式 */
.edit-mode {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  position: relative;
  width: 100%;
  box-sizing: border-box;
}

/* 编辑模式下的特定样式覆盖 */
.edit-mode :deep(.full-input-box) {
  background: var(--vscode-input-background);
}

.edit-mode :deep(.full-input-box:focus-within) {
  box-shadow: 0 0 8px 2px
    color-mix(in srgb, var(--vscode-input-background) 30%, transparent);
}
</style>
