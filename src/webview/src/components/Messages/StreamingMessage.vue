<template>
  <div class="assistant-message prefix">
    <div class="markdown-content" v-html="renderedMarkdown" />
    <span class="streaming-cursor" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';

interface Props {
  text: string;
}

const props = defineProps<Props>();

marked.setOptions({ gfm: true, breaks: true });

const renderedMarkdown = computed(() => marked.parse(props.text) as string);
</script>

<style scoped>
.assistant-message {
  display: block;
  outline: none;
  padding: 0px 16px 0.4rem 22px;
  background-color: var(--vscode-sideBar-background);
  opacity: 1;
  font-size: 13px;
  line-height: 1.6;
  color: var(--vscode-editor-foreground);
  word-wrap: break-word;
}

.markdown-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--vscode-editor-foreground);
  word-wrap: break-word;
  user-select: text;
  padding: 0 2px;
}

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

.streaming-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  vertical-align: text-bottom;
  background-color: var(--vscode-editor-foreground);
  margin-left: 1px;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
</style>
