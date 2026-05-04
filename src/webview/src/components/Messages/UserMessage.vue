<template>
  <div class="user-message">
    <div class="message-wrapper">
      <!--  message-content  -->
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
          <!-- Image: fills tile as thumbnail -->
          <img
            v-if="attachment.mediaType?.startsWith('image/')"
            :src="`data:${attachment.mediaType};base64,${attachment.data}`"
            :alt="attachment.fileName"
            class="attachment-tile-thumbnail"
          />
          <!-- Non-image: icon + name stacked -->
          <template v-else>
            <div class="attachment-tile-icon">
              <FileIcon :file-name="attachment.fileName" :size="20" />
            </div>
            <span class="attachment-tile-name">{{ attachment.fileName }}</span>
          </template>
        </button>
      </div>

      <div
        class="message-content"
        :class="{ 'active-spinner': isActive, 'active-compacting': isActive && isCompacting }"
      >
        <div
          class="message-view"
          :class="{ 'message-view--pinned': pinned }"
        >
          <div class="message-text">
            <div>{{ displayContent }}</div>
            <Tooltip content="Use as input">
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
}

const props = defineProps<Props>();

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
}

/* - */
.message-content {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  background-color: color-mix(in srgb, var(--vscode-sideBar-background) 50%, transparent);
  outline: none;
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 6px;
  position: relative;
  transition: all 0.2s ease;
}

.message-content.active-spinner {
  overflow: hidden;
  transition: none;
}

.message-content.active-spinner::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 40%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(232, 125, 14, 0.08) 20%,
    rgba(232, 125, 14, 0.22) 50%,
    rgba(232, 125, 14, 0.08) 80%,
    transparent 100%
  );
  animation: sweep 3s ease-in-out infinite;
  pointer-events: none;
}

.message-content.active-spinner.active-compacting::before {
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(79, 195, 247, 0.08) 20%,
    rgba(79, 195, 247, 0.22) 50%,
    rgba(79, 195, 247, 0.08) 80%,
    transparent 100%
  );
}

@keyframes sweep {
  0% { transform: translateX(-100%); }
  70% { transform: translateX(250%); }
  100% { transform: translateX(250%); }
}

/* */
.message-view {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  transition: all 0.2s ease;
  gap: 4px;
}

.message-view--pinned {
  cursor: default;
}

/* Attachment tiles */
.attachment-tiles {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 6px;
}

.attachment-tile {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px;
  background: transparent;
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 8px;
  font-family: inherit;
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
  outline: none;
  overflow: hidden;
  box-sizing: border-box;
  color: var(--vscode-foreground);
}

.attachment-tile:hover {
  background-color: var(--vscode-list-hoverBackground);
  border-color: var(--vscode-focusBorder);
}

.attachment-tile-thumbnail {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.attachment-tile-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.attachment-tile-icon :deep(.mdi),
.attachment-tile-icon :deep(.codicon) {
  color: var(--vscode-foreground);
  opacity: 0.8;
}

.attachment-tile-name {
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
  cursor: default;
  background-color: color-mix(
    in srgb,
    var(--vscode-input-background) 50%,
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
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
}

/* restore checkpoint */
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

</style>
