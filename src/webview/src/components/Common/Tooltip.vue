<template>
  <TooltipProvider :delay-duration="delayDuration" :disable-hoverable-content="true">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          class="cursor-tooltip-content"
          :side="side"
          :side-offset="sideOffset"
          :align="align"
        >
          <slot name="content">{{ content }}</slot>
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<script setup lang="ts">
import {
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
} from 'reka-ui'

withDefaults(defineProps<{
  content?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  align?: 'start' | 'center' | 'end'
  delayDuration?: number
}>(), {
  content: '',
  side: 'top',
  sideOffset: 2,
  align: 'center',
  delayDuration: 400,
})
</script>

<style>
/* Tooltip styles are NOT scoped — rendered via Portal outside component DOM */

.cursor-tooltip-content {
  background-color: var(--vscode-input-background);
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-editorWidget-border);
  font-size: 0.8em;
  padding: 1px 4px;
  animation: cursor-tooltip-fade-in 0.2s ease-out;
}

@keyframes cursor-tooltip-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
