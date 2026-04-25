<template>
  <component
    :is="toolComponent"
    :tool-use="toolUse"
    :tool-result="toolResult"
    :tool-use-result="toolUseResult"
    :wrapper="wrapper"
    :context="context"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import type { ToolUseContentBlock } from '../../../models/ContentBlock';
import type { ContentBlockWrapper } from '../../../models/ContentBlockWrapper';
import type { ToolContext } from '../../../types/tool';

import AskUserQuestionTool from './tools/AskUserQuestion.vue';
import ReadTool from './tools/Read.vue';
import WriteTool from './tools/Write.vue';
import EditTool from './tools/Edit.vue';
import BashTool from './tools/Bash.vue';
import GlobTool from './tools/Glob.vue';
import GrepTool from './tools/Grep.vue';
import BashOutputTool from './tools/BashOutput.vue';
import ExitPlanModeTool from './tools/ExitPlanMode.vue';
import KillShellTool from './tools/KillShell.vue';
import McpTool from './tools/McpTool.vue';
import MultiEditTool from './tools/MultiEdit.vue';
import NotebookEditTool from './tools/NotebookEdit.vue';
import SlashCommandTool from './tools/SlashCommand.vue';
import AgentTool from './tools/Agent.vue';
import TodoWriteTool from './tools/TodoWrite.vue';
import WebFetchTool from './tools/WebFetch.vue';
import WebSearchTool from './tools/WebSearch.vue';
import DefaultTool from './tools/Default.vue';

interface Props {
  block: ToolUseContentBlock;
  context?: ToolContext;
  wrapper?: ContentBlockWrapper;
}

const props = defineProps<Props>();

// 🔥 useSignal alien-signals Vue
const toolResult = props.wrapper ? useSignal(props.wrapper.toolResult) : ref(undefined);

// tool use result
const toolUseResult = computed(() => {
  if (!props.wrapper) return undefined;
  return props.wrapper.toolUseResult;
});

// Tool
const toolUse = computed(() => {
  return {
    name: props.block.name,
    input: props.block.input,
    id: props.block.id,
  };
});

const toolComponent = computed(() => {
  const name = props.block.name;

  // MCP mcp__
  if (name.startsWith('mcp__')) {
    return McpTool;
  }

  switch (name) {
    case 'AskUserQuestion':
      return AskUserQuestionTool;
    case 'Read':
      return ReadTool;
    case 'Write':
      return WriteTool;
    case 'Edit':
      return EditTool;
    case 'Bash':
      return BashTool;
    case 'Glob':
      return GlobTool;
    case 'Grep':
      return GrepTool;
    case 'BashOutput':
      return BashOutputTool;
    case 'ExitPlanMode':
      return ExitPlanModeTool;
    case 'KillShell':
      return KillShellTool;
    case 'MultiEdit':
      return MultiEditTool;
    case 'NotebookEdit':
      return NotebookEditTool;
    case 'SlashCommand':
      return SlashCommandTool;
    case 'Agent':
    case 'Task':
      return AgentTool;
    case 'TodoWrite':
      return TodoWriteTool;
    case 'WebFetch':
      return WebFetchTool;
    case 'WebSearch':
      return WebSearchTool;
    default:
      return DefaultTool;
  }
});
</script>

<style scoped>
/* */
</style>
