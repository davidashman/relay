<template>
  <div ref="container" class="terminal-view" />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Session } from '../core/Session';
import type { BaseTransport } from '../transport/BaseTransport';

const props = defineProps<{
  session: Session;
  connection: BaseTransport;
}>();

const container = ref<HTMLElement>();
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let resizeObserver: ResizeObserver | null = null;
let launched = false;

onMounted(async () => {
  if (!container.value) return;

  // Read VS Code terminal theme CSS variables to get actual computed values
  const style = getComputedStyle(document.documentElement);
  const cssVar = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;

  terminal = new Terminal({
    cursorBlink: true,
    scrollback: 5000,
    fontFamily: cssVar('--vscode-terminal-font-family', cssVar('--vscode-editor-font-family', '"Menlo", "Monaco", "Courier New", monospace')),
    fontSize: parseInt(cssVar('--vscode-terminal-font-size', '13'), 10) || 13,
    lineHeight: parseFloat(cssVar('--vscode-terminal-line-height', '1')) || 1,
    theme: {
      background:          cssVar('--vscode-panel-background',             '#1e1e1e'),
      foreground:          cssVar('--vscode-terminal-foreground',          '#cccccc'),
      cursor:              cssVar('--vscode-terminalCursor-foreground',    '#cccccc'),
      cursorAccent:        cssVar('--vscode-terminalCursor-background',    '#1e1e1e'),
      selectionBackground: cssVar('--vscode-terminal-selectionBackground', '#264f78'),
      black:               cssVar('--vscode-terminal-ansiBlack',           '#000000'),
      red:                 cssVar('--vscode-terminal-ansiRed',             '#cd3131'),
      green:               cssVar('--vscode-terminal-ansiGreen',           '#0dbc79'),
      yellow:              cssVar('--vscode-terminal-ansiYellow',          '#e5e510'),
      blue:                cssVar('--vscode-terminal-ansiBlue',            '#2472c8'),
      magenta:             cssVar('--vscode-terminal-ansiMagenta',         '#bc3fbc'),
      cyan:                cssVar('--vscode-terminal-ansiCyan',            '#11a8cd'),
      white:               cssVar('--vscode-terminal-ansiWhite',           '#e5e5e5'),
      brightBlack:         cssVar('--vscode-terminal-ansiBrightBlack',     '#666666'),
      brightRed:           cssVar('--vscode-terminal-ansiBrightRed',       '#f14c4c'),
      brightGreen:         cssVar('--vscode-terminal-ansiBrightGreen',     '#23d18b'),
      brightYellow:        cssVar('--vscode-terminal-ansiBrightYellow',    '#f5f543'),
      brightBlue:          cssVar('--vscode-terminal-ansiBrightBlue',      '#3b8eea'),
      brightMagenta:       cssVar('--vscode-terminal-ansiBrightMagenta',   '#d670d6'),
      brightCyan:          cssVar('--vscode-terminal-ansiBrightCyan',      '#29b8db'),
      brightWhite:         cssVar('--vscode-terminal-ansiBrightWhite',     '#e5e5e5'),
    },
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container.value);
  fitAddon.fit();

  // Forward keystrokes and pastes to the PTY
  terminal.onData((data) => {
    props.session.sendPtyInput(data);
  });

  // Launch the PTY once we know the dimensions
  const { cols, rows } = terminal;
  const channelId = await props.session.launchPty(cols, rows);
  launched = true;

  terminal.focus();

  // Route PTY output to xterm
  props.connection.ptyDataEvents.add(({ channelId: cid, data }) => {
    if (cid === channelId) {
      terminal?.write(data);
    }
  });

  props.connection.ptyExitEvents.add(({ channelId: cid, exitCode }) => {
    if (cid === channelId) {
      terminal?.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
    }
  });

  // Resize terminal when container size changes
  resizeObserver = new ResizeObserver(() => {
    if (!fitAddon || !terminal) return;
    try {
      fitAddon.fit();
      const { cols, rows } = terminal;
      props.session.sendPtyResize(cols, rows);
    } catch {
      // ignore resize errors during unmount
    }
  });
  resizeObserver.observe(container.value);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  terminal?.dispose();
  terminal = null;
  fitAddon = null;
});

defineExpose({ focus: () => terminal?.focus() });
</script>

<style scoped>
.terminal-view {
  width: 100%;
  height: 100%;
  overflow: hidden;
  min-height: 0;
  background-color: var(--vscode-panel-background, #1e1e1e);
}

.terminal-view :deep(.xterm) {
  height: 100%;
  padding: 6px 24px 0px;
  border: none !important;
  outline: none !important;
}

/* Make the viewport transparent so the outer div's background shows uniformly */
.terminal-view :deep(.xterm-viewport) {
  overflow-y: auto !important;
  background-color: transparent !important;
}

/* The canvas row container also gets a bg — clear it */
.terminal-view :deep(.xterm-rows) {
  background-color: transparent !important;
}
</style>
