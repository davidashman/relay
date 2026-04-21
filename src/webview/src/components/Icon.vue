<template>
  <span v-if="useLocalSvg" :class="svgWrapperClasses" :style="iconStyle" aria-hidden="true">
    <svg class="icon-svg" focusable="false">
      <use :href="`#${localSymbolId}`" />
    </svg>
  </span>
  <i v-else :class="iconClasses" :style="iconStyle"></i>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ids from 'virtual:svg-icons-names';

type IconType = 'codicon' | 'mdi';

interface Props {
  icon: string;
  type?: IconType;
  size?: number | string;
  color?: string;
  className?: string;
}

const props = withDefaults(defineProps<Props>(), {
  type: 'codicon',
  size: 16
});

// vite-plugin-svg-icons symbolId
const svgNames = new Set(ids);
const svgPrefix = 'icon-';

function resolveLocalId(name: string): string | '' {
  const candidates: string[] = [];
  const base = name.trim();
  // 1)
  candidates.push(`${svgPrefix}${base}`);
  // 2) language- ->
  if (base.startsWith('language-')) {
    candidates.push(`${svgPrefix}${base.replace(/^language-/, '')}`);
  }
  // 3) file- -> -box
  if (base.startsWith('file-')) {
    const stripped = base.replace(/^file-/, '').replace(/-box$/, '');
    candidates.push(`${svgPrefix}${stripped}`);
  }
  // 4) folder- ->
  if (base.startsWith('folder-')) {
    candidates.push(`${svgPrefix}${base.replace(/^folder-/, '')}`);
  }
  // 5)
  const aliasMap: Record<string, string> = {
    'microsoft-visual-studio-code': 'vscode',
  };
  if (aliasMap[base]) {
    candidates.push(`${svgPrefix}${aliasMap[base]}`);
  }

  for (const id of candidates) {
    if (svgNames.has(id)) return id;
  }
  return '';
}

const iconClasses = computed(() => {
  const baseClasses = [props.className];

  if (props.type === 'mdi') {
    baseClasses.push('mdi', `mdi-${props.icon}`);
  } else {
    baseClasses.push('codicon', `codicon-${props.icon}`);
  }

  return baseClasses.filter(Boolean);
});

// SVG symbolId
const localSymbolId = computed(() => {
  if (props.type !== 'mdi') return '';
  const name = String(props.icon || '').trim();
  return resolveLocalId(name);
});

const useLocalSvg = computed(() => !!localSymbolId.value);

const svgWrapperClasses = computed(() => {
  const classes = [props.className];
  if (props.type === 'mdi') classes.push('mdi');
  return classes.filter(Boolean);
});

const iconStyle = computed(() => {
  const style: Record<string, any> = {
    fontSize: typeof props.size === 'number' ? `${props.size}px` : props.size,
    lineHeight: 1,
    display: 'inline-block',
    verticalAlign: 'middle'
  };

  // color
  if (props.color) {
    style.color = props.color;
  }

  return style;
});
</script>

<style scoped>
.codicon,
.mdi {
  transition: color 0.2s ease;
}

.icon-svg {
  width: 1em;
  height: 1em;
  fill: currentColor;
  display: inline-block;
  vertical-align: middle;
}
</style>
