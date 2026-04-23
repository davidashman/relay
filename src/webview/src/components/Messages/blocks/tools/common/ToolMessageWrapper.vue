<template>
  <div :class="['tool-message-wrapper', { 'in-collapsed-group': inCollapsedGroup }]">
    <template v-if="isCustomLayout">
      <slot name="custom"></slot>
    </template>

    <template v-else>
      <div
        class="main-line"
        :class="{ 'is-expandable': hasExpandableContent }"
        @click="toggleExpand"
        @mouseenter="isHovered = true"
        @mouseleave="isHovered = false"
      >
        <Tooltip :content="toolName">
          <button class="tool-icon-btn">
            <span
              v-if="!isHovered || !hasExpandableContent"
              class="codicon"
              :class="toolIcon"
            ></span>
            <span
              v-else-if="isExpanded"
              class="codicon codicon-fold"
            ></span>
            <span
              v-else
              class="codicon codicon-chevron-up-down"
            ></span>
          </button>
        </Tooltip>

        <div class="main-content">
          <slot name="main" :is-expanded="isExpanded"></slot>
        </div>

        <!-- Group count badge (shown left of status dot when collapsed) -->
        <span v-if="inCollapsedGroup && toolGroupCount > 0" class="tool-count-badge">+{{ toolGroupCount }}</span>

        <ToolStatusIndicator
          v-if="indicatorState"
          :state="indicatorState"
          class="status-indicator-trailing"
        />
      </div>

      <div v-if="hasExpandableContent && isExpanded" class="expandable-content">
        <slot name="expandable"></slot>
      </div>
    </template>

    <div v-if="permissionState === 'pending'" class="permission-actions">
      <button @click.stop="$emit('deny')" class="btn-reject">
        <span>Reject</span>
      </button>
      <button @click.stop="$emit('allow')" class="btn-accept">
        <span>Accept</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, useSlots, inject, watch, type Ref } from 'vue';
import Tooltip from '@/components/Common/Tooltip.vue';
import ToolStatusIndicator from './ToolStatusIndicator.vue';
import { RuntimeKey } from '@/composables/runtimeContext';

interface Props {
  toolIcon?: string;
  toolName?: string;
  toolResult?: any;
  permissionState?: string;
  defaultExpanded?: boolean;
  isCustomLayout?: boolean;
  alwaysExpanded?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  defaultExpanded: false,
  isCustomLayout: false,
  toolIcon: 'codicon-tools',
  toolName: 'Tool',
  alwaysExpanded: false,
});

defineEmits<{
  allow: [];
  deny: [];
}>();

const runtime = inject(RuntimeKey);
const slots = useSlots();
const toolGroupExpanded = inject<Ref<boolean> | null>('toolGroupExpanded', null);
const toolGroupCount = inject<Ref<number>>('toolGroupCount', ref(0));

const hasExpandableContent = computed(() => {
  // In a collapsed group: disable per-tool expand so clicks bubble up to ToolGroup.
  // Exception: keep expandable when permission is pending so user can see what to approve.
  if (toolGroupExpanded !== null && !toolGroupExpanded.value && props.permissionState !== 'pending') return false;
  return !!slots.expandable || !!props.toolResult?.is_error;
});

const userToggled = ref(false);
const userToggledState = ref(false);

// When permission resolves, reset user toggle so setting takes effect (collapses)
watch(() => props.permissionState, (newState, oldState) => {
  if (oldState === 'pending' && newState !== 'pending') {
    userToggled.value = false;
  }
});

const isExpanded = computed({
  get: () => {
    if (userToggled.value) {
      return userToggledState.value;
    }
    // Permission pending: always expand so user can see what to approve
    if (props.permissionState === 'pending') return true;
    // Errors always expand regardless of setting
    if (props.toolResult?.is_error) return true;
    // Inside an expanded group: force expand so all tools are visible
    if (toolGroupExpanded?.value) return true;
    // File-modifying tools always expand when they have content to show
    if (props.alwaysExpanded && props.defaultExpanded) return true;
    // A block that explicitly opts out of default expansion is always collapsed
    // regardless of the global expandToolOutput setting.
    if (!props.defaultExpanded) return false;
    // Respect the global expandToolOutput setting
    return runtime?.appContext.expandToolOutput ?? true;
  },
  set: (value) => {
    userToggled.value = true;
    userToggledState.value = value;
  },
});

const isHovered = ref(false);

// True when this wrapper is inside a ToolGroup that is currently collapsed.
// In that case the group provides the outer horizontal margin so we skip our own padding.
const inCollapsedGroup = computed(() => toolGroupExpanded !== null && !toolGroupExpanded.value);

const indicatorState = computed<'success' | 'error' | 'pending' | null>(() => {
  if (props.toolResult?.is_error) return 'error';
  if (props.permissionState === 'pending') return 'pending';
  if (props.toolResult) return 'success';
  return null;
});

function toggleExpand() {
  if (hasExpandableContent.value) {
    isExpanded.value = !isExpanded.value;
  }
}
</script>

<style scoped>
.tool-message-wrapper {
  display: flex;
  flex-direction: column;
  padding: 0px 8px 0px 0px;
  font-size: 12px;
}

/* Group provides the margin; don't double-pad inside a collapsed group */
.tool-message-wrapper.in-collapsed-group {
  padding: 0;
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

/* Normalize every direct child on the tool-header row so they have identical
   top/bottom padding and line-height. This guarantees equal box heights and
   prevents 1px chip jitter from sub-pixel rounding when content above
   expands/collapses. Chips already use `padding: 3px 6px` so top/bottom are
   unchanged; plain text spans gain matching 3px vertical padding. */
.main-content > :deep(*) {
  padding-top: 3px;
  padding-bottom: 3px;
  line-height: 1;
}

.tool-count-badge {
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  background-color: color-mix(in srgb, var(--vscode-badge-background) 60%, transparent);
  border-radius: 10px;
  line-height: 18px;
  white-space: nowrap;
  margin-bottom: 1px;
}

.expandable-content {
  padding: 4px 0 0px 16px;
  margin-left: 10px;
  border-left: 1px solid var(--vscode-panel-border);
}

/* */
.permission-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 0 4px;
  margin-left: 26px;
}

.btn-reject,
.btn-accept {
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 1em;
  cursor: pointer;
  border: 1px solid var(--vscode-button-border);
}

.btn-reject {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.btn-reject:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.btn-accept {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.btn-accept:hover {
  background: var(--vscode-button-hoverBackground);
}
</style>
