<template>
  <DropdownTrigger
    align="left"
    :close-on-click-outside="true"
  >
    <template #trigger>
      <div class="effort-dropdown">
        <div class="dropdown-content">
          <div class="dropdown-text">
            <span class="dropdown-label">Effort: {{ selectedLabel }}</span>
          </div>
        </div>
        <div class="codicon codicon-chevron-up chevron-icon text-[12px]!" />
      </div>
    </template>

    <template #content="{ close }">
      <DropdownItem
        v-for="(opt, idx) in options"
        :key="opt.id"
        :item="{
          id: opt.id,
          label: opt.label,
          checked: props.effortLevel === opt.id,
          type: 'effort'
        }"
        :is-selected="props.effortLevel === opt.id"
        :index="idx"
        @click="(item) => handleSelect(item, close)"
      />
    </template>
  </DropdownTrigger>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { DropdownTrigger, DropdownItem, type DropdownItemData } from './Dropdown'
import { getEffortLevels } from '../utils/modelUtils'

interface Props {
  effortLevel?: string
  selectedModel?: string
}

interface Emits {
  (e: 'effortSelect', level: string): void
}

const props = withDefaults(defineProps<Props>(), {
  effortLevel: 'high',
  selectedModel: undefined,
})

const emit = defineEmits<Emits>()

const LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
}

const options = computed(() =>
  getEffortLevels(props.selectedModel).map((id) => ({ id, label: LABELS[id] ?? id }))
)

const selectedLabel = computed(() => {
  const found = options.value.find((o) => o.id === props.effortLevel)
  return found?.label ?? LABELS[props.effortLevel] ?? 'High'
})

function handleSelect(item: DropdownItemData, close: () => void) {
  close()
  emit('effortSelect', item.id)
}
</script>

<style scoped>
.effort-dropdown {
  display: flex;
  gap: 4px;
  font-size: 12px;
  align-items: center;
  line-height: 24px;
  min-width: 0;
  max-width: 100%;
  padding: 2.5px 6px;
  border-radius: 23px;
  flex-shrink: 1;
  cursor: pointer;
  border: none;
  background: transparent;
  overflow: hidden;
  transition: background-color 0.2s ease;
}

.effort-dropdown:hover {
  background-color: var(--vscode-inputOption-hoverBackground);
}

.dropdown-content {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
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
