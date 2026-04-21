<template>
  <div class="task-wrapper">
    <!-- Task header (purpose line) — always visible -->
    <div
      class="main-line"
      :class="{ 'is-expandable': isInteractive }"
      @click="toggleExpand"
      @mouseenter="isHovered = true"
      @mouseleave="isHovered = false"
    >
      <Tooltip content="Task">
        <button class="tool-icon-btn">
          <span
            v-if="!isHovered || !isInteractive"
            class="codicon codicon-tasklist"
          ></span>
          <span v-else-if="isExpanded" class="codicon codicon-fold"></span>
          <span v-else class="codicon codicon-chevron-up-down"></span>
        </button>
      </Tooltip>

      <div class="main-content">
        <span class="tool-label">Task</span>
        <span v-if="subagentType" class="agent-badge">{{ subagentType }}</span>
        <span v-if="description" class="description-text">{{ description }}</span>
      </div>

      <ToolStatusIndicator
        v-if="indicatorState"
        :state="indicatorState"
        class="status-indicator-trailing"
      />
    </div>

    <!-- Expanded: prompt at top, then every child tool, then error. -->
    <div
      v-if="isExpanded && (prompt || children.length > 0 || hasError)"
      class="task-children"
    >
      <div v-if="prompt" class="prompt-section">
        <div class="section-header">
          <span class="codicon codicon-comment-discussion"></span>
          <span>Prompt</span>
          <Tooltip content="Rerun prompt">
            <button class="rerun-button" @click.stop="handleRerun">
              <span class="codicon codicon-redo"></span>
            </button>
          </Tooltip>
        </div>
        <pre class="prompt-content">{{ prompt }}</pre>
      </div>

      <ContentBlock
        v-for="(child, idx) in children"
        :key="`task-child-${idx}`"
        :block="child.content"
        :wrapper="child"
        :context="context"
      />

      <ToolError :tool-result="toolResult" />
    </div>

    <!-- Collapsed + still running: show only the active (latest) tool as a
         one-liner. Child ToolMessageWrappers see toolGroupExpanded=false, so
         they collapse to a single header row and surface a +N badge inline.
         Once the task completes we drop this row and the group becomes a
         single collapsed line (just the Task header). -->
    <div
      v-else-if="isActive && latestChild"
      class="task-children"
    >
      <ContentBlock
        :block="latestChild.content"
        :wrapper="latestChild"
        :context="context"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, provide, ref, type Ref } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import Tooltip from '@/components/Common/Tooltip.vue';
import ToolError from './common/ToolError.vue';
import ToolStatusIndicator from './common/ToolStatusIndicator.vue';
import ContentBlock from '../../ContentBlock.vue';
import type { ContentBlockWrapper } from '@/models/ContentBlockWrapper';
import type { ToolContext } from '@/types/tool';
import { RuntimeKey } from '@/composables/runtimeContext';

interface Props {
  toolUse?: any;
  toolResult?: any;
  toolUseResult?: any;
  wrapper?: ContentBlockWrapper;
  context?: ToolContext;
}

const props = defineProps<Props>();

const runtime = inject(RuntimeKey);

// Reactive view of the wrapper's childTools signal. The Session hoists
// subagent tool_use blocks onto this list as they stream in, so the Task
// re-renders automatically as more tools run.
// (Cast retains the ContentBlockWrapper class identity — Vue's Ref type
// otherwise strips private-field brands from class instances.)
const children = (
  props.wrapper
    ? useSignal(props.wrapper.childTools)
    : ref<ContentBlockWrapper[]>([])
) as Ref<ContentBlockWrapper[]>;

const latestChild = computed(
  () => children.value[children.value.length - 1]
);

const subagentType = computed(
  () => props.toolUse?.input?.subagent_type ?? props.toolUseResult?.subagent_type
);

const description = computed(
  () => props.toolUse?.input?.description ?? props.toolUseResult?.description
);

const prompt = computed(
  () => props.toolUse?.input?.prompt ?? props.toolUseResult?.prompt
);

const hasError = computed(() => !!props.toolResult?.is_error);

