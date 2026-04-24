<template>
  <ToolMessageWrapper
    tool-icon="codicon-grep"
    tool-name="Grep"
    :tool-result="toolResult"
  >
    <template #main="{ isExpanded }">
      <span class="tool-label">Grep</span>
      <code v-if="pattern" class="pattern-text">{{ pattern }}</code>
      <span v-if="resultSummary && !isExpanded" class="result-summary">{{ resultSummary }}</span>
    </template>

    <template #expandable>
      <div v-if="hasSearchOptions" class="options-section">
        <div class="options-grid">
          <div v-if="searchPath" class="option-item">
            <span class="codicon codicon-folder"></span>
            <span class="option-text">Path: {{ searchPath }}</span>
          </div>
          <div v-if="glob" class="option-item">
            <span class="codicon codicon-filter"></span>
            <span class="option-text">Filter: {{ glob }}</span>
          </div>
          <div v-if="fileType" class="option-item">
            <span class="codicon codicon-file-code"></span>
            <span class="option-text">Type: {{ fileType }}</span>
          </div>
          <div v-if="outputMode" class="option-item">
            <span class="codicon codicon-output"></span>
            <span class="option-text">Mode: {{ outputMode }}</span>
          </div>
        </div>
      </div>

      <div v-if="hasFlags" class="flags-section">
        <div class="detail-label">Flags:</div>
        <div class="flags-list">
          <span v-if="caseInsensitive" class="flag-tag">
            <span class="codicon codicon-case-sensitive"></span>
            Case insensitive
          </span>
          <span v-if="multiline" class="flag-tag">
            <span class="codicon codicon-whole-word"></span>
            Multiline
          </span>
          <span v-if="showLineNumbers" class="flag-tag">
            <span class="codicon codicon-list-ordered"></span>
            Line numbers
          </span>
          <span v-if="contextLines" class="flag-tag">
            <span class="codicon codicon-list-tree"></span>
            Context: {{ contextLines }} lines
          </span>
          <span v-if="headLimit" class="flag-tag">
            <span class="codicon codicon-arrow-up"></span>
            Limit: {{ headLimit }}
          </span>
        </div>
      </div>

      <!-- files_with_matches mode (default) -->
      <div v-if="isFilesMode && resultFiles.length > 0" class="results-section">
        <div class="detail-label">Found {{ resultFiles.length }} files:</div>
        <div class="file-list">
          <ToolFilePath
            v-for="(file, index) in resultFiles"
            :key="index"
            :file-path="file"
            :context="context"
          />
        </div>
      </div>
      <div v-else-if="isFilesMode && toolResult" class="results-section">
        <div class="detail-label">Found 0 files</div>
      </div>

      <!-- content mode -->
      <div v-if="isContentMode && contentGroups.length > 0" class="results-section">
        <div class="detail-label">Found {{ totalContentMatches }} {{ totalContentMatches === 1 ? 'match' : 'matches' }} in {{ contentGroups.length }} {{ contentGroups.length === 1 ? 'file' : 'files' }}:</div>
        <div class="content-groups">
          <div v-for="(group, gi) in contentGroups" :key="gi" class="content-group">
            <div class="content-group-header">
              <ToolFilePath :file-path="group.file" :context="context" />
            </div>
            <div class="content-lines">
              <div v-for="(match, mi) in group.matches" :key="mi" class="content-line">
                <span v-if="match.lineNum != null" class="line-num">{{ match.lineNum }}</span>
                <span class="line-text">{{ match.text }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="isContentMode && toolResult" class="results-section">
        <div class="detail-label">Found 0 matches</div>
      </div>

      <!-- count mode -->
      <div v-if="isCountMode && countResults.length > 0" class="results-section">
        <div class="detail-label">Found matches in {{ countResults.length }} {{ countResults.length === 1 ? 'file' : 'files' }}:</div>
        <div class="count-list">
          <div v-for="(item, index) in countResults" :key="index" class="count-item">
            <ToolFilePath :file-path="item.file" :context="context" />
            <span class="count-badge">{{ item.count }}</span>
          </div>
        </div>
      </div>
      <div v-else-if="isCountMode && toolResult" class="results-section">
        <div class="detail-label">Found 0 files</div>
      </div>

      <span v-if="truncated" class="truncated-notice">Results are truncated. Consider using a more specific path or pattern.</span>

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

const pattern = computed(() => props.toolUse?.input?.pattern);
const searchPath = computed(() => props.toolUse?.input?.path);
const glob = computed(() => props.toolUse?.input?.glob);
const fileType = computed(() => props.toolUse?.input?.type);
const outputMode = computed(() => props.toolUse?.input?.output_mode);

const caseInsensitive = computed(() => props.toolUse?.input?.['-i']);
const multiline = computed(() => props.toolUse?.input?.multiline);
const showLineNumbers = computed(() => props.toolUse?.input?.['-n']);
const contextLines = computed(() => {
  return props.toolUse?.input?.['-A'] || props.toolUse?.input?.['-B'] || props.toolUse?.input?.['-C'];
});
const headLimit = computed(() => props.toolUse?.input?.head_limit);

const hasSearchOptions = computed(() => searchPath.value || glob.value || fileType.value || outputMode.value);
const hasFlags = computed(() => caseInsensitive.value || multiline.value || showLineNumbers.value || contextLines.value || headLimit.value);

const isContentMode = computed(() => outputMode.value === 'content');
const isCountMode = computed(() => outputMode.value === 'count');
const isFilesMode = computed(() => !isContentMode.value && !isCountMode.value);

const TRUNCATED_RE = /Results are truncated/i;

// --- files_with_matches ---
const resultFiles = computed(() => {
  if (!isFilesMode.value || !props.toolResult?.content) return [];
  const content = props.toolResult.content;
  if (typeof content === 'string') {
    return content.split('\n')
      .filter(line => line.trim() && !line.match(/^Found \d+ files?$/i) && !TRUNCATED_RE.test(line))
      .sort((a, b) => a.localeCompare(b));
  }
  if (Array.isArray(content)) {
    return [...content].filter(item => !TRUNCATED_RE.test(item)).sort((a, b) => a.localeCompare(b));
  }
  return [];
});

// --- content mode ---
interface ContentGroup {
  file: string;
  matches: { lineNum?: number; text: string }[];
}

const contentGroups = computed((): ContentGroup[] => {
  if (!isContentMode.value || !props.toolResult?.content) return [];
  const raw = props.toolResult.content;
  if (typeof raw !== 'string') return [];

  const groups: ContentGroup[] = [];
  let current: ContentGroup | null = null;

  for (const line of raw.split('\n')) {
    if (!line || TRUNCATED_RE.test(line)) continue;
    // Separator between match clusters
    if (line === '--') { current = null; continue; }

    // Multi-file with line number: file:linenum:text  or  file:linenum-text (context)
    const multiWithNum = line.match(/^([^:]+):(\d+)[-:](.*)$/);
    if (multiWithNum && !/^\d+$/.test(multiWithNum[1])) {
      const [, file, lineNumStr, text] = multiWithNum;
      if (!current || current.file !== file) {
        current = { file, matches: [] };
        groups.push(current);
      }
      current.matches.push({ lineNum: parseInt(lineNumStr, 10), text });
      continue;
    }

    // Single-file with line number: linenum:text  or  linenum-text (context)
    // Detected when the segment before the first delimiter is all digits.
    const singleWithNum = line.match(/^(\d+)[-:](.*)$/);
    if (singleWithNum) {
      const file = searchPath.value || '';
      if (!current || current.file !== file) {
        current = { file, matches: [] };
        groups.push(current);
      }
      current.matches.push({ lineNum: parseInt(singleWithNum[1], 10), text: singleWithNum[2] });
      continue;
    }

    // Multi-file without line numbers: file:text
    const noNum = line.match(/^([^:]+):(.*)$/);
    if (noNum) {
      const [, file, text] = noNum;
      if (!current || current.file !== file) {
        current = { file, matches: [] };
        groups.push(current);
      }
      current.matches.push({ text });
      continue;
    }

    // Single-file without line numbers: plain content line
    const file = searchPath.value || '';
    if (!current || current.file !== file) {
      current = { file, matches: [] };
      groups.push(current);
    }
    current.matches.push({ text: line });
  }

  return groups;
});

const totalContentMatches = computed(() => contentGroups.value.reduce((sum, g) => sum + g.matches.length, 0));

// --- count mode ---
interface CountResult { file: string; count: number }

const countResults = computed((): CountResult[] => {
  if (!isCountMode.value || !props.toolResult?.content) return [];
  const raw = props.toolResult.content;
  if (typeof raw !== 'string') return [];
  return raw.split('\n')
    .filter(line => line.trim() && !TRUNCATED_RE.test(line))
    .map(line => {
      const m = line.match(/^([^:]+):(\d+)$/);
      return m ? { file: m[1], count: parseInt(m[2], 10) } : null;
    })
    .filter((x): x is CountResult => x !== null);
});

// --- shared ---
const truncated = computed(() => {
  const content = props.toolResult?.content;
  if (!content) return false;
  if (typeof content === 'string') return TRUNCATED_RE.test(content);
  if (Array.isArray(content)) return content.some(item => TRUNCATED_RE.test(item));
  return false;
});

const resultSummary = computed(() => {
  if (!props.toolResult) return '';
  if (isFilesMode.value) {
    const n = resultFiles.value.length;
    return `${n} ${n === 1 ? 'file' : 'files'}`;
  }
  if (isContentMode.value) {
    const n = totalContentMatches.value;
    return `${n} ${n === 1 ? 'match' : 'matches'}`;
  }
  if (isCountMode.value) {
    const n = countResults.value.length;
    return `${n} ${n === 1 ? 'file' : 'files'}`;
  }
  return '';
});
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
  color: var(--vscode-charts-purple);
  background-color: color-mix(in srgb, var(--vscode-charts-purple) 15%, transparent);
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

.options-section,
.flags-section {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 0.85em;
}

.results-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 0;
  font-size: 0.85em;
}

