<template>
  <Tooltip :content="tooltipText" side="top" :side-offset="6">
    <div
      class="progress-container"
      :style="{ width: size, height: size }"
    >
      <div class="progress-circle">
        <svg :width="size" :height="size" class="progress-svg">
          <circle
            :cx="center"
            :cy="center"
            :r="radius"
            :stroke="strokeColor"
            :stroke-width="STROKE_WIDTH"
            fill="none"
            opacity="0.25"
          />
          <circle
            :cx="center"
            :cy="center"
            :r="radius"
            :stroke="strokeColor"
            :stroke-width="STROKE_WIDTH"
            fill="none"
            stroke-linecap="round"
            opacity="0.9"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="strokeOffset"
            :transform="`rotate(-90 ${center} ${center})`"
            class="progress-arc"
          />
        </svg>
      </div>
    </div>
  </Tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Tooltip from './Common/Tooltip.vue'

interface Props {
  percentage: number
  contextTooltip?: string
  size?: number
}

const props = withDefaults(defineProps<Props>(), {
  percentage: 0,
  contextTooltip: '',
  size: 18
})

const STROKE_WIDTH = 2
const center = computed(() => (props.size / 2) - STROKE_WIDTH)
const radius = computed(() => center.value - STROKE_WIDTH)

const circumference = computed(() => {
  return 2 * Math.PI * radius.value
})

const strokeOffset = computed(() => {
  const progress = Math.max(0, Math.min(100, props.percentage))
  return circumference.value - (progress / 100) * circumference.value
})

const formattedPercentage = computed(() => {
  const value = props.percentage
  return `${value % 1 === 0 ? Math.round(value) : value.toFixed(1)}%`
})

const tooltipText = computed(() => {
  if (props.contextTooltip) {
    return `${formattedPercentage.value} · ${props.contextTooltip}`
  }
  return formattedPercentage.value
})

const strokeColor = computed(() => {
  if (props.percentage >= 80) {
    return 'color-mix(in srgb,var(--vscode-chart-red) 92%,transparent)'
  }
  else {
    return 'color-mix(in srgb,var(--vscode-foreground) 92%,transparent)'
  }
})
</script>

<style scoped>
.progress-container {
  display: flex;
  align-items: center;
  padding-bottom: 1px;
}

.progress-svg {
  position: absolute;
}

.progress-arc {
  transition: stroke-dashoffset 0.3s ease;
}
</style>