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
      <span v-if="questions.length > 1" class="question-progress">
        {{ currentQuestionIndex + 1 }} / {{ questions.length }}
      </span>
    </div>

    <div v-if="currentQuestion" class="question-block">
      <div v-if="currentQuestion.header" class="question-header">
        <span class="header-chip">{{ currentQuestion.header }}</span>
      </div>
      <div class="question-text">{{ currentQuestion.question }}</div>

      <div class="options-list">
        <button
          v-for="(option, oIndex) in currentQuestion.options"
          :key="oIndex"
          class="option-button"
          :class="{ 'option-selected': isSelected(currentQuestionIndex, option.label) }"
          @click="handleOptionClick(oIndex, option.label)"
        >
          <span class="option-number">{{ oIndex + 1 }}</span>
          <div class="option-content">
            <div class="option-label">{{ option.label }}</div>
            <div v-if="option.description" class="option-description">{{ option.description }}</div>
          </div>
          <span v-if="currentQuestion.multiSelect && isSelected(currentQuestionIndex, option.label)" class="check-mark">✓</span>
        </button>
      </div>

      <div class="action-row">
        <button
          v-if="currentQuestion.multiSelect"
          class="submit-button"
          @click="advanceOrSubmit"
          :disabled="!currentQuestionAnswered"
        >
          <span class="shortcut-key">↵</span>
          {{ isLastQuestion ? 'Submit' : 'Next' }}
        </button>
        <button
          v-if="currentQuestionIndex > 0"
          class="back-button"
          @click="goBack"
        >
          <span class="shortcut-key">←</span> Back
        </button>
        <button class="cancel-button" @click="handleCancel">
          <span class="shortcut-key">Esc</span> Cancel
        </button>
      </div>
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
const currentQuestionIndex = ref(0);
const selectedAnswers = ref<Record<number, string[]>>({});

onMounted(() => {
  if (document.hasFocus()) {
    containerRef.value?.focus();
  }
});

const questions = computed<Question[]>(() => {
  const inputs = props.request.inputs as any;
  return inputs?.questions || [];
});

const currentQuestion = computed(() => questions.value[currentQuestionIndex.value]);
const isLastQuestion = computed(() => currentQuestionIndex.value === questions.value.length - 1);

const currentQuestionAnswered = computed(() => {
  const answers = selectedAnswers.value[currentQuestionIndex.value];
  return answers && answers.length > 0;
});

function isSelected(questionIndex: number, optionLabel: string): boolean {
  return (selectedAnswers.value[questionIndex] || []).includes(optionLabel);
}

function selectOption(questionIndex: number, optionLabel: string) {
  selectedAnswers.value = { ...selectedAnswers.value, [questionIndex]: [optionLabel] };
}

function toggleOption(questionIndex: number, optionLabel: string) {
  const current = selectedAnswers.value[questionIndex] || [];
  const idx = current.indexOf(optionLabel);
  const updated = idx > -1
    ? current.filter(l => l !== optionLabel)
    : [...current, optionLabel];
  selectedAnswers.value = { ...selectedAnswers.value, [questionIndex]: updated };
}

function handleOptionClick(optionIndex: number, optionLabel: string) {
  const question = currentQuestion.value;
  if (!question) return;

  if (question.multiSelect) {
    toggleOption(currentQuestionIndex.value, optionLabel);
  } else {
    selectOption(currentQuestionIndex.value, optionLabel);
    // Brief delay so the selected state is visible before advancing
    setTimeout(() => advanceOrSubmit(), 150);
  }
}

function goBack() {
  if (currentQuestionIndex.value > 0) {
    currentQuestionIndex.value--;
  }
}

function advanceOrSubmit() {
  if (!currentQuestionAnswered.value) return;

  if (isLastQuestion.value) {
    submitAnswers();
  } else {
    currentQuestionIndex.value++;
  }
}

function submitAnswers() {
  const answers: Record<string, string | string[]> = {};
  questions.value.forEach((question, index) => {
    const selected = selectedAnswers.value[index] || [];
    answers[question.header] = question.multiSelect ? selected : (selected[0] || '');
  });

  props.request.accept({
    ...props.request.inputs,
    answers
  });
}

function handleCancel() {
  props.request.reject('User cancelled the question', true);
}

function handleKeyDown(e: KeyboardEvent) {
  const question = currentQuestion.value;
  if (!question) return;

  const num = parseInt(e.key);
  if (!isNaN(num) && num >= 1 && num <= question.options.length) {
    e.preventDefault();
    handleOptionClick(num - 1, question.options[num - 1].label);
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    if (currentQuestionAnswered.value) {
      advanceOrSubmit();
    }
  } else if (e.key === 'ArrowLeft' && currentQuestionIndex.value > 0) {
    e.preventDefault();
    goBack();
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
  margin: 0px 10px;
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

.question-progress {
  margin-left: auto;
  font-size: 0.8em;
  font-weight: 400;
  color: color-mix(in srgb, var(--vscode-foreground) 55%, transparent);
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
  padding: 3px 10px;
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
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.option-button {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  cursor: pointer;
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  text-align: left;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.option-button:hover {
  background: color-mix(in srgb, var(--vscode-list-hoverBackground) 60%, transparent);
  border-color: var(--vscode-focusBorder);
}

.option-button.option-selected {
  background: color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 30%, transparent);
  border-color: var(--vscode-focusBorder);
}

.option-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
  color: var(--vscode-foreground);
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.option-label {
  font-weight: 500;
  font-size: 1em;
  color: var(--vscode-foreground);
}

.option-description {
  font-size: 0.85em;
  color: color-mix(in srgb, var(--vscode-foreground) 65%, transparent);
  line-height: 1.4;
}

.check-mark {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--vscode-button-background);
  font-weight: 700;
}

.action-row {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.submit-button,
.cancel-button,
.back-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 4px;
  font-size: 0.9em;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
  border: none;
  min-width: 100px;
}

.submit-button {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.submit-button:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.submit-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.back-button,
.cancel-button {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.back-button:hover,
.cancel-button:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.shortcut-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 2px;
  border-radius: 3px;
  background: color-mix(in srgb, currentColor 20%, transparent);
  font-size: 11px;
  font-weight: 600;
}
</style>
