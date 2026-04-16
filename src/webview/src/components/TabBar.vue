<template>
  <div class="tab-bar">
    <button class="tab-menu-btn" title="Session history" @click="$emit('menu')">
      <span class="codicon codicon-menu"></span>
    </button>
    <div class="tabs-scroll-area">
      <TabItem
        v-for="(session, index) in tabs"
        :key="session.sessionId() || `new-${index}`"
        :session="session"
        :is-active="index === activeTabIndex"
        @click="$emit('switchTab', index)"
        @close="$emit('closeTab', index)"
      />
    </div>
    <button class="tab-new-btn" title="New conversation" @click="$emit('newTab')">
      <span class="codicon codicon-plus"></span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { defineComponent, h, ref, watch, computed } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import type { Session } from '../core/Session';

defineProps<{
  tabs: Session[];
  activeTabIndex: number;
}>();

defineEmits<{
  menu: [];
  switchTab: [index: number];
  newTab: [];
  closeTab: [index: number];
}>();

const MAX_LEN = 22;

function truncate(s: string | undefined): string {
  if (!s) return 'New Conversation';
  return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN - 1)}\u2026` : s;
}

// TabItem is a sub-component so that useSignal() can be called in its own setup().
// Composables cannot be called inside a v-for in a parent template.
const TabItem = defineComponent({
  name: 'TabItem',
  props: {
    session: { type: Object as () => Session, required: true },
    isActive: { type: Boolean, default: false },
  },
  emits: ['click', 'close'],
  setup(p, { emit }) {
    const summary = useSignal(p.session.summary);
    const busy = useSignal(p.session.busy);
    const permissionRequests = useSignal(p.session.permissionRequests);

    // Track when agent completes work on an inactive tab
    const showCompletedDot = ref(false);

    watch(busy, (newBusy, oldBusy) => {
      if (oldBusy && !newBusy && !p.isActive) {
        showCompletedDot.value = true;
      }
    });

    // Clear completion dot when the user switches to this tab
    watch(() => p.isActive, (active) => {
      if (active) showCompletedDot.value = false;
    });

    const indicator = computed<'permission' | 'completed' | 'none'>(() => {
      if (!p.isActive && (permissionRequests.value?.length ?? 0) > 0) return 'permission';
      if (!p.isActive && showCompletedDot.value) return 'completed';
      return 'none';
    });

    const fullTitle = computed(() => summary.value || 'New Conversation');

    return () =>
      h(
        'button',
        {
          class: ['tab-item', p.isActive ? 'tab-item--active' : ''],
          'data-title': fullTitle.value,
          onClick: () => emit('click'),
        },
        [
          h('span', { class: 'tab-item-label' }, truncate(summary.value)),
          h('span', { class: 'tab-item-badge-area' }, [
            indicator.value !== 'none'
              ? h('span', { class: `tab-item-dot tab-item-dot--${indicator.value}` })
              : null,
            h('span', {
              class: 'tab-item-close',
              onClick: (e: MouseEvent) => {
                e.stopPropagation();
                emit('close');
              },
            }, '×'),
          ]),
        ]
      );
  },
});
</script>

<style scoped>
.tab-bar {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  height: 28px;
  min-height: 28px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-panel-background);
  flex-shrink: 0;
}

.tabs-scroll-area {
  display: flex;
  flex-direction: row;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.tabs-scroll-area::-webkit-scrollbar {
  display: none;
}
</style>

<style>
/* Global styles so TabItem's render function h() picks them up */
.tab-item {
  display: inline-flex;
  align-items: center;
  padding: 0 6px 0 12px;
  height: 28px;
  border: none;
  border-right: 1px solid var(--vscode-panel-border);
  background: transparent;
  color: var(--vscode-tab-inactiveForeground, var(--vscode-foreground));
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  max-width: 180px;
  flex-shrink: 0;
  opacity: 0.7;
  transition: background-color 0.1s, opacity 0.1s;
  gap: 4px;
}

.tab-item:hover {
  background: var(--vscode-toolbar-hoverBackground);
  opacity: 0.9;
}

.tab-item--active {
  background: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
  color: var(--vscode-tab-activeForeground, var(--vscode-foreground));
  opacity: 1;
  border-bottom: 2px solid var(--vscode-tab-activeBorderTop, var(--vscode-focusBorder));
}

.tab-item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* Custom tooltip */
.tab-item[data-title] {
  position: relative;
}

.tab-item[data-title]::after {
  content: attr(data-title);
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--vscode-editorHoverWidget-background);
  color: var(--vscode-editorHoverWidget-foreground);
  border: 1px solid var(--vscode-editorHoverWidget-border);
  border-radius: 3px;
  padding: 3px 7px;
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.1s;
  z-index: 100;
}

.tab-item[data-title]:hover::after {
  opacity: 1;
}

/* Fixed-size container that layers the dot and close button */
.tab-item-badge-area {
  position: relative;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.tab-item-dot,
.tab-item-close {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  transition: opacity 0.15s, background-color 0.1s;
}

/* Close button: hidden by default, shown on hover/active */
.tab-item-close {
  font-size: 13px;
  line-height: 1;
  opacity: 0;
}

.tab-item:hover .tab-item-close,
.tab-item--active .tab-item-close {
  opacity: 0.6;
}

.tab-item-close:hover {
  background: var(--vscode-toolbar-hoverBackground);
  opacity: 1 !important;
}

/* Dot indicator: visible by default, hides on tab hover (close takes over) */
.tab-item-dot {
  opacity: 1;
  pointer-events: none;
}

.tab-item:hover .tab-item-dot {
  opacity: 0;
}

.tab-item-dot::after {
  content: '';
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

/* Blue dot — pending permission request */
.tab-item-dot--permission::after {
  background: var(--vscode-notificationsInfoIcon-foreground, #4fc3f7);
}

/* Green dot — agent finished while tab was inactive */
.tab-item-dot--completed::after {
  background: var(--vscode-testing-iconPassed, #4ec9b0);
}

.tab-menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-right: 1px solid var(--vscode-panel-border);
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.7;
  transition: background-color 0.1s, opacity 0.1s;
}

.tab-menu-btn .codicon {
  font-size: 12px;
}

.tab-menu-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
  opacity: 1;
}

.tab-new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-left: 1px solid var(--vscode-panel-border);
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.7;
  transition: background-color 0.1s, opacity 0.1s;
}

.tab-new-btn .codicon {
  font-size: 12px;
}

.tab-new-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
  opacity: 1;
}
</style>
