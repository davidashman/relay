<template>
  <div
    ref="containerRef"
    class="permission-request-container"
    tabIndex="0"
    @keydown="handleContainerKeyDown"
    data-permission-panel="1"
  >
    <div class="tool-title">
      <span class="codicon" :class="toolIcon"></span>
      <span class="tool-name">{{ toolLabel }}</span>
      <span v-if="toolDescription" class="tool-description">{{ toolDescription }}</span>
    </div>
    <div class="permission-header">Do you approve?</div>
    <div class="button-container">
      <button
        class="button"
        :class="{ focused: focusedIndex === 0 }"
        @click="handleApprove"
        @mouseenter="focusedIndex = 0"
      >
        <span class="shortcut-num">1</span> Yes
      </button>
      <button
        v-if="showSecondButton"
        class="button"
        :class="{ focused: focusedIndex === 1 }"
        @click="handleApproveAndDontAsk"
        @mouseenter="focusedIndex = 1"
      >
        <span class="shortcut-num">2</span> Yes, and don't ask again
      </button>
      <button
        class="button"
        :class="{ focused: focusedIndex === (showSecondButton ? 2 : 1) }"
        @click="handleReject"
        @mouseenter="focusedIndex = showSecondButton ? 2 : 1"
      >
        <span class="shortcut-num">{{ showSecondButton ? '3' : '2' }}</span> No
      </button>
      <input
        ref="inputRef"
        class="reject-message-input"
        placeholder="Tell Claude what to do instead"
        v-model="rejectMessage"
        @keydown="handleKeyDown"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { PermissionRequest } from '../core/PermissionRequest';
import type { ToolContext } from '../types/tool';

interface Props {
  request: PermissionRequest;
  context: ToolContext;
  onResolve: (request: PermissionRequest, allow: boolean) => void;
}

const props = defineProps<Props>();

const containerRef = ref<HTMLDivElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const focusedIndex = ref(0);

onMounted(() => {
  containerRef.value?.focus();
});
const rejectMessage = ref('');

const showSecondButton = computed(
  () => props.request.suggestions && props.request.suggestions.length > 0
);

const TOOL_ICONS: Record<string, string> = {
  Bash: 'codicon-terminal',
  Read: 'codicon-eye-two',
  Edit: 'codicon-edit',
  Write: 'codicon-new-file',
  MultiEdit: 'codicon-edit',
  Task: 'codicon-tasklist',
  TodoWrite: 'codicon-checklist',
  Glob: 'codicon-list-tree',
  Grep: 'codicon-search',
  WebFetch: 'codicon-globe',
  WebSearch: 'codicon-globe',
  KillShell: 'codicon-terminal-kill',
  NotebookEdit: 'codicon-notebook',
  ExitPlanMode: 'codicon-milestone',
};

const toolIcon = computed(() => TOOL_ICONS[props.request.toolName] ?? 'codicon-tools');

const toolLabel = computed(() => props.request.toolName);

const toolDescription = computed(() => {
  const inputs = props.request.inputs as Record<string, unknown>;
  const name = props.request.toolName;
  if (name === 'Bash' || name === 'Task') return (inputs.description as string) || '';
  if (name === 'WebSearch') return (inputs.query as string) || '';
  if (name === 'WebFetch') {
    try { return new URL(inputs.url as string).hostname; } catch { return ''; }
  }
  if (name === 'Glob') return (inputs.pattern as string) || '';
  if (name === 'Grep') return (inputs.pattern as string) || '';
  if (inputs.file_path) return (inputs.file_path as string).split('/').pop() || '';
  return '';
});

const handleApprove = () => {
  props.onResolve(props.request, true);
};

const handleApproveAndDontAsk = () => {
  props.request.accept(props.request.inputs, props.request.suggestions || []);
};

const handleReject = () => {
  const trimmedMessage = rejectMessage.value.trim();
  const rejectionMessage = trimmedMessage
    ? `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user provided the following reason for the rejection: ${trimmedMessage}`
    : "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

  props.request.reject(rejectionMessage, !trimmedMessage);
};

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleReject();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    handleReject();
  }
};

const buttonCount = computed(() => (showSecondButton.value ? 3 : 2));

const triggerFocusedButton = () => {
  const idx = focusedIndex.value;
  if (idx === 0) {
    handleApprove();
  } else if (showSecondButton.value && idx === 1) {
    handleApproveAndDontAsk();
  } else {
    handleReject();
  }
};

const handleContainerKeyDown = (e: KeyboardEvent) => {
  if (inputRef.value && document.activeElement === inputRef.value) {
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusedIndex.value = (focusedIndex.value + 1) % buttonCount.value;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusedIndex.value = (focusedIndex.value - 1 + buttonCount.value) % buttonCount.value;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    triggerFocusedButton();
  } else if (e.key === '1') {
    e.preventDefault();
    handleApprove();
  } else if (e.key === '2') {
    e.preventDefault();
    if (showSecondButton.value) {
      handleApproveAndDontAsk();
    } else {
      handleReject();
    }
  } else if (e.key === '3' && showSecondButton.value) {
    e.preventDefault();
    handleReject();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    handleReject();
  }
};
</script>

<style scoped>
.permission-request-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  outline: none;
  margin-bottom: 8px;
  padding-top: 12px;
}

.tool-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}

.tool-title .codicon {
  font-size: 16px;
  flex-shrink: 0;
  color: var(--vscode-foreground);
}

.tool-name {
  font-weight: 500;
  font-size: 0.9em;
  color: var(--vscode-foreground);
}

.tool-description {
  font-size: 0.85em;
  font-style: italic;
  color: color-mix(in srgb, var(--vscode-foreground) 70%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
  margin-bottom: 4px;
}

.button-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}

.button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 8px 12px;
  font-size: 13px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: 1px solid var(--vscode-button-border);
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
  width: 100%;
}

.button:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.button.focused {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.button.focused:hover {
  background: var(--vscode-button-hoverBackground);
}

.shortcut-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 6px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.7;
}

.reject-message-input {
  padding: 8px 12px;
  font-size: 13px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}

.reject-message-input:focus {
  border-color: var(--vscode-focusBorder);
}

.reject-message-input::placeholder {
  color: var(--vscode-input-placeholderForeground);
}
</style>
