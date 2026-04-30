<template>
  <ToolMessageWrapper
    tool-icon="codicon-new-file"
    tool-name="Write"
    :tool-result="toolResult"
    :default-expanded="shouldExpand"
    :class="{ 'has-content-view': hasContentView }"
  >
    <template #main>
      <span class="tool-label">Write</span>
      <ToolFilePath v-if="filePath" :file-path="filePath" :context="context" />
      <span v-if="contentStats" class="content-stats">
        <span class="stat-lines">+{{ contentStats.lines }}</span>
      </span>
    </template>

    <template #expandable>
      <div v-if="content && !toolResult?.is_error" class="write-view">
        <div v-if="filePath" class="write-file-header">
          <FileIcon :file-name="filePath" :size="16" class="file-icon" />
          <span class="file-name">{{ fileName }}</span>
        </div>

        <div v-if="isMarkdown" class="markdown-preview">
          <div class="markdown-content" v-html="renderedContent" />
        </div>

        <div v-else class="write-scroll-container">
          <div ref="lineNumbersRef" class="write-line-numbers">
            <div
              v-for="n in lineCount"
              :key="n"
              class="line-number-item"
            >
              {{ n }}
            </div>
          </div>

          <div ref="contentRef" class="write-content" @scroll="handleContentScroll">
            <pre class="content-text">{{ content }}</pre>
          </div>
        </div>
      </div>

      <ToolError :tool-result="toolResult" />
    </template>
  </ToolMessageWrapper>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import path from 'path-browserify-esm';
import { marked } from 'marked';
import type { ToolContext } from '@/types/tool';
import ToolMessageWrapper from './common/ToolMessageWrapper.vue';
import ToolError from './common/ToolError.vue';
import ToolFilePath from './common/ToolFilePath.vue';
import FileIcon from '@/components/FileIcon.vue';

interface Props {
  toolUse?: any;
  toolResult?: any;
  toolUseResult?: any;
  context?: ToolContext;
}

const props = defineProps<Props>();

// vcc-re inputs
const filePath = computed(() => {
  return props.toolUse?.input?.file_path || '';
});

const fileName = computed(() => {
  if (!filePath.value) return '';
  return path.basename(filePath.value);
});

// inputs.content
const content = computed(() => {
  return props.toolUse?.input?.content || '';
});

const contentStats = computed(() => {
  if (!content.value) return null;

  const lines = content.value.split('\n').length;
  const chars = content.value.length;

  return { lines, chars };
});

const lineCount = computed(() => {
  if (!content.value) return 0;
  return content.value.split('\n').length;
});

const isMarkdown = computed(() => /\.(md|mdx)$/i.test(filePath.value));

const renderedContent = computed(() => {
  if (!isMarkdown.value || !content.value) return '';
  return marked.parse(content.value) as string;
});

const hasContentView = computed(() => {
  return !!content.value && !props.toolResult?.is_error;
});

const isPermissionRequest = computed(() => {
  // result result =
  return !props.toolResult || !props.toolResult.is_error;
});

const shouldExpand = computed(() => {
  return hasContentView.value && isPermissionRequest.value;
});

// DOM
const lineNumbersRef = ref<HTMLElement>();
const contentRef = ref<HTMLElement>();

function handleContentScroll() {
  if (lineNumbersRef.value && contentRef.value) {
    lineNumbersRef.value.scrollTop = contentRef.value.scrollTop;
  }
}
</script>

<style scoped>
/* error */
.has-content-view :deep(.expandable-content) {
  border-left: none;
  padding: 0;
  margin-left: 0;
}

.tool-label {
  font-weight: 500;
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family);
  font-size: 1em;
}

.content-stats {
  display: flex;
  gap: 4px;
  margin-left: 0px;
  font-size: 0.9em;
  color: var(--vscode-gitDecoration-addedResourceForeground);
}

.stat-lines,
.stat-chars {
  font-family: var(--vscode-editor-font-family);
}

.write-view {
  display: flex;
  flex-direction: column;
  gap: 0;
  font-family: var(--vscode-editor-font-family);
  font-size: 0.85em;
  border: 0.5px solid var(--vscode-widget-border);
  border-bottom-left-radius: 4px;
  border-bottom-right-radius: 4px;
  overflow: hidden;
}