// "Active" = the subagent is still running (no tool_result has come back yet).
// While active and collapsed, we surface the latest child tool as a second
// line under the header. Once the task completes, that row disappears and the
// group collapses to just the Task header.
const isActive = computed(
  () => !props.toolResult && !props.toolUseResult
);

const isInteractive = computed(
  () => children.value.length > 0 || !!prompt.value || hasError.value
);

// Expansion state — user toggle overrides the default.
const userToggled = ref(false);
const userToggledState = ref(false);

const defaultExpanded = computed(() => {
  // Errors auto-expand so they don't hide behind a collapsed header.
  // Everything else (including while streaming) starts collapsed.
  if (hasError.value) return true;
  return false;
});

const isExpanded = computed<boolean>({
  get: () => (userToggled.value ? userToggledState.value : defaultExpanded.value),
  set: (value) => {
    userToggled.value = true;
    userToggledState.value = value;
  },
});

const isHovered = ref(false);

function toggleExpand() {
  if (isInteractive.value) {
    isExpanded.value = !isExpanded.value;
  }
}

// Status dot on the Task header row.
const indicatorState = computed<'success' | 'error' | 'pending' | null>(() => {
  if (hasError.value) return 'error';
  if (isActive.value) return 'pending';
  if (props.toolResult) return 'success';
  return null;
});

// Children consume the existing ToolGroup contract:
//  - toolGroupExpanded=false → child ToolMessageWrapper collapses to its
//    one-line header (and renders the +N badge if there are more hidden).
//  - toolGroupExpanded=true  → every child force-expands.
provide('toolGroupExpanded', isExpanded);
provide(
  'toolGroupCount',
  computed(() => (children.value.length > 1 ? children.value.length - 1 : 0))
);

function handleRerun() {
  const promptText = prompt.value?.trim();
  if (promptText && runtime) {
    const session = runtime.sessionStore.activeSession();
    if (session) {
      void session.send(promptText, []);
    }
  }
}
</script>

<style scoped>
.task-wrapper {
  display: flex;
  flex-direction: column;
  padding: 0px 8px 0px 0px;
}

.main-line {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  min-height: 28px;
  user-select: none;
}

.main-line.is-expandable {
  cursor: pointer;
}

.main-line.is-expandable:hover {
  background-color: color-mix(in srgb, var(--vscode-list-hoverBackground) 30%, transparent);
}

.tool-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 2px;
  color: var(--vscode-foreground);
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.tool-icon-btn .codicon {
  font-size: 16px;
}

.main-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tool-label {
  font-weight: 500;
  color: var(--vscode-foreground);
  font-size: 0.9em;
}

.agent-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 6px 2px;
  background-color: color-mix(in srgb, var(--vscode-charts-orange) 25%, transparent);
  color: var(--vscode-foreground);
  border-radius: 3px;
  font-size: 0.9em;
  font-weight: 500;
  font-family: var(--vscode-editor-font-family);
  line-height: 1;
}

.description-text {
  font-family: var(--vscode-editor-font-family);
  font-size: 0.85em;
  color: color-mix(in srgb, var(--vscode-foreground) 85%, transparent);
  font-style: italic;
}

.status-indicator-trailing {
  flex-shrink: 0;
}

/* Indent child tools (and the prompt/error when expanded) under the header,
   visually grouping them. */
.task-children {
  margin-left: 10px;
  padding-left: 16px;
  border-left: 1px solid var(--vscode-panel-border);
}

.prompt-section {
  padding-top: 4px;
  margin-bottom: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 0.85em;
  font-weight: 600;
  color: color-mix(in srgb, var(--vscode-foreground) 80%, transparent);
}

.rerun-button {
  background: transparent;
  border: none;
  color: color-mix(in srgb, var(--vscode-foreground) 60%, transparent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  cursor: pointer;
  border-radius: 3px;
  transition: background-color 0.1s ease, color 0.1s ease;
}

.rerun-button:hover {
  background-color: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
  color: var(--vscode-foreground);
}

.rerun-button .codicon {
  font-size: 12px;
}

.section-header > .codicon {
  font-size: 14px;
}

.prompt-content {
  background-color: color-mix(in srgb, var(--vscode-editor-background) 80%, transparent);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 8px;
  margin: 0;
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-editor-foreground);
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
  font-size: 0.85em;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
}
</style>