.detail-label {
  color: color-mix(in srgb, var(--vscode-foreground) 70%, transparent);
  font-weight: 500;
}

.options-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--vscode-foreground);
}

.option-item .codicon {
  font-size: 12px;
  color: color-mix(in srgb, var(--vscode-foreground) 70%, transparent);
}

.option-text {
  font-family: var(--vscode-editor-font-family);
}

.flags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.flag-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background-color: color-mix(in srgb, var(--vscode-charts-blue) 15%, transparent);
  color: var(--vscode-charts-blue);
  padding: 3px 6px;
  border-radius: 3px;
  font-size: 1em;
  font-weight: 500;
  line-height: 1;
}

.flag-tag .codicon {
  font-size: 12px;
}

/* files_with_matches */
.file-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* content mode */
.content-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.content-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.content-group-header {
  display: flex;
  align-items: center;
}

.content-lines {
  display: flex;
  flex-direction: column;
  border-left: 2px solid var(--vscode-panel-border);
  margin-left: 4px;
  padding-left: 8px;
}

.content-line {
  display: flex;
  gap: 10px;
  padding: 1px 0;
  font-family: var(--vscode-editor-font-family);
  font-size: 0.95em;
  min-width: 0;
}

.line-num {
  flex-shrink: 0;
  color: color-mix(in srgb, var(--vscode-foreground) 45%, transparent);
  min-width: 2.5em;
  text-align: right;
  user-select: none;
}

.line-text {
  color: var(--vscode-foreground);
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* count mode */
.count-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.count-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.count-badge {
  font-size: 0.85em;
  color: var(--vscode-charts-purple);
  background-color: color-mix(in srgb, var(--vscode-charts-purple) 15%, transparent);
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 500;
  font-family: var(--vscode-editor-font-family);
  flex-shrink: 0;
}

.truncated-notice {
  color: color-mix(in srgb, var(--vscode-foreground) 60%, transparent);
  font-style: italic;
}
</style>
