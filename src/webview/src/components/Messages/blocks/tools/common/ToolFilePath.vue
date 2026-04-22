<template>
  <Tooltip :content="fullPath" side="bottom">
    <button
      class="tool-filepath"
      role="button"
      tabindex="0"
      @click="handleClick"
    >
      <span class="filepath-name">{{ fileName }}</span>
    </button>
  </Tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Tooltip from '@/components/Common/Tooltip.vue';
import type { ToolContext } from '@/types/tool';

interface Props {
  filePath: string;
  context?: ToolContext;
  startLine?: number;
  endLine?: number;
}

const props = defineProps<Props>();

const fileName = computed(() => {
  if (!props.filePath) return '';
  return props.filePath.split('/').pop() || props.filePath.split('\\').pop() || props.filePath;
});

const fullPath = computed(() => {
  return props.filePath;
});

function handleClick(event: MouseEvent) {
  event.stopPropagation();
  event.preventDefault();

  if (!props.context?.fileOpener) {
    console.warn('[ToolFilePath] No fileOpener available');
    return;
  }

  props.context.fileOpener.open(props.filePath, {
    startLine: props.startLine,
    endLine: props.endLine,
  });
}
</script>

<style scoped>
/* Pill styling matches Grep .pattern-text and WebSearch .query-text. */
.tool-filepath {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  padding: 3px 6px 2px;
  border-radius: 3px;
  cursor: pointer;
  font-family: var(--vscode-editor-font-family);
  font-size: 1em;
  font-weight: 500;
  color: var(--vscode-textLink-foreground);
  background-color: color-mix(in srgb, var(--vscode-textLink-foreground) 15%, transparent);
  transition: background-color 0.2s;
  line-height: 1;
  margin-bottom: 1px;
}

.tool-filepath:hover {
  background-color: color-mix(in srgb, var(--vscode-textLink-foreground) 25%, transparent);
}

.filepath-name {
  color: inherit;
}
</style>
