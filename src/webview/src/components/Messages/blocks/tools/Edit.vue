<template>
  <ToolMessageWrapper
    tool-icon="codicon-edit"
    tool-name="Edit"
    :tool-result="toolResult"
    :default-expanded="shouldExpand"
    :always-expanded="true"
    :class="{ 'has-diff-view': hasDiffView }"
  >
    <template #main="{ isExpanded }">
      <span class="tool-label">Edit</span>
      <ToolFilePath v-if="filePath" :file-path="filePath" :context="context" />
      <span v-if="diffStats && !isExpanded" class="diff-stats">
        <span class="stat-add">+{{ diffStats.added }}</span>
        <span class="stat-remove">-{{ diffStats.removed }}</span>
      </span>
    </template>

    <!--  diff  -->
    <template #expandable>
      <div v-if="replaceAll" class="replace-option">
        <span class="codicon codicon-replace-all"></span>
        <span>Replace all</span>
      </div>

      <!-- Markdown inline diff -->
      <div v-if="markdownSegments" class="markdown-diff-view">
        <div v-if="filePath" class="diff-file-header">
          <FileIcon :file-name="filePath" :size="16" class="file-icon" />
          <span class="file-name">{{ fileName }}</span>
        </div>
        <div class="markdown-segments">
          <div
            v-for="(seg, i) in markdownSegments"
            :key="i"
            class="markdown-content"
            :class="`md-segment-${seg.type}`"
            v-html="seg.html"
          />
        </div>
      </div>

      <!-- Diff  -->
      <div v-else-if="structuredPatch && structuredPatch.length > 0" class="diff-view">
        <div v-if="filePath" class="diff-file-header">
          <FileIcon :file-name="filePath" :size="16" class="file-icon" />
          <span class="file-name">{{ fileName }}</span>
          <span v-if="diffStats" class="diff-view-stats">
            <span class="stat-add">+{{ diffStats.added }}</span>
            <span class="stat-remove">-{{ diffStats.removed }}</span>
          </span>
        </div>
        <!-- Diff : +  -->
        <div class="diff-scroll-container">
          <!-- : -->
          <div ref="lineNumbersRef" class="diff-line-numbers">
            <div v-for="(patch, index) in structuredPatch" :key="index">
              <div
                v-for="(line, lineIndex) in patch.lines"
                :key="lineIndex"
                class="line-number-item"
                :class="getDiffLineClass(line)"
              >
                {{ getLineNumber(patch, lineIndex as number) }}
              </div>
            </div>
          </div>

          <!-- :() -->
          <div ref="contentRef" class="diff-content" @scroll="handleContentScroll">
            <div v-for="(patch, index) in structuredPatch" :key="index" class="diff-block">
              <div class="diff-lines">
                <div
                  v-for="(line, lineIndex) in patch.lines"
                  :key="lineIndex"
                  class="diff-line"
                  :class="getDiffLineClass(line)"
                >
                  <span class="line-prefix">{{ getLinePrefix(line) }}</span>
                  <span class="line-content">{{ getLineContent(line) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ToolError :tool-result="toolResult" />
    </template>
  </ToolMessageWrapper>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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

const filePath = computed(() => {
  return props.toolUse?.input?.file_path || '';
});

const fileName = computed(() => {
  if (!filePath.value) return '';
  return path.basename(filePath.value);
});

const replaceAll = computed(() => {
  return props.toolUse?.input?.replace_all;
});

const isMarkdown = computed(() => /\.(md|mdx)$/i.test(filePath.value));

// ref structuredPatch watch
const structuredPatch = ref<any>(null);

// props structuredPatch
watch(
  () => [props.toolUseResult, props.toolUse, props.toolResult],
  () => {

    // diff
    if (props.toolResult?.is_error) {
      structuredPatch.value = null;
      return;
    }

    // toolUseResult structuredPatch ( diff)
    if (props.toolUseResult?.structuredPatch) {
      structuredPatch.value = props.toolUseResult.structuredPatch;
    }
    // input, diff()
    else if (props.toolUse?.input?.old_string && props.toolUse?.input?.new_string) {
      structuredPatch.value = generatePatchFromInput(
        props.toolUse.input.old_string,
        props.toolUse.input.new_string,
        props.toolUse.input._oldStart || 1
      );
    }
  },
  { immediate: true, deep: true }
);

const hasDiffView = computed(() => {
  return structuredPatch.value && structuredPatch.value.length > 0;
});

const markdownSegments = computed(() => {
  if (!isMarkdown.value || !structuredPatch.value?.length) return null;

  type SegType = 'context' | 'removed' | 'added';
  const segments: Array<{ type: SegType; html: string }> = [];
  let currentType: SegType | null = null;
  let currentLines: string[] = [];

  function flush() {
    if (!currentLines.length || !currentType) return;
    segments.push({ type: currentType, html: marked.parse(currentLines.join('\n')) as string });
    currentLines = [];
  }

  for (const patch of structuredPatch.value) {
    for (const line of patch.lines) {
      const content = line.slice(1);
      if (line.startsWith(' ')) {
        if (currentType !== 'context') { flush(); currentType = 'context'; }
        currentLines.push(content);
      } else if (line.startsWith('-')) {
        if (currentType !== 'removed') { flush(); currentType = 'removed'; }
        currentLines.push(content);
      } else if (line.startsWith('+')) {
        if (currentType !== 'added') { flush(); currentType = 'added'; }
        currentLines.push(content);
      }
    }
  }
  flush();
  return segments;
});

// ( diff from input)
const isPermissionRequest = computed(() => {
  const hasToolUseResult = !!props.toolUseResult?.structuredPatch;
  const hasInputDiff = !!(props.toolUse?.input?.old_string && props.toolUse?.input?.new_string);

  return !hasToolUseResult && hasInputDiff;
});

// ,
const shouldExpand = computed(() => {
  const result = hasDiffView.value && isPermissionRequest.value;
  return result;
});

// DOM
const lineNumbersRef = ref<HTMLElement>();
const contentRef = ref<HTMLElement>();

function handleContentScroll() {
  if (lineNumbersRef.value && contentRef.value) {
    lineNumbersRef.value.scrollTop = contentRef.value.scrollTop;
  }
}

// old_string new_string patch
function generatePatchFromInput(oldStr: string, newStr: string, startLine = 1): any[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  const lines: string[] = [];

  oldLines.forEach(line => {
    lines.push('-' + line);
  });

  newLines.forEach(line => {
    lines.push('+' + line);
  });

  return [{
    oldStart: startLine,
    oldLines: oldLines.length,
    newStart: startLine,
    newLines: newLines.length,
    lines
  }];
}

// diff
const diffStats = computed(() => {
  if (!structuredPatch.value) return null;

  let added = 0;
  let removed = 0;

  structuredPatch.value.forEach((patch: any) => {
    patch.lines.forEach((line: string) => {
      if (line.startsWith('+')) added++;
      if (line.startsWith('-')) removed++;
    });
  });

  return { added, removed };
});

// diff
function getDiffLineClass(line: string): string {
  if (line.startsWith('-')) return 'diff-line-delete';
  if (line.startsWith('+')) return 'diff-line-add';
  return 'diff-line-context';
}

function getLinePrefix(line: string): string {
  if (line.startsWith('-') || line.startsWith('+')) {
    return line[0];
  }
  return ' ';
}

function getLineContent(line: string): string {
  if (line.startsWith('-') || line.startsWith('+')) {
    return line.substring(1);
  }
  return line;
}

function getLineNumber(patch: any, lineIndex: number): string {
  const currentLine = patch.lines[lineIndex];

  if (currentLine.startsWith('-')) {
    let oldLine = patch.oldStart;
    for (let i = 0; i < lineIndex; i++) {
      const line = patch.lines[i];
      if (!line.startsWith('+')) {
        oldLine++;
      }
    }
    return String(oldLine);
  } else if (currentLine.startsWith('+')) {
    let newLine = patch.newStart;
    for (let i = 0; i < lineIndex; i++) {
      const line = patch.lines[i];
      if (!line.startsWith('-')) {
        newLine++;
      }
    }
    return String(newLine);
  } else {
    let newLine = patch.newStart;
    for (let i = 0; i < lineIndex; i++) {
      const line = patch.lines[i];
      if (!line.startsWith('-')) {
        newLine++;
      }
    }
    return String(newLine);
  }
}
</script>

<style scoped>
/* diff error */
.has-diff-view :deep(.expandable-content) {
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

.diff-stats {
  display: flex;
  gap: 4px;
  font-size: 0.9em;
  font-weight: 500;
}

.diff-view-stats {
  display: flex;
  gap: 4px;
  font-size: 1em;
  font-weight: 500;
}

.stat-add {
  color: var(--vscode-gitDecoration-addedResourceForeground);
}

.stat-remove {
  color: var(--vscode-gitDecoration-deletedResourceForeground);
}

.markdown-diff-view {
  display: flex;
  flex-direction: column;
  font-size: 0.85em;
  border: .5px solid var(--vscode-widget-border);
  border-bottom-left-radius: 4px;
  border-bottom-right-radius: 4px;
  overflow: hidden;
  margin-top: 2px;
}

.markdown-segments {
  display: flex;
  flex-direction: column;
  max-height: 400px;
  overflow-y: auto;
  background-color: var(--vscode-editor-background);
  padding: 0px 0;
}

.md-segment-context {
  padding: 0px 14px 0px 16px;
}

.md-segment-removed {
  padding: 0px 14px;
  background-color: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground) 15%, transparent);
  border-left: 2px solid var(--vscode-gitDecoration-deletedResourceForeground);
}

.md-segment-added {
  padding: 0px 14px;
  background-color: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 15%, transparent);
  border-left: 2px solid var(--vscode-gitDecoration-addedResourceForeground);
}

