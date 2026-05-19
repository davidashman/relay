<template>
  <Tooltip :content="tooltipText" side="top" :side-offset="6">
    <div class="rate-limit-container">
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
      <span class="rate-label" :style="{ color: strokeColor }">{{ windowLabel }}</span>
    </div>
  </Tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Tooltip from './Common/Tooltip.vue'

interface Props {
  utilization: number   // 0–1
  rateLimitType: string
  resetsAt?: number     // unix epoch seconds
  status: string
  size?: number
}

const props = withDefaults(defineProps<Props>(), {
  size: 19
})

const STROKE_WIDTH = 2
const center = computed(() => (props.size / 2) - STROKE_WIDTH)
const radius = computed(() => center.value - STROKE_WIDTH)
const circumference = computed(() => 2 * Math.PI * radius.value)

const percentage = computed(() => Math.max(0, Math.min(1, props.utilization)) * 100)

const strokeOffset = computed(() =>
  circumference.value - (percentage.value / 100) * circumference.value
)

const strokeColor = computed(() => {
  if (props.status === 'rejected' || percentage.value >= 95) {
    return 'color-mix(in srgb, var(--vscode-chart-red) 92%, transparent)'
  }
  if (props.status === 'allowed_warning' || percentage.value >= 75) {
    return 'color-mix(in srgb, var(--vscode-charts-yellow, #e9c46a) 92%, transparent)'
  }
  return 'color-mix(in srgb, var(--vscode-foreground) 92%, transparent)'
})

const windowLabel = computed(() => {
  if (props.rateLimitType === 'five_hour') return '5h'
  if (props.rateLimitType === 'seven_day') return '7d'
  if (props.rateLimitType === 'seven_day_opus') return '7d·O'
  if (props.rateLimitType === 'seven_day_sonnet') return '7d·S'
  return props.rateLimitType
})

const tooltipText = computed(() => {
  const pct = percentage.value
  const formatted = `${pct % 1 === 0 ? Math.round(pct) : pct.toFixed(1)}%`
  const window = props.rateLimitType === 'five_hour' ? '5-hour' :
                 props.rateLimitType === 'seven_day' ? '7-day' :
                 props.rateLimitType
  let text = `${formatted} of ${window} limit used`
  if (props.resetsAt) {
    const d = new Date(props.resetsAt * 1000)
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    text += ` · resets at ${time}`
  }
  return text
})
</script>

<style scoped>
.rate-limit-container {
  display: flex;
  align-items: center;
  gap: 3px;
}

.progress-circle {
  display: flex;
  align-items: center;
}

.progress-svg {
  display: block;
}

.progress-arc {
  transition: stroke-dashoffset 0.3s ease;
}

.rate-label {
  font-size: 9px;
  line-height: 1;
  opacity: 0.8;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
