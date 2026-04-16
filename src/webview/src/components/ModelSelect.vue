<template>
  <DropdownTrigger
    align="left"
    :close-on-click-outside="true"
  >
    <template #trigger>
      <div class="model-dropdown">
        <div class="dropdown-content">
          <div class="dropdown-text">
            <span class="dropdown-label">{{ modelInfo.label }}</span>
          </div>
        </div>
        <div class="codicon codicon-chevron-up chevron-icon text-[12px]!" />
      </div>
    </template>

    <template #content="{ close }">
      <DropdownItem
        :item="{
          id: 'claude-opus-4-6',
          label: 'Opus 4.6',
          checked: isModelSelected('claude-opus-4-6'),
          type: 'model'
        }"
        :is-selected="isModelSelected('claude-opus-4-6')"
        :index="0"
        @click="(item) => handleModelSelect(item, close)"
      />
      <DropdownItem
        :item="{
          id: 'claude-sonnet-4-6',
          label: 'Sonnet 4.6',
          checked: isModelSelected('claude-sonnet-4-6'),
          type: 'model'
        }"
        :is-selected="isModelSelected('claude-sonnet-4-6')"
        :index="1"
        @click="(item) => handleModelSelect(item, close)"
      />
      <DropdownItem
        :item="{
          id: 'claude-haiku-4-5',
          label: 'Haiku 4.5',
          checked: isModelSelected('claude-haiku-4-5'),
          type: 'model'
        }"
        :is-selected="isModelSelected('claude-haiku-4-5')"
        :index="2"
        @click="(item) => handleModelSelect(item, close)"
      />
      <DropdownSeparator />
      <DropdownItem
        :item="{
          id: 'claude-opus-4-5',
          label: 'Opus 4.5',
          checked: isModelSelected('claude-opus-4-5'),
          type: 'model'
        }"
        :is-selected="isModelSelected('claude-opus-4-5')"
        :index="3"
        @click="(item) => handleModelSelect(item, close)"
      />
      <DropdownItem
        :item="{
          id: 'claude-sonnet-4-5',
          label: 'Sonnet 4.5',
          checked: isModelSelected('claude-sonnet-4-5'),
          type: 'model'
        }"
        :is-selected="isModelSelected('claude-sonnet-4-5')"
        :index="4"
        @click="(item) => handleModelSelect(item, close)"
      />
    </template>
  </DropdownTrigger>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { DropdownTrigger, DropdownItem, DropdownSeparator, type DropdownItemData } from './Dropdown'
import { parseModelInfo, type ModelInfo } from '../utils/modelUtils'
import { transport } from '../core/runtimeTransport'

interface Props {
  selectedModel?: string
}

interface Emits {
  (e: 'modelSelect', modelId: string): void
}

const props = defineProps<Props>()

const emit = defineEmits<Emits>()

const modelInfo = computed((): ModelInfo => {
  return parseModelInfo(props.selectedModel)
})

const customModels = ref<Array<{ id: string; name?: string }>>([])
const disabledModels = ref<string[]>([])
const sdkModels = ref<Array<{ value: string; displayName: string }>>([])

// ── Listen for config changes from settings page ──

const unsubConfigChanged = transport.extensionConfigChanged.add(({ key, value }) => {
  if (key === 'customModels') {
    customModels.value = value ?? []
  } else if (key === 'disabledModels') {
    disabledModels.value = value ?? []
  }
})

onUnmounted(() => {
  unsubConfigChanged()
})

// ── Static aliases ──

const MODEL_ALIASES: Array<{ id: string; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' },
]

// ── Available models: aliases + SDK + custom, minus disabled ──

const availableModels = computed(() => {
  const disabledSet = new Set(disabledModels.value)
  const seenIds = new Set<string>()
  const result: Array<{ id: string; label: string }> = []

  // 1. Static aliases
  for (const alias of MODEL_ALIASES) {
    if (!disabledSet.has(alias.id)) {
      result.push(alias)
      seenIds.add(alias.id)
    }
  }

  // 2. SDK probed models
  for (const m of sdkModels.value) {
    if (!seenIds.has(m.value) && !disabledSet.has(m.value)) {
      const cleanLabel = m.displayName.replace(/\s*\(recommended\)\s*$/i, '')
      result.push({ id: m.value, label: cleanLabel })
      seenIds.add(m.value)
    }
  }

  // 3. Custom models
  for (const cm of customModels.value) {
    if (!seenIds.has(cm.id) && !disabledSet.has(cm.id)) {
      result.push({ id: cm.id, label: cm.name || cm.id })
      seenIds.add(cm.id)
    }
  }

  return result
})

// ── Label for trigger display ──

const selectedModelLabel = computed(() => {
  const found = availableModels.value.find((m) => m.id === props.selectedModel)
  if (found) return found.label

  // Fallback: check all sources even if disabled
  const alias = MODEL_ALIASES.find((a) => a.id === props.selectedModel)
  if (alias) return alias.label

  const sdk = sdkModels.value.find((m) => m.value === props.selectedModel)
  if (sdk) return sdk.displayName.replace(/\s*\(recommended\)\s*$/i, '')

  const custom = customModels.value.find((m) => m.id === props.selectedModel)
  if (custom) return custom.name || custom.id

  // Fallback: parse the model ID to extract a readable label (handles date-suffixed IDs)
  const parsed = parseModelInfo(props.selectedModel)
  if (parsed.model) return parsed.label

  return props.selectedModel || 'Select model'
})

function isModelSelected(modelId: string): boolean {
  return props.selectedModel === modelId
}

function handleModelSelect(item: DropdownItemData, close: () => void) {
  console.log('Selected model:', item)
  close()

  // 发送模型切换事件
  emit('modelSelect', item.id)
}
</script>

<style scoped>
/* Model 下拉样式 - 简洁透明样式 */
.model-dropdown {
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

.model-dropdown:hover {
  background-color: var(--vscode-inputOption-hoverBackground);
}

/* 共享的 Dropdown 样式 */
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