.markdown-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--vscode-editor-foreground);
  word-wrap: break-word;
}

.markdown-content :deep(p) { margin: 6px 0; }
.markdown-content :deep(h1) { font-size: 18px; font-weight: 600; margin: 12px 0 6px; }
.markdown-content :deep(h2) { font-size: 16px; font-weight: 600; margin: 12px 0 6px; }
.markdown-content :deep(h3) { font-size: 14px; font-weight: 600; margin: 10px 0 4px; }
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) { font-weight: 600; margin: 8px 0 4px; }
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
  padding: 10px;
  margin: 6px 0;
  overflow-x: auto;
}
.markdown-content :deep(pre code) { background: none; border: none; padding: 0; }
.markdown-content :deep(blockquote) {
  border-left: 4px solid var(--vscode-textBlockQuote-border);
  background-color: var(--vscode-textBlockQuote-background);
  margin: 6px 0;
  padding: 6px 14px;
}
.markdown-content :deep(table) { border-collapse: collapse; margin: 10px 0; width: 100%; }
.markdown-content :deep(th),
.markdown-content :deep(td) { border: 1px solid var(--vscode-panel-border); padding: 5px 10px; }
.markdown-content :deep(th) { font-weight: 600; }
.markdown-content :deep(a) { color: var(--vscode-textLink-foreground); }
.markdown-content :deep(hr) { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 10px 0; }

