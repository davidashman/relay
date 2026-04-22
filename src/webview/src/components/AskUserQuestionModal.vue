<template>
  <div
    ref="containerRef"
    class="permission-request-container"
    tabIndex="0"
    @keydown="handleKeyDown"
    data-permission-panel="1"
  >
    <div class="tool-title">
      <span class="codicon codicon-question"></span>
      <span class="tool-name">Question</span>
    </div>

    <div class="questions-container">
      <div v-for="(question, qIndex) in questions" :key="qIndex" class="question-block">
        <div class="question-header">
          <span class="header-chip">{{ question.header }}</span>
        </div>
        <div class="question-text">{{ question.question }}</div>

        <div class="options-list">
          <label
            v-for="(option, oIndex) in question.options"
            :key="oIndex"
            class="option-item"
            :class="{ 'option-selected': isSelected(qIndex, option.label) }"
          >
            <input
              v-if="question.multiSelect"
              type="checkbox"
              :checked="isSelected(qIndex, option.label)"
              @change="toggleOption(qIndex, option.label, question.multiSelect)"
            />
            <input
              v-else
              type="radio"
              :name="`question-${qIndex}`"
              :checked="isSelected(qIndex, option.label)"
              @change="selectOption(qIndex, option.label)"
            />
            <div class="option-content">
              <div class="option-label">{{ option.label }}</div>
              <div class="option-description">{{ option.description }}</div>
            </div>
          </label>
        </div>
      </div>
    </div>

    <div class="action-buttons">
      <button
        class="submit-button"
        @click="submitAnswers"
        :disabled="!canSubmit"
      >
        <span class="shortcut-num">1</span> Submit Answers
      </button>
      <button
        class="cancel-button"
        @click="handleCancel"
      >
        <span class="shortcut-num">2</span> Cancel
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { PermissionRequest } from '../core/PermissionRequest';
import type { ToolContext } from '../types/tool';

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  multiSelect: boolean;
  options: QuestionOption[];
}

interface Props {
  request: PermissionRequest;
  context: ToolContext;
  onResolve: (request: PermissionRequest, allow: boolean) => void;
}

const props = defineProps<Props>();

const containerRef = ref<HTMLDivElement | null>(null);

onMounted(() => {
  // Only grab focus if this webview's document is already focused. Otherwise,
  // a question prompt arriving in one window would steal focus from an
  // input box the user is actively typing in elsewhere.
  if (document.hasFocus()) {
    containerRef.value?.focus();
  }
});

// Get questions from permission request inputs
const questions = computed<Question[]>(() => {
  const inputs = props.request.inputs as any;
  return inputs?.questions || [];
});

// Track selected answers (map of question index to selected option labels)
const selectedAnswers = ref<Record<number, string[]>>({});

function isSelected(questionIndex: number, optionLabel: string): boolean {
  const answers = selectedAnswers.value[questionIndex] || [];
  return answers.includes(optionLabel);
}

function selectOption(questionIndex: number, optionLabel: string) {
  selectedAnswers.value[questionIndex] = [optionLabel];
}

function toggleOption(questionIndex: number, optionLabel: string, multiSelect: boolean) {
  if (!selectedAnswers.value[questionIndex]) {
    selectedAnswers.value[questionIndex] = [];
  }

  const answers = selectedAnswers.value[questionIndex];
  const index = answers.indexOf(optionLabel);

  if (index > -1) {
    answers.splice(index, 1);
  } else {
    if (multiSelect) {
      answers.push(optionLabel);
    } else {
      selectedAnswers.value[questionIndex] = [optionLabel];
    }
  }
}

const canSubmit = computed(() => {
  // Check that all questions have at least one answer
  return questions.value.every((_, index) => {
    const answers = selectedAnswers.value[index];
    return answers && answers.length > 0;
  });
});

function submitAnswers() {
  if (!canSubmit.value) return;

  // Build answers object with question headers as keys
  const answers: Record<string, string | string[]> = {};

  questions.value.forEach((question, index) => {
    const selected = selectedAnswers.value[index] || [];
    if (question.multiSelect) {
      answers[question.header] = selected;
    } else {
      answers[question.header] = selected[0] || '';
    }
  });

  // Accept the permission request with updated answers
  props.request.accept({
    ...props.request.inputs,
    answers
  });
}

function handleCancel() {
  props.request.reject('User cancelled the question', true);
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === '1' && canSubmit.value) {
    e.preventDefault();
    submitAnswers();
  } else if (e.key === '2') {
    e.preventDefault();
    handleCancel();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    handleCancel();
  }
}
</script>

<style scoped>
.permission-request-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  background: var(--vscode-editorWidget-background);
  border-top: 1px solid var(--vscode-panel-border);
  outline: none;
  min-height: 120px;
  max-height: 60vh;
  overflow-y: auto;
}

.tool-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.tool-name {
  color: var(--vscode-foreground);
}

.questions-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.question-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.question-header {
  display: flex;
  align-items: center;
}

.header-chip {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  line-height: 1;
}

.question-text {
  font-size: 1em;
  font-weight: 500;
  color: var(--vscode-foreground);
  margin-bottom: 4px;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--vscode-editor-background);
}

.option-item:hover {
  background: color-mix(in srgb, var(--vscode-list-hoverBackground) 50%, transparent);
  border-color: var(--vscode-focusBorder);
}

.option-selected {
  background: color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 20%, transparent);
  border-color: var(--vscode-focusBorder);
}

.option-item input[type="radio"],
.option-item input[type="checkbox"] {
  margin-top: 2px;
  flex-shrink: 0;
  cursor: pointer;
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.option-label {
  font-weight: 500;
  font-size: 1em;
  color: var(--vscode-foreground);
}

.option-description {
  font-size: 0.85em;
  color: color-mix(in srgb, var(--vscode-foreground) 70%, transparent);
  line-height: 1.4;
}

.action-buttons {
  display: flex;
  gap: 8px;
  justify-content: flex-start;
  margin-top: 8px;
}

.submit-button,
.cancel-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 1em;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
  border: none;
}

.submit-button {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.submit-button:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.submit-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cancel-button {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.cancel-button:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.shortcut-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  background: color-mix(in srgb, currentColor 20%, transparent);
  font-size: 11px;
  font-weight: 600;
}
</style>
