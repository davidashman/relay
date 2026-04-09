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
import { computed } from 'vue'
import { DropdownTrigger, DropdownItem, DropdownSeparator, type DropdownItemData } from './Dropdown'

interface Props {
  selectedModel?: string
}

interface Emits {
  (e: 'modelSelect', modelId: string): void
}

const props = defineProps<Props>()

const emit = defineEmits<Emits>()

interface ModelInfo {
  model?: string
  version?: string
  modelId?: string
  label: string
}

// Regex to parse model names: (?:claude-)?(?<model>opus|sonnet|haiku)(?:-(?<version>\d-\d))?
// Captures: model name (opus/sonnet/haiku) and optional version (X-Y)
const MODEL_REGEX = /^(?:claude-)?(?<model>opus|sonnet|haiku)(?:-(?<version>\d-\d))?$/

const LATEST_MODELS: Record<string, string> = {
  'haiku': '4-5',
  'sonnet': '4-6',
  'opus': '4-6'
}

const modelInfo = computed((): ModelInfo => {
  if (!props.selectedModel) return { label: 'Select Model' }

  const match = props.selectedModel.match(MODEL_REGEX)
  if (!match?.groups) return { label: 'Select Model' }

  const { model, version } = match.groups
  const finalVersion = version || LATEST_MODELS[model]  
  const modelLabel = model.charAt(0).toUpperCase() + model.slice(1)
  const versionLabel = finalVersion.replace('-', '.')

  return { 
    model: model, 
    version: versionLabel,
    modelId: `claude-${model}-${finalVersion}`, 
    label: `${modelLabel} ${versionLabel}` 
  }
})

// Helper to check if selected model matches a given model ID (handles short names)
const isModelSelected = (modelId: string): boolean => {
  return modelInfo.value.modelId === modelId
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
