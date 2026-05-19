<template>
  <DropdownTrigger
    align="left"
    :width="150"
    :close-on-click-outside="true"
  >
    <template #trigger="{ isOpen }">
      <div :class="['mode-dropdown', `mode-dropdown--${effectiveMode}`, { 'is-open': isOpen }]">
        <div class="dropdown-content">
          <div :class="['codicon', selectedModeIcon, 'dropdown-icon', 'text-[14px]!']" />
          <div class="dropdown-text">
            <span class="dropdown-label">{{ selectedModeLabel }}</span>
          </div>
        </div>
      </div>
    </template>

    <template #content="{ close }">
      <DropdownSectionHeader text="Mode" />
      <DropdownItem
        :item="{
          id: 'default',
          label: 'Ask Permissions',
          icon: 'codicon-question text-[14px]!',
          checked: effectiveMode === 'default',
          type: 'default-mode'
        }"
        :is-selected="effectiveMode === 'default'"
        :index="0"
        @click="(item) => handleModeSelect(item, close)"
      />
      <DropdownItem
        :item="{
          id: 'acceptEdits',
          label: 'Accept Edits',
          icon: 'codicon-infinity text-[14px]!',
          checked: effectiveMode === 'acceptEdits',
          type: 'agent-mode'
        }"
        :is-selected="effectiveMode === 'acceptEdits'"
        :index="1"
        @click="(item) => handleModeSelect(item, close)"
      />
      <DropdownItem
        :item="{
          id: 'plan',
          label: 'Plan Mode',
          icon: 'codicon-todos text-[14px]!',
          checked: effectiveMode === 'plan',
          type: 'plan-mode'
        }"
        :is-selected="effectiveMode === 'plan'"
        :index="2"
        @click="(item) => handleModeSelect(item, close)"
      />
    </template>
  </DropdownTrigger>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { computed as alienComputed } from 'alien-signals'
import { useSignal } from '@gn8/alien-signals-vue'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { DropdownTrigger, DropdownItem, DropdownSectionHeader, type DropdownItemData } from './Dropdown'
import { RuntimeKey } from '../composables/runtimeContext'

interface Props {
  permissionMode?: PermissionMode
}

interface Emits {
  (e: 'modeSelect', mode: PermissionMode): void
}

const props = withDefaults(defineProps<Props>(), {
  permissionMode: undefined
})

const emit = defineEmits<Emits>()

const runtime = inject(RuntimeKey)

const settingsConfig = useSignal(alienComputed(() =>
  runtime?.connectionManager.connection()?.config()
))

const effectiveMode = computed((): PermissionMode => {
  if (props.permissionMode !== undefined) return props.permissionMode
  return (settingsConfig.value?.permissionMode as PermissionMode) ?? 'default'
})

const selectedModeLabel = computed(() => {
  switch (effectiveMode.value) {
    case 'acceptEdits':
      return 'Accept Edits'
    case 'plan':
      return 'Plan Mode'
    default:
      return 'Ask Permissions'
  }
})

const selectedModeIcon = computed(() => {
  switch (effectiveMode.value) {
    case 'acceptEdits':
      return 'codicon-infinity'
    case 'plan':
      return 'codicon-todos'
    default:
      return 'codicon-question'
  }
})

function handleModeSelect(item: DropdownItemData, close: () => void) {
  console.log('Selected mode:', item)
  close()

  emit('modeSelect', item.id as PermissionMode)
}
</script>

<style scoped>
/* Mode - Agent */
.mode-dropdown {
  display: flex;
  gap: 4px;
  font-size: 12px;
  align-items: center;
  line-height: 24px;
  min-width: 0;
  max-width: 100%;
  padding: 2px 0px;
  border-radius: 24px;
  flex-shrink: 0;
  cursor: pointer;
  border: none;
  background: transparent;
  transition: background-color 0.2s ease;
  opacity: .9;
}

.mode-dropdown--default {
  color: var(--vscode-foreground);
}

.mode-dropdown--acceptEdits {
  color: #a855f7;
}

.mode-dropdown--plan {
  color: #3b82f6;
}

.mode-dropdown:hover,
.mode-dropdown.is-open {
  opacity: 1;
}

.dropdown-content {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.dropdown-icon {
  font-size: 14px;
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  display: flex !important;
  align-items: center;
  justify-content: center;
  opacity: 0.5;
}

.dropdown-text {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 12px;
  display: flex;
  align-items: baseline;
  gap: 3px;
  height: 13px;
  font-weight: 400;
}

.dropdown-label {
  opacity: 0.8;
  max-width: 120px;
  overflow: hidden;
  height: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.chevron-icon {
  font-size: 9px;
  flex-shrink: 0;
  opacity: 0.5;
  color: var(--vscode-foreground);
}
</style>
