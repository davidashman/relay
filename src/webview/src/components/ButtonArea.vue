<template>
  <div class="button-area-container">
    <div class="button-row">
      <!-- Left Section: Dropdowns -->
      <div class="controls-section">
        <!-- Mode Select -->
        <ModeSelect
          :permission-mode="permissionMode"
          @mode-select="(mode) => emit('modeSelect', mode)"
        />

        <!-- Model Select -->
        <ModelSelect
          :selected-model="selectedModel"
          @model-select="(modelId) => emit('modelSelect', modelId)"
        />

        <!-- Effort Select (Opus 4.6/4.7 and Sonnet 4.6) -->
        <EffortSelect
          v-if="supportsEffort(selectedModel)"
          :effort-level="effortLevel"
          :selected-model="selectedModel"
          @effort-select="(level) => emit('effortSelect', level)"
        />
      </div>

      <!-- Right Section: Token Indicator + Action Buttons -->
      <div class="actions-section">
        <!-- Token Usage Count -->
        <span
          v-if="showProgress && showTokenUsage && (inputTokens > 0 || outputTokens > 0)"
          class="token-count-label"
        >{{ formattedTokens }}</span>

        <!-- Token Indicator -->
        <TokenIndicator
          v-if="showProgress"
          :percentage="progressPercentage"
          :context-tooltip="contextTooltip"
          :size="19"
        />

        <!-- Thinking Toggle Button -->
        <Tooltip :content="thinkingEnabled ? 'Thinking on' : 'Thinking off'">
          <button
            class="action-button think-button"
            :class="{ 'thinking-active': thinkingEnabled }"
            @click="handleThinkingToggle"
          >
            <span class="codicon codicon-brain text-[16px]!" />
          </button>
        </Tooltip>

        <!-- Attach File Button -->
        <Tooltip content="Attach File">
          <button
            class="action-button"
            @click="handleAttachClick"
          >
            <span class="codicon codicon-attach text-[16px]!" />
            <input
              ref="fileInputRef"
              type="file"
              multiple
              style="display: none;"
              @change="handleFileUpload"
            >
          </button>
        </Tooltip>

        <!-- Submit Button -->
        <Tooltip :content="submitVariant === 'stop' ? 'Stop' : 'Send'">
          <button
            class="submit-button"
            @click="handleSubmit"
            :disabled="submitVariant === 'disabled'"
            :data-variant="submitVariant"
          >
            <span
              v-if="submitVariant === 'stop'"
              class="codicon codicon-debug-stop text-[12px]! bg-(--vscode-editor-background)e-[0.6] rounded-[1px]"
            />
            <span
              v-else
              class="codicon codicon-arrow-up-two text-[12px]!"
            />
          </button>
        </Tooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { ref, computed } from 'vue'
import Tooltip from './Common/Tooltip.vue'
import TokenIndicator from './TokenIndicator.vue'
import ModeSelect from './ModeSelect.vue'
import ModelSelect from './ModelSelect.vue'
import EffortSelect from './EffortSelect.vue'
import { supportsEffort } from '../utils/modelUtils'

interface Props {
  disabled?: boolean
  loading?: boolean
  selectedModel?: string
  conversationWorking?: boolean
  hasInputContent?: boolean
  showProgress?: boolean
  progressPercentage?: number
  contextTooltip?: string
  inputTokens?: number
  outputTokens?: number
  showTokenUsage?: boolean
  thinkingEnabled?: boolean
  effortLevel?: string
  permissionMode?: PermissionMode
}

interface Emits {
  (e: 'submit'): void
  (e: 'stop'): void
  (e: 'attach'): void
  (e: 'addAttachment', files: FileList): void
  (e: 'mention', filePath?: string): void
  (e: 'thinkingToggle'): void
  (e: 'modeSelect', mode: PermissionMode): void
  (e: 'modelSelect', modelId: string): void
  (e: 'effortSelect', level: string): void
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  loading: false,
  selectedModel: undefined,
  conversationWorking: false,
  hasInputContent: false,
  showProgress: true,
  progressPercentage: 48.7,
  contextTooltip: '',
  inputTokens: 0,
  outputTokens: 0,
  showTokenUsage: true,
  thinkingEnabled: true,
  effortLevel: 'high',
  permissionMode: 'default'
})

