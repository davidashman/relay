<template>
  <ToolMessageWrapper
    tool-icon="codicon-search"
    :tool-result="toolResult"
  >
    <template #main>
      <span class="tool-label">Glob</span>
      <code v-if="pattern" class="pattern-text">{{ pattern }}</code>
    </template>

    <template #expandable>
      <div v-if="globPath" class="detail-item">
        <span class="detail-label">Path:</span>
        <span class="detail-value">{{ globPath }}</span>
      </div>

      <div v-if="resultFiles.length > 0" class="detail-item">
        <div class="detail-label">
          <span>Found {{ fileCount }} files:</span>
        </div>
        <div class="file-list">
          <ToolFilePath
            v-for="(file, index) in resultFiles"
            :key="index"
            :file-path="file"
            :context="context"
            class="file-item"
          />
        </div>
      </div>

      <ToolError :tool-result="toolResult" />
    </template>
  </ToolMessageWrapper>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ToolContext } from '@/types/tool';
import ToolMessageWrapper from './common/ToolMessageWrapper.vue';
import ToolError from './common/ToolError.vue';
import ToolFilePath from './common/ToolFilePath.vue';

interface Props {
  toolUse?: any;
  toolResult?: any;
  toolUseResult?: any;
  context?: ToolContext;
}

const props = defineProps<Props>();

const pattern = computed(() => {
  return props.toolUse?.input?.pattern;
});

const globPath = computed(() => {
  return props.toolUse?.input?.path || '.';
});

const resultFiles = computed(() => {
  if (!props.toolResult?.content) return [];

  const content = props.toolResult.content;

  if (Array.isArray(content)) {
    return content;
  }

  if (typeof content === 'string') {
    return content.split('\n').filter(line => line.trim());
  }

  return [];
});

const fileCount = computed(() => resultFiles.value.length);
</script>

<style scoped>
.tool-label {
  font-weight: 500;
  color: var(--vscode-foreground);
  font-size: 0.9em;
}

.pattern-text {
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-charts-orange);
  background-color: color-mix(in srgb, var(--vscode-charts-orange) 15%, transparent);
  padding: 4px 5px 2px;
  border-radius: 3px;
  font-weight: 500;
  font-size: 0.9em;
  line-height: 1;
}

.detail-item {
  display: flex;
  gap: 8px;
  font-size: 0.85em;
  padding: 4px 0;
}

.detail-label {
  color: color-mix(in srgb, var(--vscode-foreground) 70%, transparent);
  font-weight: 500;
  min-width: 80px;
}

.detail-value {
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family);
  word-break: break-all;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-item {
  /* background-color: color-mix(in srgb, var(--vscode-foreground) 5%, transparent); */
  font-size: 0.9em;
}
</style>
