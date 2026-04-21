<template>
  <div v-if="shouldShow" style="padding: 0px 8px;">
    <div class="toolbar-section">
      <TodoList
        :todos="todos"
        :visible="showTodos"
        @todo-toggle="$emit('todoToggle', $event)"
      />
      <!--  - Todo  Queue  -->
      <div
        v-if="shouldShowTodoQueueDivider"
        style="height: 1px; background: color-mix(in srgb, var(--vscode-input-border, var(--vscode-widget-border)) 40%, transparent); margin: 2px -5px;"
      />
      <MessageQueueList
        :queued-messages="queuedMessages"
        :visible="showQueue"
        @remove="$emit('queueRemove', $event)"
        @send-now="$emit('queueSendNow', $event)"
      />
      <!--  - Queue  Files  -->
      <div
        v-if="shouldShowQueueFilesDivider"
        style="height: 1px; background: color-mix(in srgb, var(--vscode-input-border, var(--vscode-widget-border)) 40%, transparent); margin: 2px -5px;"
      />
      <FileEditedList
        :files-edited="filesEdited"
        :visible="showFiles"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import TodoList from './TodoList.vue'
import FileEditedList from './FileEditedList.vue'
import MessageQueueList from './MessageQueueList.vue'
import type { Todo, FileEdit } from '../types/toolbar'
import type { QueuedMessage } from '../types/queue'

interface Props {
  todos?: Todo[]
  filesEdited?: FileEdit[]
  queuedMessages?: QueuedMessage[]
  showTodos?: boolean
  showFiles?: boolean
  showQueue?: boolean
}

interface Emits {
  (e: 'todoToggle', index: number): void
  (e: 'queueRemove', messageId: string): void
  (e: 'queueSendNow', messageId: string): void
}

const props = withDefaults(defineProps<Props>(), {
  todos: () => [],
  filesEdited: () => [],
  queuedMessages: () => [],
  showTodos: false,
  showFiles: false,
  showQueue: false
})

defineEmits<Emits>()

const shouldShow = computed(() => {
  const hasTodos = props.showTodos && props.todos.length > 0
  const hasFiles = props.showFiles && props.filesEdited.length > 0
  const hasQueue = props.showQueue && props.queuedMessages.length > 0
  return hasTodos || hasFiles || hasQueue
})

// Todo Queue
const shouldShowTodoQueueDivider = computed(() => {
  const hasTodos = props.showTodos && props.todos.length > 0
  const hasQueue = props.showQueue && props.queuedMessages.length > 0
  return hasTodos && hasQueue
})

// Queue Files
const shouldShowQueueFilesDivider = computed(() => {
  const hasQueue = props.showQueue && props.queuedMessages.length > 0
  const hasFiles = props.showFiles && props.filesEdited.length > 0
  return hasQueue && hasFiles
})
</script>