const emit = defineEmits<Emits>()

const fileInputRef = ref<HTMLInputElement>()

const formattedTokens = computed(() => {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return `${n}`
  }
  return `in: ${fmt(props.inputTokens)} / out: ${fmt(props.outputTokens)}`
})


const submitVariant = computed(() => {
  // Reactbusy
  if (props.conversationWorking) {
    return 'stop'
  }

  // busy ->
  if (!props.hasInputContent) {
    return 'disabled'
  }

  // ->
  return 'enabled'
})

function handleSubmit() {
  if (submitVariant.value === 'stop') {
    emit('stop')
  } else if (submitVariant.value === 'enabled') {
    emit('submit')
  }
}

function handleThinkingToggle() {
  emit('thinkingToggle')
}

function handleAttachClick() {
  fileInputRef.value?.click()
}

function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    emit('addAttachment', target.files)
    // input
    target.value = ''
  }
}



</script>

<style scoped>
.button-area-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.25rem;
  flex-shrink: 0;
  cursor: auto;
  width: 100%;
  user-select: none;
}

.button-row {
  display: grid;
  grid-template-columns: 4fr 1fr;
  align-items: center;
  height: 28px;
  padding-right: 2px;
  box-sizing: border-box;
  flex: 1 1 0%;
  justify-content: space-between;
  width: 100%;
}

.controls-section {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: 6px;
  flex-shrink: 1;
  flex-grow: 0;
  min-width: 0;
  height: 20px;
  max-width: 100%;
}

/* Tighten only the Model ↔ Effort pair */
.controls-section :deep(.effort-dropdown) {
  margin-left: -8px;
}

.actions-section {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.action-button,
.submit-button {
  opacity: 0.5;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border: none;
  background: transparent;
  border-radius: 50%;
  cursor: pointer;
  transition: background-color 0.2s ease, opacity 0.2s ease;
  color: var(--vscode-foreground);
  position: relative;
}


.action-button:hover:not(:disabled) {
  opacity: 1;
}

.action-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.action-button.thinking-active {
  color: var(--vscode-button-secondaryForeground);
  opacity: 1;
}

/* Think hover opacity off */
.action-button.think-button:hover:not(.thinking-active) {
  opacity: 0.5; /*  opacity 1 */
}

/* hover */
.action-button.think-button.thinking-active:hover {
  opacity: 1;
}

.submit-button {
  scale: 1.1;
  margin-left: 2px;
}

.submit-button[data-variant="enabled"] {
  background-color: color-mix(in srgb, var(--vscode-editor-foreground) 80%, transparent);
  color: var(--vscode-editor-background);
  opacity: 1;
  outline: 1.5px solid color-mix(in srgb, var(--vscode-editor-foreground) 60%, transparent);
  outline-offset: 1px;
}

.submit-button[data-variant="disabled"] {
  background-color: color-mix(in srgb, var(--vscode-editor-foreground) 80%, transparent);
  color: var(--vscode-editor-background);
  opacity: 0.5;
  cursor: not-allowed;
}

.submit-button[data-variant="stop"] {
  background-color: color-mix(in srgb, var(--vscode-editor-foreground) 80%, transparent);
  color: var(--vscode-editor-background);
  opacity: 1;
  outline: 1.5px solid color-mix(in srgb, var(--vscode-editor-foreground) 60%, transparent);
  outline-offset: 1px;
}

.token-count-label {
  font-size: 12px;
  color: color-mix(in srgb,var(--vscode-foreground) 60%,transparent);
  white-space: nowrap;
  line-height: 1;
  user-select: none;
}

.codicon-modifier-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
