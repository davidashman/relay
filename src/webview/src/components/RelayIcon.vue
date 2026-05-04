<template>
  <svg
    :class="props.class"
    height="1em"
    width="1em"
    style="flex:none;line-height:1"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="5" y="7" width="14" height="10" rx="1" fill="none" stroke="#D97757" stroke-width="2" stroke-linecap="round"/>
    <circle cx="9" cy="12" r="1.4" fill="#D97757"/>
    <circle cx="15" cy="12" r="1.4" fill="#D97757"/>
    <line x1="12" y1="7" x2="12" y2="2" stroke="#D97757" stroke-width="2" stroke-linecap="round"/>
    <line x1="9" y1="2" x2="15" y2="2" stroke="#D97757" stroke-width="2" stroke-linecap="round"/>
    <line x1="12" y1="17" x2="12" y2="22" stroke="#D97757" stroke-width="2" stroke-linecap="round"/>
    <line x1="9" y1="22" x2="15" y2="22" stroke="#D97757" stroke-width="2" stroke-linecap="round"/>
  </svg>
</template>

<script setup lang="ts">
interface Props {
  class?: string;
}

const props = defineProps<Props>();
</script>
