<template>
  <div class="tip-message">
    <!--  block  -->
    <!-- Tip  wrapper  context -->
    <template v-if="Array.isArray(message.message.content)">
      <ContentBlock
        v-for="(wrapper, index) in message.message.content"
        :key="index"
        :block="wrapper.content"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Message } from '../../models/Message';
import type { ToolContext } from '../../types/tool';
import ContentBlock from './ContentBlock.vue';

interface Props {
  message: Message;
  context?: ToolContext; // MessageRenderer  DOM
}

defineProps<Props>();
</script>

<style scoped>
.tip-message {
  display: block;
  outline: none;
  padding: 4px 12px;
  background-color: var(--vscode-sideBar-background);
  opacity: 1;
}
</style>
