<template>
  <div class="text-block">
    <div :class="markdownClasses" v-html="renderedMarkdown" @click="handleLinkClick"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import type { TextBlock as TextBlockType } from '../../../models/ContentBlock';
import type { ToolContext } from '../../../types/tool';
import { marked } from 'marked';
import { RuntimeKey } from '../../../composables/runtimeContext';
// import DOMPurify from 'dompurify'; // TODO:

interface Props {
  block: TextBlockType;
  context?: ToolContext;
}

const props = defineProps<Props>();

const runtime = inject(RuntimeKey);

function handleLinkClick(event: MouseEvent) {
  const target = (event.target as HTMLElement).closest('a');
  if (!target) return;

  const href = target.getAttribute('href');
  if (!href) return;

  event.preventDefault();

  // External URLs
  if (/^https?:\/\//i.test(href)) {
    runtime?.appContext.openURL(href);
    return;
  }

  // Relative file paths, optionally with #L42 or #L42-L51 fragment
  const match = href.match(/^([^#]+)(?:#L(\d+)(?:-L(\d+))?)?$/);
  if (match) {
    const filePath = match[1];
    const startLine = match[2] ? parseInt(match[2], 10) : undefined;
    const endLine = match[3] ? parseInt(match[3], 10) : undefined;
    const location = startLine !== undefined ? { startLine, endLine } : undefined;
    runtime?.appContext.fileOpener.open(filePath, location);
  }
}

// Markdown
const markdownClasses = computed(() => {
  const classes = ['markdown-content'];
  if (props.block.isSlashCommand) {
    classes.push('slash-command-text');
  }
  return classes;
});

// marked
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Markdown
const renderedMarkdown = computed(() => {
  const rawHtml = marked.parse(props.block.text) as string;
  // TODO: DOMPurify.sanitize(rawHtml)
  return rawHtml;
});
</script>

<style scoped>
.text-block {
  margin: 0;
  padding: 0;
}

.markdown-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--vscode-editor-foreground);
  word-wrap: break-word;
  user-select: text;
  padding: 0 2px;
}

.slash-command-text {
  color: var(--vscode-textLink-foreground);
  font-weight: 600;
}

/* Markdown - Claudex */
.markdown-content :deep(p) {
  margin: 8px 0;
  line-height: 1.6;
}

.markdown-content :deep(code) {
  font-family: var(--vscode-editor-font-family, 'Hack Nerd Font Mono', 'SF Mono', Consolas, 'Courier New', monospace);
  word-break: break-all;
  cursor: default;
}

.markdown-content :deep(pre) {
  background-color: color-mix(in srgb, var(--vscode-editor-background) 50%, transparent);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 12px;
  margin: 8px 0;
  overflow-x: auto;
}

.markdown-content :deep(pre code) {
  background: none;
  border: none;
  padding: 0;
}

.markdown-content :deep(:not(pre) > code) {
  background-color: color-mix(in srgb, var(--vscode-editor-background) 50%, transparent);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 3px;
  padding: 2px 4px;
  font-size: 1em;
}

.markdown-content :deep(a) {
  color: var(--vscode-textLink-foreground);
  text-decoration: none;
  cursor: pointer;
}

.markdown-content :deep(a:hover) {
  color: var(--vscode-textLink-activeForeground);
  text-decoration: underline;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0px 0px 0px 16px;
  padding: 0px;
}

.markdown-content :deep(li) {
  padding-top: 2px;
  padding-bottom: 2px;
  list-style-type: disc;
}

.markdown-content :deep(blockquote) {
  border-left: 4px solid var(--vscode-textBlockQuote-border);
  background-color: var(--vscode-textBlockQuote-background);
  margin: 8px 0;
  padding: 8px 16px;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  color: var(--vscode-foreground);
  font-weight: 600;
  margin: 16px 0 8px 0;
  line-height: 1.3;
}

.markdown-content :deep(h1) {
  font-size: 18px;
}

.markdown-content :deep(h2) {
  font-size: 16px;
}

.markdown-content :deep(h3) {
  font-size: 14px;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  margin: 16px 0;
  width: 100%;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--vscode-panel-border);
  padding: 8px 12px;
  text-align: left;
}

.markdown-content :deep(th) {
  background-color: color-mix(in srgb, var(--vscode-editor-background) 30%, transparent);
  font-weight: 600;
}
</style>
