<template>
  <!-- Collapsed: one-liner showing the latest tool, click to expand -->
  <div v-if="!isGroupExpanded" class="tool-group-collapsed" @click="isGroupExpanded = true">
    <div class="collapsed-content">
      <ContentBlock
        :block="latestWrapper.content"
        :wrapper="latestWrapper"
        :context="context"
      />
    </div>
  </div>

  <!-- Expanded: all tools rendered normally, each also expanded -->
  <template v-else>
    <ContentBlock
      v-for="(wrapper, index) in wrappers"
      :key="index"
      :block="wrapper.content"
      :wrapper="wrapper"
      :context="context"
    />
  </template>
</template>

<script setup lang="ts">
import { ref, computed, provide, inject } from 'vue';
import type { ContentBlockWrapper } from '../../../models/ContentBlockWrapper';
import type { ToolContext } from '../../../types/tool';
import { RuntimeKey } from '../../../composables/runtimeContext';
import ContentBlock from '../ContentBlock.vue';

interface Props {
  wrappers: ContentBlockWrapper[];
  context?: ToolContext;
}

const props = defineProps<Props>();

const runtime = inject(RuntimeKey);

// Initial state from global expandToolOutput setting
const globalExpand = runtime?.appContext.expandToolOutput ?? true;
const isGroupExpanded = ref(globalExpand);

// Provide the group expansion state so ToolMessageWrapper children can read it
provide('toolGroupExpanded', isGroupExpanded);

// Provide the hidden-tool count so ToolMessageWrapper can render the badge inline
provide('toolGroupCount', computed(() => props.wrappers.length > 1 ? props.wrappers.length - 1 : 0));

// The latest (last) tool in the group is shown in collapsed mode
const latestWrapper = computed(() => props.wrappers[props.wrappers.length - 1]);
</script>

<style scoped>
.tool-group-collapsed {
  position: relative;
  cursor: pointer;
  display: flex;
  align-items: center;
  margin: 0 8px 0 0;
}

.collapsed-content {
  flex: 1;
  min-width: 0;
}

.tool-group-collapsed:hover {
  background-color: color-mix(in srgb, var(--vscode-list-hoverBackground) 15%, transparent);
}

</style>
