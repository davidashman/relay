<template>
  <div v-if="hasVisibleContent" class="assistant-message" :class="messageClasses">
    <template v-if="typeof message.message.content === 'string'">
      <ContentBlock :block="{ type: 'text', text: message.message.content }" :context="context" />
    </template>
    <template v-else>
      <ContentBlock
        v-for="(wrapper, index) in message.message.content"
        :key="index"
        :block="wrapper.content"
        :wrapper="wrapper"
        :context="context"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import type { Message } from '../../models/Message';
import type { ToolContext } from '../../types/tool';
import ContentBlock from './ContentBlock.vue';
import { RuntimeKey } from '../../composables/runtimeContext';

interface Props {
  message: Message;
  context: ToolContext;
}

const props = defineProps<Props>();
const runtime = inject(RuntimeKey);

// Returns true if there is at least one block that will actually be rendered
const hasVisibleContent = computed(() => {
  const content = props.message.message.content;
  if (typeof content === 'string') return !!content;
  if (!Array.isArray(content)) return false;
  const showThinking = runtime?.appContext.showThinking ?? false;
  return content.some(wrapper => wrapper.content.type !== 'thinking' || showThinking);
});

// 计算动态 class
const messageClasses = computed(() => {
  const content = props.message.message.content;

  // content 总是数组，检查是否包含 tool_use
  if (Array.isArray(content)) {
    const showThinking = runtime?.appContext.showThinking ?? false;
    // Show dot only for pure-text messages; suppress for tool_use and visible thinking blocks
    const hasNonTextBlock = content.some(wrapper =>
      wrapper.content.type === 'tool_use' ||
      (wrapper.content.type === 'thinking' && showThinking)
    );
    return hasNonTextBlock ? [] : ['prefix'];
  }

  return [];
});
</script>

<style scoped>
.assistant-message {
  display: block;
  outline: none;
  padding: 0px 16px 0.4rem;
  background-color: var(--vscode-sideBar-background);
  opacity: 1;
  font-size: 13px;
  line-height: 1.6;
  color: var(--vscode-editor-foreground);
  word-wrap: break-word;
  padding-left: 24px;
}

/* 只在纯文本消息时显示圆点 */
.assistant-message.prefix::before {
  content: "\25cf";
  position: absolute;
  left: 8px;
  padding-top: 2px;
  font-size: 10px;
  color: var(--vscode-input-border);
  z-index: 1;
}
</style>
