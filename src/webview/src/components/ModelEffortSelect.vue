<template>
  <DropdownTrigger align="right" :close-on-click-outside="true">
    <template #trigger="{ isOpen }">
      <div class="model-effort-dropdown" :class="{ 'is-open': isOpen }">
        <div class="dropdown-content">
          <div class="dropdown-text">
            <span class="model-label">{{ selectedModelLabel }}</span>
            <span v-if="supportsEffort(props.selectedModel)" class="effort-label">{{ selectedEffortLabel }}</span>
          </div>
        </div>
      </div>
    </template>

    <template #content="{ close }">
      <DropdownSectionHeader text="Model" />
      <DropdownItem
        v-for="(model, idx) in PRIMARY_MODELS"
        :key="model.id"
        :item="{ id: model.id, label: model.label, checked: isModelSelected(model.id), type: 'model' }"
        :is-selected="isModelSelected(model.id)"
        :index="idx"
        @click="(item) => handleModelSelect(item, close)"
      />
      <DropdownItem
        v-for="(model, idx) in LEGACY_MODELS"
        :key="model.id"
        :item="{ id: model.id, label: model.label, sublabel: 'Legacy', checked: isModelSelected(model.id), type: 'model' }"
        :is-selected="isModelSelected(model.id)"
        :index="LEGACY_MODELS.length"
        @click="(item) => handleModelSelect(item, close)"
      />

      <template v-if="supportsEffort(props.selectedModel)">
        <DropdownSeparator />
        <DropdownSectionHeader text="Effort" />
        <DropdownItem
          v-for="(effort, idx) in effortOptions"
          :key="effort.id"
          :item="{ id: effort.id, label: effort.label, checked: isEffortSelected(effort.id), type: 'effort' }"
          :is-selected="isEffortSelected(effort.id)"
          :index="PRIMARY_MODELS.length + 1 + idx"
          @click="(item) => handleEffortSelect(item, close)"
        />
      </template>
    </template>
  </DropdownTrigger>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { DropdownTrigger, DropdownItem, DropdownSeparator, DropdownSectionHeader, type DropdownItemData } from './Dropdown'
import { getEffortLevels, supportsEffort, parseModelInfo } from '../utils/modelUtils'

interface Props {
  selectedModel?: string
  effortLevel?: string
}

interface Emits {
  (e: 'modelSelect', modelId: string): void
  (e: 'effortSelect', level: string | undefined): void
}

const props = withDefaults(defineProps<Props>(), {
  selectedModel: undefined,
  effortLevel: undefined,
})

const emit = defineEmits<Emits>()

const PRIMARY_MODELS = [
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
]

const LEGACY_MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
]

const ALL_MODELS = [...PRIMARY_MODELS, ...LEGACY_MODELS]

const EFFORT_LABELS: Record<string, string> = {
  default: 'Adaptive',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
}

const selectedModelLabel = computed(() => {
  const found = ALL_MODELS.find((m) => m.id === props.selectedModel)
  if (found) return found.label
  const parsed = parseModelInfo(props.selectedModel)
  if (parsed.model) return parsed.label
  return ''
})

const selectedEffortLabel = computed(() => {
  const level = props.effortLevel ?? 'default'
  return EFFORT_LABELS[level] ?? level
})

const effortOptions = computed(() => [
  { id: 'default', label: 'Adaptive' },
  ...getEffortLevels(props.selectedModel).map((id) => ({ id, label: EFFORT_LABELS[id] ?? id })),
])

function isModelSelected(modelId: string): boolean {
  return props.selectedModel === modelId
}

function isEffortSelected(effortId: string): boolean {
  return (props.effortLevel ?? 'default') === effortId
}

function handleModelSelect(item: DropdownItemData, close: () => void) {
  close()
  emit('modelSelect', item.id)
  emit('effortSelect', undefined)
}

function handleEffortSelect(item: DropdownItemData, close: () => void) {
  close()
  emit('effortSelect', item.id === 'default' ? undefined : item.id)
}
</script>

<style scoped>
.model-effort-dropdown {
  display: flex;
  gap: 4px;
  font-size: 12px;
  align-items: center;
  line-height: 24px;
  min-width: 0;
  max-width: 100%;
  padding: 2px 6px;
  border-radius: 24px;
  flex-shrink: 1;
  cursor: pointer;
  border: none;
  overflow: hidden;
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
  gap: 5px;
  height: 13px;
  font-weight: 400;
  margin: 1px 0px;
}

.model-label {
  opacity: 0.8;
  overflow: hidden;
  height: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
  transition: opacity 0.15s ease;
}

.effort-label {
  opacity: 0.45;
  height: 13px;
  white-space: nowrap;
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: opacity 0.15s ease;
}

.chevron-icon {
  font-size: 9px;
  flex-shrink: 0;
  opacity: 0.5;
  color: var(--vscode-foreground);
  transition: opacity 0.15s ease;
}

.model-effort-dropdown:hover,
.model-effort-dropdown.is-open {
  background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
}

</style>
