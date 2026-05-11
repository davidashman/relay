<template>
  <div class="section-header">
    <slot>{{ text }}</slot>
  </div>
</template>

<script setup lang="ts">
interface Props {
  text?: string
}

withDefaults(defineProps<Props>(), {
  text: ''
})
</script>

<style scoped>
.section-header {
  padding: 4px 6px 2px;
  color: var(--vscode-foreground);
  opacity: 0.5;
  font-size: 10px;
  font-weight: 600;
}
</style>
