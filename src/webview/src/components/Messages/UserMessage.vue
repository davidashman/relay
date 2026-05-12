<template>
  <div class="user-message" :style="{ '--mode-border-color': modeBorderColor }">
    <div class="message-wrapper">
      <div
        :class="['message-content', { 'active': isActive }]"
      >
        <div
          class="message-view"
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
import { computed } from 'vue';
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

/* - */
.message-content {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  background-color: color-mix(in srgb, var(--vscode-input-background) 30%, transparent);
  outline: none;
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 6px;
  position: relative;
  transition: all 0.2s ease;
}

.message-content.active {
  overflow: hidden;
  transition: none;
  /* border-color: var(--mode-border-color) !important; */
  border-color: color-mix(in srgb, #D97757 50%, transparent) !important;
  background-color: color-mix(in srgb, #D97757 20%, transparent);
}

/* */
.message-view {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  transition: all 0.2s ease;
  gap: 4px;
  padding: 6px 8px;
  box-sizing: border-box;
  max-height: calc(var(--thread-height, 300px) / 3);
  overflow-y: auto;
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
  /* border: 1px solid var(--vscode-editorWidget-border); */
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
  /* border-color: var(--vscode-focusBorder); */
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

/* restore checkpoint */
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
