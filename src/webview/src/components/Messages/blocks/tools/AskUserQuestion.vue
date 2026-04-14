<template>
  <ToolMessageWrapper
    tool-icon="codicon-question"
    :tool-result="toolResult"
    :default-expanded="true"
  >
    <template #main>
      <span class="tool-label">Question</span>
    </template>

    <template #expandable>
      <!-- Show questions (read-only display in message history) -->
      <div v-if="!hasAnswer" class="questions-container">
        <div v-for="(question, qIndex) in questions" :key="qIndex" class="question-block">
          <div class="question-header">
            <span class="header-chip">{{ question.header }}</span>
          </div>
          <div class="question-text">{{ question.question }}</div>

          <div class="options-list">
            <div
              v-for="(option, oIndex) in question.options"
              :key="oIndex"
              class="option-item-readonly"
            >
              <div class="option-content">
                <div class="option-label">{{ option.label }}</div>
                <div class="option-description">{{ option.description }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Show submitted answers -->
      <div v-else class="answers-display">
        <div v-for="(question, qIndex) in questions" :key="qIndex" class="answer-block">
          <div class="answer-header">{{ question.header }}</div>
          <div class="answer-values">
            <span
              v-for="(answer, aIndex) in getAnswers(question.header)"
              :key="aIndex"
              class="answer-chip"
            >
              {{ answer }}
            </span>
          </div>
        </div>
      </div>

      <!-- Error content -->
      <ToolError :tool-result="toolResult" />
    </template>
  </ToolMessageWrapper>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import ToolMessageWrapper from './common/ToolMessageWrapper.vue';
import ToolError from './common/ToolError.vue';

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
  toolUse?: any;
  toolResult?: any;
  toolUseResult?: any;
  context?: any;
}

const props = defineProps<Props>();

// Get questions from tool input
const questions = computed<Question[]>(() => {
  const input = props.toolUseResult?.input || props.toolUse?.input;
  return input?.questions || [];
});

// Check if answers have been provided
const hasAnswer = computed(() => {
  return !!props.toolResult && !props.toolResult.is_error;
});

const submittedAnswers = computed(() => {
  if (!props.toolResult?.content) return null;

  try {
    // The tool result content might be a string containing the answers object
    if (typeof props.toolResult.content === 'string') {
      return JSON.parse(props.toolResult.content);
    }
    return props.toolResult.content;
  } catch {
    return null;
  }
});

function getAnswers(header: string): string[] {
  if (!submittedAnswers.value) return [];

  const answer = submittedAnswers.value[header];
  if (Array.isArray(answer)) return answer;
  if (typeof answer === 'string') return [answer];
  return [];
}
</script>

<style scoped>
.tool-label {
  font-weight: 500;
  color: var(--vscode-foreground);
  font-size: 0.9em;
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

.option-item-readonly {
  display: flex;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: var(--vscode-editor-background);
  opacity: 0.8;
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.option-label {
  font-weight: 500;
  font-size: 0.9em;
  color: var(--vscode-foreground);
}

.option-description {
  font-size: 0.85em;
  color: color-mix(in srgb, var(--vscode-foreground) 70%, transparent);
  line-height: 1.4;
}

.answers-display {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.answer-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.answer-header {
  font-size: 0.85em;
  font-weight: 600;
  color: color-mix(in srgb, var(--vscode-foreground) 70%, transparent);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.answer-values {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.answer-chip {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 500;
}
</style>
