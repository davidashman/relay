<template>
  <ToolMessageWrapper
    tool-icon="codicon-search"
    :tool-result="toolResult"
  >
    <template #main="{ isExpanded }">
      <span class="tool-label">Glob</span>
      <code v-if="pattern" class="pattern-text">{{ pattern }}</code>
      <span v-if="toolResult && !isExpanded" class="result-summary">{{ fileCount }} {{ fileCount === 1 ? 'file' : 'files' }}</span>
    </template>

    <template #expandable>
      <div v-if="globPath" class="detail-item">
        <span class="detail-label">Path:</span>
        <span class="detail-value">{{ globPath }}</span>
      </div>

      <div v-if="resultFiles.length > 0" class="results-section">
        <div class="detail-label">
          <span>Found {{ fileCount }} files:</span>
        </div>
        <div class="file-list">
          <ToolFilePath
            v-for="(file, index) in resultFiles"
            :key="index"
            :file-path="file"
            :context="context"
          />
        </div>
        <span v-if="truncated" class="truncated-notice">Results are truncated. Consider using a more specific path or pattern.</span>
      </div>
      <div v-else-if="toolResult" class="results-section">
        <div class="detail-label">Found 0 files</div>
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

const TRUNCATED_RE = /Results are truncated/i;

const resultFiles = computed(() => {
  if (!props.toolResult?.content) return [];

  const content = props.toolResult.content;

  if (Array.isArray(content)) {
    return [...content].filter(item => !TRUNCATED_RE.test(item)).sort((a, b) => a.localeCompare(b));
  }

  if (typeof content === 'string') {
    return content.split('\n').filter(line => line.trim() && !TRUNCATED_RE.test(line)).sort((a, b) => a.localeCompare(b));
  }

  return [];
});

const truncated = computed(() => {
  const content = props.toolResult?.content;
  if (!content) return false;
  if (Array.isArray(content)) return content.some(item => TRUNCATED_RE.test(item));
  if (typeof content === 'string') return TRUNCATED_RE.test(content);
  return false;
});

const fileCount = computed(() => resultFiles.value.length);
</script>

<style scoped>
.tool-label {
  font-weight: 500;
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family);
  font-size: 1em;
}

.pattern-text {
  display: inline-flex;
  align-items: center;
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-charts-yellow);
  background-color: color-mix(in srgb, var(--vscode-charts-yellow) 15%, transparent);
  padding: 3px 6px;
  border-radius: 3px;
  font-weight: 500;
  font-size: 1em;
  line-height: 1;
}

.result-summary {
  font-size: 0.85em;
  color: color-mix(in srgb, var(--vscode-foreground) 60%, transparent);
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
}

.detail-value {
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family);
  word-break: break-all;
}

.results-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 0;
  font-size: 0.85em;
}

.file-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.truncated-notice {
  color: color-mix(in srgb, var(--vscode-foreground) 60%, transparent);
  font-style: italic;
}
</style>