.write-file-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background-color: color-mix(in srgb, var(--vscode-editor-background) 80%, transparent);
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
}

.write-file-header :deep(.mdi),
.write-file-header :deep(.codicon) {
  flex-shrink: 0;
}

.write-file-header .file-name {
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family);
}

.markdown-preview {
  max-height: 400px;
  overflow-y: auto;
  background-color: var(--vscode-editor-background);
  padding: 12px 16px;
}

.markdown-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--vscode-editor-foreground);
  word-wrap: break-word;
}

.markdown-content :deep(p) { margin: 8px 0; }
.markdown-content :deep(h1) { font-size: 18px; font-weight: 600; margin: 16px 0 8px; }
.markdown-content :deep(h2) { font-size: 16px; font-weight: 600; margin: 16px 0 8px; }
.markdown-content :deep(h3) { font-size: 14px; font-weight: 600; margin: 16px 0 8px; }
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) { font-weight: 600; margin: 12px 0 6px; }
.markdown-content :deep(ul),
.markdown-content :deep(ol) { margin: 4px 0 4px 20px; padding: 0; }
.markdown-content :deep(li) { padding: 2px 0; }
.markdown-content :deep(code) {
  font-family: var(--vscode-editor-font-family);
  background-color: color-mix(in srgb, var(--vscode-editor-background) 50%, transparent);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 3px;
  padding: 2px 4px;
}
.markdown-content :deep(pre) {
  background-color: color-mix(in srgb, var(--vscode-editor-background) 50%, transparent);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 12px;
  margin: 8px 0;
  overflow-x: auto;
}
.markdown-content :deep(pre code) { background: none; border: none; padding: 0; }
.markdown-content :deep(blockquote) {
  border-left: 4px solid var(--vscode-textBlockQuote-border);
  background-color: var(--vscode-textBlockQuote-background);
  margin: 8px 0;
  padding: 8px 16px;
}
.markdown-content :deep(table) { border-collapse: collapse; margin: 12px 0; width: 100%; }
.markdown-content :deep(th),
.markdown-content :deep(td) { border: 1px solid var(--vscode-panel-border); padding: 6px 10px; }
.markdown-content :deep(th) { font-weight: 600; background-color: color-mix(in srgb, var(--vscode-editor-background) 30%, transparent); }
.markdown-content :deep(a) { color: var(--vscode-textLink-foreground); }
.markdown-content :deep(hr) { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 12px 0; }

.write-scroll-container {
  display: flex;
  max-height: 400px;
  background-color: var(--vscode-editor-background);
}

/* */
.write-line-numbers {
  width: 50px;
  flex-shrink: 0;
  overflow: hidden;
  background-color: color-mix(in srgb, var(--vscode-editor-background) 95%, transparent);
  border-right: 1px solid var(--vscode-panel-border);
}

.line-number-item {
  height: 22px;
  line-height: 22px;
  padding: 0 8px;
  text-align: right;
  font-family: var(--vscode-editor-font-family);
  font-size: 0.85em;
  color: var(--vscode-editorLineNumber-foreground);
  user-select: none;
}

/* */
.write-content {
  flex: 1;
  overflow: auto;
  position: relative;
}

/* Monaco () */
.write-content::-webkit-scrollbar {
  width: 14px;
  height: 14px;
}

.write-content::-webkit-scrollbar-track {
  background: transparent;
}

.write-content::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: 9px;
  border: 4px solid transparent;
  background-clip: content-box;
}

.write-content:hover::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--vscode-scrollbarSlider-background) 60%, transparent);
}

.write-content::-webkit-scrollbar-thumb:hover {
  background-color: var(--vscode-scrollbarSlider-hoverBackground);
}

.write-content::-webkit-scrollbar-thumb:active {
  background-color: var(--vscode-scrollbarSlider-activeBackground);
}

.write-content::-webkit-scrollbar-corner {
  background: transparent;
}

.content-text {
  background-color: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  font-family: var(--vscode-editor-font-family);
  font-size: 0.85em;
  line-height: 22px;
  margin: 0;
  padding: 0 8px 0 4px;
  white-space: pre;
  min-width: 100%;
  width: fit-content;
}
</style>
