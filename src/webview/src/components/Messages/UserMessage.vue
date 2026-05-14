<template>
  <div class="user-message" :style="{ '--mode-border-color': modeBorderColor }">
    <div class="message-wrapper">
      <div
        :class="['message-content', { 'active': isActive }]"
      >
        <div
          ref="messageViewRef"
          :class="['message-view', { 'collapsed': isOverflowing && !isExpanded }]"
        >
          <div v-if="displayAttachments.length > 0" class="attachments-list">
            <Tooltip
                v-for="attachment in displayAttachments"
                :key="attachment.id"
                :content="attachment.fileName"
                side="bottom"
            >
              <div
                class="attachment-item"
                :title="attachment.fileName"
                @click.stop="handleOpenAttachment(attachment)"
              >
                <!-- Image: fills tile as thumbnail -->
                <img
                  v-if="attachment.mediaType?.startsWith('image/')"
                  :src="`data:${attachment.mediaType};base64,${attachment.data}`"
                  :alt="attachment.fileName"
                  class="attachment-thumbnail"
                />
                <!-- Non-image: icon + name stacked -->
                <template v-else>
                  <div class="attachment-file-icon">
                    <FileIcon :file-name="attachment.fileName" :size="20" />
                  </div>
                  <span class="attachment-name">{{ attachment.fileName }}</span>
                </template>
              </div>
            </Tooltip>
          </div>
          <div class="message-text">
            <div>{{ displayContent }}</div>
          </div>
        </div>
        <button
          v-if="isOverflowing"
          :class="['expand-button', { 'is-collapsed': !isExpanded }]"
          @click.stop="toggleExpand"
        >
          <span :class="['codicon', isExpanded ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
        </button>
        <Tooltip v-if="isActive" content="Cancel prompt" side="top">
          <button
            class="restore-button interrupt-button"
            @click.stop="emit('interrupt')"
          >
            <span class="codicon codicon-close"></span>
          </button>
        </Tooltip>
        <Tooltip v-else content="Reuse prompt" side="top">
          <button
            class="restore-button"
            @click.stop="handleReplay"
          >
            <span class="codicon codicon-restore"></span>
          </button>
        </Tooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import type { Message } from '../../models/Message';
import type { ToolContext } from '../../types/tool';
import type { AttachmentItem } from '../../types/attachment';
import Tooltip from '../Common/Tooltip.vue';
import FileIcon from '../FileIcon.vue';

interface Props {
  message: Message;
  context: ToolContext;
  pinned?: boolean;
  isActive?: boolean;
  isCompacting?: boolean;
  permissionMode?: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{ interrupt: [] }>();

const messageViewRef = ref<HTMLElement | null>(null);
const isExpanded = ref(false);
const isOverflowing = ref(false);

function checkOverflow() {
  if (!messageViewRef.value) return;
  isOverflowing.value = messageViewRef.value.scrollHeight > window.innerHeight / 3;
}

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  checkOverflow();
  resizeObserver = new ResizeObserver(checkOverflow);
  if (messageViewRef.value) resizeObserver.observe(messageViewRef.value);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});

const modeBorderColor = computed(() => {
  if (props.isActive) {
    switch (props.permissionMode) {
      case 'acceptEdits':
        return 'color-mix(in srgb, #a855f7 45%, transparent)';
      case 'plan':
        return 'color-mix(in srgb, #3b82f6 45%, transparent)';
      default:
        return 'color-mix(in srgb, var(--vscode-foreground) 25%, transparent)';
    }
  }

  return 'var(--vscode-editorWidget-border)';
});

const displayContent = computed(() => {
  if (typeof props.message.message.content === 'string') {
    return props.message.message.content;
  }
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

const displayAttachments = computed<AttachmentItem[]>(() => extractAttachments());

function handleOpenAttachment(attachment: AttachmentItem) {
  props.context.fileOpener.openAttachment(
    attachment.fileName,
    attachment.mediaType,
    attachment.data
  );
}

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
        fileName: block.title || `image.${ext}`,
        mediaType: block.source.media_type || 'image/png',
        data: block.source.data,
        fileSize: 0,
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

function handleReplay() {
  const content = displayContent.value.trim();
  if (content) {
    document.dispatchEvent(new CustomEvent('relay:set-input', { detail: content }));
  }
}
</script>


<style scoped>
.user-message {
  display: block;
  outline: none;
  padding: 12px 12px 0px;
  opacity: 1;
}

.message-wrapper {
  background-color: var(--vscode-panel-background);
  cursor: pointer;
}

.message-content {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  background-color: color-mix(in srgb, var(--vscode-input-background) 50%, transparent);
  outline: none;
  border: 1px solid color-mix(in srgb, var(--vscode-foreground) 30%, transparent);
  border-radius: 6px;
  position: relative;
  transition: all 0.2s ease;
}

.message-content.active {
  overflow: hidden;
  transition: none;
  border-color: color-mix(in srgb, #D97757 50%, transparent) !important;
  background-color: color-mix(in srgb, #D97757 20%, transparent);
}

.message-view {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  gap: 4px;
  padding: 6px 8px;
  box-sizing: border-box;
}

.message-view.collapsed {
  max-height: 33.33vh;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 52px), color-mix(in srgb, black 5%, transparent) calc(100% - 12px), transparent 100%);
  mask-image: linear-gradient(to bottom, black calc(100% - 52px), color-mix(in srgb, black 5%, transparent) calc(100% - 12px), transparent 100%);
}

/* Attachments — matches input box style */
.attachments-list {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  box-sizing: border-box;
  overflow: visible;
  padding: 2px 0px;
}

.attachment-item {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px;
  border-radius: 6px;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
  outline: none;
  overflow: hidden;
  box-sizing: border-box;
  color: var(--vscode-foreground);
}

.attachment-item:hover {
  background-color: var(--vscode-list-hoverBackground);
}

.attachment-thumbnail {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  border-radius: 5px;
}

.attachment-file-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-bottom: 3px;
}

.attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vscode-foreground);
  width: 100%;
  text-align: center;
  font-size: 9px;
  line-height: 1.2;
}

.message-view .message-text {
  background-color: transparent;
  outline: none;
  width: 100%;
  padding-right: 28px;
  box-sizing: border-box;
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.message-text > div:first-child {
  min-width: 0;
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

.expand-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  padding: 0px;
  cursor: pointer;
  color: var(--vscode-foreground);
  opacity: 0.75;
  transition: opacity 0.15s ease, background-color 0.15s ease;
  border-radius: 0 0 5px 5px;
}

.expand-button.is-collapsed {
  margin-top: -26px;
  position: relative;
  z-index: 1;
  border-top: none;
}

.expand-button:hover {
  opacity: 1;
  background-color: var(--vscode-button-hoverBackground);
}

.expand-button .codicon {
  font-size: 22px;
}

/* restore / interrupt */
.restore-button {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--vscode-foreground);
  display: flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  box-sizing: border-box;
  cursor: pointer;
  border-radius: 6px;
  transition: background-color 0.1s ease;
}

.restore-button:hover {
  background-color: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
}

.restore-button .codicon {
  font-size: 12px;
  color: var(--vscode-foreground);
}

.interrupt-button:hover {
  background-color: color-mix(in srgb, var(--vscode-errorForeground) 15%, transparent);
}

.interrupt-button:hover .codicon {
  color: var(--vscode-errorForeground);
}
</style>
