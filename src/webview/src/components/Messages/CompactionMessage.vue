<template>
  <div class="compaction-message">
    <ContentBlock
      v-if="block"
      :block="block.content"
      :wrapper="block"
      :context="context"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Message } from '../../models/Message';
import type { ToolContext } from '../../types/tool';
import type { ContentBlockWrapper } from '../../models/ContentBlockWrapper';
import ContentBlock from './ContentBlock.vue';

interface Props {
  message: Message;
  context?: ToolContext;
}

const props = defineProps<Props>();

const block = computed<ContentBlockWrapper | undefined>(() => {
  const content = props.message.message.content;
  if (!Array.isArray(content) || content.length === 0) return undefined;
  return content[0];
});
</script>

<style scoped>
.compaction-message {
  display: block;
  padding: 2px 16px;
  background-color: var(--vscode-sideBar-background);
  font-size: 13px;
  line-height: 1.6;
  color: var(--vscode-editor-foreground);
}
</style>
