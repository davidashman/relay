<template>
  <div
    ref="container"
    class="terminal-view"
    @dragover="handleDragOver"
    @drop="handleDrop"
  />
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
let shiftEnterBlocker: ((e: KeyboardEvent) => void) | null = null;

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

  // Capture Shift+Enter before xterm's textarea sees it: block the keystroke and
  // send \u001b\r (Meta+Enter) so Claude CLI inserts a newline without submitting.
  shiftEnterBlocker = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      props.session.sendPtyInput('\u001b\r');
    }
  };
  container.value.addEventListener('keydown', shiftEnterBlocker, { capture: true });

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
  if (shiftEnterBlocker && container.value) {
    container.value.removeEventListener('keydown', shiftEnterBlocker, { capture: true } as EventListenerOptions);
    shiftEnterBlocker = null;
  }
  resizeObserver?.disconnect();
  terminal?.dispose();
  terminal = null;
  fitAddon = null;
});

function handleDragOver(event: DragEvent) {
  const types = Array.from(event.dataTransfer?.types ?? []);
  if (!types.includes('Files') && !types.includes('text/uri-list')) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

async function handleDrop(event: DragEvent) {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return;

  const types = Array.from(dataTransfer.types);
  if (!types.includes('Files') && !types.includes('text/uri-list')) return;

  event.preventDefault();
  event.stopPropagation();

  // Binary file drop (e.g. from Finder) — stage to temp dir then inject @path
  const files = dataTransfer.files;
  if (files && files.length > 0) {
    for (const file of Array.from(files)) {
      try {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const { filePath } = await props.connection.stageFile(file.name, data);
        props.session.sendPtyInput(`@${filePath} `);
      } catch (e) {
        console.error('[TerminalView] Failed to stage dropped file:', e);
      }
    }
    return;
  }

  // URI-list drop (e.g. dragged from VS Code explorer) — inject @path directly
  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList) {
    const paths = uriList
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(uri => {
        try {
          const url = new URL(uri);
          if (url.protocol === 'file:') return decodeURIComponent(url.pathname);
        } catch { /* ignore */ }
        return null;
      })
      .filter((p): p is string => p !== null);

    for (const p of paths) {
      props.session.sendPtyInput(`@${p} `);
    }
  }
}

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
