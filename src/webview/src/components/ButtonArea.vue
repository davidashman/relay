<template>
  <div class="button-area-container">
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
    <Tooltip :content="submitVariant === 'stop' ? 'Cancel all prompts' : 'Send'">
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
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import Tooltip from './Common/Tooltip.vue'

interface Props {
  disabled?: boolean
  loading?: boolean
  conversationWorking?: boolean
  hasInputContent?: boolean
}

interface Emits {
  (e: 'submit'): void
  (e: 'stop'): void
  (e: 'attach'): void
  (e: 'addAttachment', files: FileList): void
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  loading: false,
  conversationWorking: false,
  hasInputContent: false,
})

const emit = defineEmits<Emits>()

const fileInputRef = ref<HTMLInputElement>()

const submitVariant = computed(() => {
  if (props.conversationWorking) {
    return 'stop'
  }

  if (!props.hasInputContent) {
    return 'disabled'
  }

  return 'enabled'
})

function handleSubmit() {
  if (submitVariant.value === 'stop') {
    emit('stop')
  } else if (submitVariant.value === 'enabled') {
    emit('submit')
  }
}

function handleAttachClick() {
  fileInputRef.value?.click()
}

function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    emit('addAttachment', target.files)
    target.value = ''
  }
}
</script>

<style scoped>
.button-area-container {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
  cursor: auto;
  user-select: none;
  height: 20px;
  padding-right: 2px;
}

.action-button,
.submit-button {
  opacity: 0.6;
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

.action-button {
  margin-top: 1px;
}

.action-button:hover:not(:disabled) {
  opacity: 1;
}

.action-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
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

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
