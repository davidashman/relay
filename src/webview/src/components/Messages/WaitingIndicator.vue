<template>
  <div class="spinner" :data-permission-mode="permissionMode">
    <span class="icon" :style="{ fontSize: size + 'px' }">
      {{ currentIcon }}
    </span>
    <span class="text">{{ displayText }}</span>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
  import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

  interface Props {
    size?: number;
    permissionMode?: PermissionMode;
  }

  const props = withDefaults(defineProps<Props>(), {
    size: 16,
    permissionMode: undefined,
  });

  const SPINNER_ICONS = ['·', '✢', '*', '✶', '✻', '✽'];
  const ANIMATION_ICONS = [...SPINNER_ICONS, ...[...SPINNER_ICONS].reverse()];
  const DISPLAY_TEXT = 'Working...';

  const iconIndex = ref(0);
  const currentIcon = computed(() => ANIMATION_ICONS[iconIndex.value]);

  let iconTimer: any;
  let rafId: number | null = null;

  const animatedText = ref(' '.repeat(DISPLAY_TEXT.length));
  const animIndex = ref(0);
  let lastTick = 0;
  const stepMs = 40;

  const displayText = computed(() => animatedText.value);

  onMounted(() => {
    iconTimer = setInterval(() => {
      iconIndex.value = (iconIndex.value + 1) % ANIMATION_ICONS.length;
    }, 120);

    startTextAnimation(DISPLAY_TEXT);
  });

  onBeforeUnmount(() => {
    if (iconTimer) clearInterval(iconTimer);
    stopTextAnimation();
  });

  function replaceAt(s: string, index: number, ch: string): string {
    if (index < 0 || index >= s.length) return s;
    return s.slice(0, index) + ch + s.slice(index + 1);
  }

  function randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function transformChar(
    currentChar: string,
    targetChar: string,
    phase: number
  ): string {
    if (targetChar === ' ') return ' ';
    switch (phase) {
      case 3:
        return targetChar;
      case 2:
        return randomChoice(['.', '_', targetChar]);
      case 1:
        return randomChoice(['.', '_', targetChar]);
      case 0:
        return '▌';
      default:
        return currentChar;
    }
  }

  function startTextAnimation(text: string) {
    stopTextAnimation();
    animIndex.value = 0;
    lastTick = 0;
    if (animatedText.value.length !== text.length) {
      animatedText.value = ' '.repeat(text.length);
    }

    const step = (ts: number) => {
      if (!lastTick) lastTick = ts;
      if (ts - lastTick < stepMs) {
        rafId = requestAnimationFrame(step);
        return;
      }
      lastTick = ts;

      const d = animIndex.value;
      if (d - 3 >= text.length) {
        rafId = null;
        return;
      }

      animIndex.value++;
      const prev = animatedText.value;
      let nextStr = prev;
      for (let f = 0; f <= 3; f++) {
        const p = d - f;
        if (p >= 0 && p < text.length) {
          nextStr = replaceAt(
            nextStr,
            p,
            transformChar(prev[p], text[p], f)
          );
        }
      }
      animatedText.value = nextStr;

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
  }

  function stopTextAnimation() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  const permissionMode = computed(() => props.permissionMode);
  const size = computed(() => props.size);
</script>

<style scoped>
  .spinner {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    color: var(--app-spinner-foreground, var(--vscode-descriptionForeground));
    padding-left: 24px;
  }
  .icon {
    /* color: var(--app-spinner-foreground, var(--vscode-descriptionForeground)); */
    font-family: monospace;
    display: inline-block;
    width: 1.5em;
    text-align: center;
  }
  /* .spinner[data-permission-mode='acceptEdits'] .icon {
    color: var(--app-spinner-foreground, var(--vscode-descriptionForeground));
  }
  .spinner[data-permission-mode='plan'] .icon {
    color: var(--vscode-focusBorder, var(--app-button-background));
  } */
  .text {
    font-weight: 500;
    font-size: 12px;
    /* color: var(--app-spinner-foreground, var(--vscode-descriptionForeground)); */
  }
</style>
