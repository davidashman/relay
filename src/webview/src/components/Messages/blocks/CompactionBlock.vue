<template>
  <ToolMessageWrapper
    tool-icon="codicon-archive"
    tool-name="Compacted context"
    :default-expanded="false"
  >
    <template #main>
      <span class="tool-label">Compacted context</span>
      <span v-if="tokenLabel" class="meta">· {{ tokenLabel }}</span>
      <span v-if="triggerLabel" class="meta">· {{ triggerLabel }}</span>
    </template>

    <template v-if="block.summary" #expandable>
      <TextBlock :block="{ type: 'text', text: block.summary }" />
    </template>
  </ToolMessageWrapper>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CompactionBlock as CompactionBlockType } from '../../../models/ContentBlock';
import ToolMessageWrapper from './tools/common/ToolMessageWrapper.vue';
import TextBlock from './TextBlock.vue';

interface Props {
  block: CompactionBlockType;
}

const props = defineProps<Props>();

const tokenLabel = computed(() => {
  const n = props.block.preTokens;
  if (typeof n !== 'number' || n <= 0) return '';
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k tokens`;
  }
  return `${n} tokens`;
});

const triggerLabel = computed(() => props.block.trigger ?? '');
</script>

<style scoped>
.tool-label {
  font-weight: 500;
  color: var(--vscode-foreground);
  font-size: 1em;
}

.meta {
  font-size: 0.85em;
  color: color-mix(in srgb, var(--vscode-foreground) 65%, transparent);
  margin-left: 2px;
}
</style>
