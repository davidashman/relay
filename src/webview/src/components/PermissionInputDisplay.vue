<template>
  <component
    :is="toolComponent"
    :tool-use="toolUse"
    :context="context"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ToolContext } from '../types/tool';

import ReadTool from './Messages/blocks/tools/Read.vue';
import WriteTool from './Messages/blocks/tools/Write.vue';
import EditTool from './Messages/blocks/tools/Edit.vue';
import BashTool from './Messages/blocks/tools/Bash.vue';
import GlobTool from './Messages/blocks/tools/Glob.vue';
import GrepTool from './Messages/blocks/tools/Grep.vue';
import BashOutputTool from './Messages/blocks/tools/BashOutput.vue';
import ExitPlanModeTool from './Messages/blocks/tools/ExitPlanMode.vue';
import KillShellTool from './Messages/blocks/tools/KillShell.vue';
import MultiEditTool from './Messages/blocks/tools/MultiEdit.vue';
import NotebookEditTool from './Messages/blocks/tools/NotebookEdit.vue';
import SlashCommandTool from './Messages/blocks/tools/SlashCommand.vue';
import TaskTool from './Messages/blocks/tools/Task.vue';
import TodoWriteTool from './Messages/blocks/tools/TodoWrite.vue';
import WebFetchTool from './Messages/blocks/tools/WebFetch.vue';
import WebSearchTool from './Messages/blocks/tools/WebSearch.vue';
import DefaultTool from './Messages/blocks/tools/Default.vue';

interface Props {
  toolName: string;
  inputs: Record<string, unknown>;
  context?: ToolContext;
}

const props = defineProps<Props>();

const toolUse = computed(() => ({
  name: props.toolName,
  input: props.inputs,
}));

const toolComponent = computed(() => {
  const name = props.toolName;

  switch (name) {
    case 'Read':        return ReadTool;
    case 'Write':       return WriteTool;
    case 'Edit':        return EditTool;
    case 'Bash':        return BashTool;
    case 'Glob':        return GlobTool;
    case 'Grep':        return GrepTool;
    case 'BashOutput':  return BashOutputTool;
    case 'ExitPlanMode': return ExitPlanModeTool;
    case 'KillShell':   return KillShellTool;
    case 'MultiEdit':   return MultiEditTool;
    case 'NotebookEdit': return NotebookEditTool;
    case 'SlashCommand': return SlashCommandTool;
    case 'Task':        return TaskTool;
    case 'TodoWrite':   return TodoWriteTool;
    case 'WebFetch':    return WebFetchTool;
    case 'WebSearch':   return WebSearchTool;
    default:            return DefaultTool;
  }
});
</script>
