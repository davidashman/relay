<template>
  <div v-if="hasVisibleContent" class="assistant-message" :class="messageClasses">
    <template v-if="typeof message.message.content === 'string'">
      <ContentBlock :block="{ type: 'text', text: message.message.content }" :context="context" />
    </template>
    <template v-else>
      <template v-for="(segment, index) in segments" :key="index">
        <ToolGroup
          v-if="segment.type === 'tool-group'"
          :wrappers="segment.wrappers"
          :context="context"
        />
        <ContentBlock
          v-else
          :block="segment.wrapper.content"
          :wrapper="segment.wrapper"
          :context="context"
        />
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import type { Message } from '../../models/Message';
import type { ToolContext } from '../../types/tool';
import type { ContentBlockWrapper } from '../../models/ContentBlockWrapper';
import ContentBlock from './ContentBlock.vue';
import ToolGroup from './blocks/ToolGroup.vue';
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

// class
const messageClasses = computed(() => {
  const content = props.message.message.content;

  // content tool_use
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

type Segment =
  | { type: 'single'; wrapper: ContentBlockWrapper }
  | { type: 'tool-group'; wrappers: ContentBlockWrapper[] };

// Edit, Write, and Task always stand alone — they break any current group and are never grouped.
// Task renders as its own inline group (with subagent tool calls indented under the header).
const STANDALONE_TOOLS = new Set(['Edit', 'Write', 'Task']);

// Group consecutive tool_use blocks into ToolGroup segments.
// Edit/Write break out of groups and render individually, starting a fresh group after them.
const segments = computed((): Segment[] => {
  const content = props.message.message.content;
  if (typeof content === 'string' || !Array.isArray(content)) return [];

  const result: Segment[] = [];
  let currentGroup: ContentBlockWrapper[] | null = null;

  for (const wrapper of content) {
    if (wrapper.content.type === 'tool_use' && STANDALONE_TOOLS.has(wrapper.content.name)) {
      // Close any open group, then render this tool standalone
      if (currentGroup) {
        result.push({ type: 'tool-group', wrappers: currentGroup });
        currentGroup = null;
      }
      result.push({ type: 'single', wrapper });
    } else if (wrapper.content.type === 'tool_use') {
      if (!currentGroup) currentGroup = [];
      currentGroup.push(wrapper);
    } else {
      if (currentGroup) {
        result.push({ type: 'tool-group', wrappers: currentGroup });
        currentGroup = null;
      }
      result.push({ type: 'single', wrapper });
    }
  }

  if (currentGroup) {
    result.push({ type: 'tool-group', wrappers: currentGroup });
  }

  return result;
});
</script>

<style scoped>
.assistant-message {
  display: block;
  outline: none;
  padding: 0px 16px 0.4rem 12px;
  background-color: var(--vscode-sideBar-background);
  opacity: 1;
  font-size: 13px;
  line-height: 1.6;
  color: var(--vscode-editor-foreground);
  word-wrap: break-word;
}
</style>