.replace-option {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--vscode-charts-orange);
  font-size: 0.85em;
  font-weight: 500;
  padding: 4px 0;
}

.replace-option .codicon {
  font-size: 12px;
}

.diff-view {
  display: flex;
  flex-direction: column;
  gap: 0;
  font-family: var(--vscode-editor-font-family);
  font-size: 0.85em;
  border: .5px solid var(--vscode-widget-border);
  border-bottom-left-radius: 4px;
  border-bottom-right-radius: 4px;
  overflow: hidden;
  margin-top: 2px;
}

.diff-file-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background-color: color-mix(in srgb, var(--vscode-editor-background) 80%, transparent);
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
}

.diff-file-header :deep(.mdi),
.diff-file-header :deep(.codicon) {
  flex-shrink: 0;
}

.diff-file-header .file-name {
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family);
}

.diff-scroll-container {
  display: flex;
  max-height: 400px;
  background-color: var(--vscode-editor-background);
}

/* */
.diff-line-numbers {
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
.diff-content {
  flex: 1;
  overflow: auto;
  position: relative;
}

/* Monaco () */
.diff-content::-webkit-scrollbar {
  width: 14px;
  height: 14px;
}

.diff-content::-webkit-scrollbar-track {
  background: transparent;
}

.diff-content::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: 9px;
  border: 4px solid transparent;
  background-clip: content-box;
}

.diff-content:hover::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--vscode-scrollbarSlider-background) 60%, transparent);
}

.diff-content::-webkit-scrollbar-thumb:hover {
  background-color: var(--vscode-scrollbarSlider-hoverBackground);
}

.diff-content::-webkit-scrollbar-thumb:active {
  background-color: var(--vscode-scrollbarSlider-activeBackground);
}

.diff-content::-webkit-scrollbar-corner {
  background: transparent;
}

.diff-block {
  width: 100%;
}

.diff-lines {
  background-color: var(--vscode-editor-background);
  width: fit-content;
  min-width: 100%;
}

.diff-line {
  display: flex;
  font-family: var(--vscode-editor-font-family);
  white-space: nowrap;
  height: 22px;
  line-height: 22px;
}

.line-prefix {
  display: inline-block;
  width: 20px;
  text-align: center;
  padding: 0 4px;
  flex-shrink: 0;
  user-select: none;
}

.line-content {
  flex: 1;
  padding: 0 8px 0 4px;
  white-space: pre;
}

.diff-line-delete {
  background-color: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground) 20%, transparent);
}

.diff-line-delete .line-prefix {
  color: var(--vscode-gitDecoration-deletedResourceForeground);
  background-color: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground) 25%, transparent);
}

.diff-line-delete .line-content {
  color: var(--vscode-gitDecoration-deletedResourceForeground);
}

.diff-line-add {
  background-color: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 20%, transparent);
}

.diff-line-add .line-prefix {
  color: var(--vscode-gitDecoration-addedResourceForeground);
  background-color: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 25%, transparent);
}

.diff-line-add .line-content {
  color: var(--vscode-gitDecoration-addedResourceForeground);
}

.diff-line-context {
  background-color: var(--vscode-editor-background);
}

.diff-line-context .line-prefix {
  color: color-mix(in srgb, var(--vscode-foreground) 40%, transparent);
}

.diff-line-context .line-content {
  color: var(--vscode-editor-foreground);
}
</style>
