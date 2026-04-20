<template>
  <ToolMessageWrapper
    tool-icon="codicon-tasklist"
    tool-name="Plan"
    :tool-result="toolResult"
    :default-expanded="true"
  >
    <template #main>
      <span class="tool-label">Plan</span>
    </template>

    <template #expandable>
      <div v-if="plan" class="plan-content" v-html="renderedPlan"></div>
      <ToolError v-if="toolResult?.is_error" :tool-result="toolResult" />
    </template>
  </ToolMessageWrapper>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import ToolMessageWrapper from './common/ToolMessageWrapper.vue';
import ToolError from './common/ToolError.vue';

interface Props {
  toolUse?: any;
  toolResult?: any;
  toolUseResult?: any;
}

const props = defineProps<Props>();

const plan = computed(() => {
  return props.toolUse?.input?.plan || props.toolUseResult?.plan;
});

const renderedPlan = computed(() => {
  if (!plan.value) return '';
  return marked(plan.value);
});
</script>

<style scoped>
.tool-label {
  font-weight: 500;
  color: var(--vscode-foreground);
  font-size: 0.9em;
}

.plan-content {
  font-family: var(--vscode-editor-font-family);
  font-size: 0.9em;
  line-height: 1.6;
  color: var(--vscode-editor-foreground);
  padding: 4px 0;
}

.plan-content :deep(h1) {
  font-size: 1.4em;
  font-weight: 600;
  margin-bottom: 12px;
  margin-top: 16px;
  color: var(--vscode-foreground);
}

.plan-content :deep(h1:first-child) {
  margin-top: 0;
}

.plan-content :deep(h2) {
  font-size: 1.2em;
  font-weight: 600;
  margin-bottom: 10px;
  margin-top: 16px;
  color: var(--vscode-foreground);
}

.plan-content :deep(h3) {
  font-size: 1.1em;
  font-weight: 600;
  margin-bottom: 8px;
  margin-top: 12px;
  color: var(--vscode-foreground);
}

.plan-content :deep(p) {
  margin-bottom: 8px;
  line-height: 1.6;
}

.plan-content :deep(ul),
.plan-content :deep(ol) {
  margin-bottom: 8px;
  padding-left: 24px;
}

.plan-content :deep(li) {
  margin-bottom: 4px;
}

.plan-content :deep(code) {
  background-color: color-mix(in srgb, var(--vscode-textCodeBlock-background) 50%, transparent);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family);
}

.plan-content :deep(pre) {
  background-color: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 8px;
  overflow-x: auto;
  margin-bottom: 8px;
}

.plan-content :deep(pre code) {
  background: none;
  padding: 0;
}
</style>
