<template>
  <div class="settings-page">
    <div class="settings-header">
      <h2 class="settings-title">Claudix Settings</h2>
    </div>
    <div class="settings-body">
      <div class="settings-section">
        <h3 class="settings-section-title">Sessions</h3>
        <label class="settings-row">
          <div class="settings-row-text">
            <span class="settings-row-label">Continue last session on startup</span>
            <span class="settings-row-description">When enabled, Claudix will resume the most recent session instead of starting a new one</span>
          </div>
          <button
            class="toggle-btn"
            :class="{ active: continueLastSession }"
            :aria-checked="continueLastSession"
            role="switch"
            @click="toggleContinueLastSession"
          >
            <span class="toggle-thumb" />
          </button>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const bootstrap = (window as any).CLAUDIX_BOOTSTRAP;
const vscode = (window as any).acquireVsCodeApi();

const continueLastSession = ref<boolean>(bootstrap?.settings?.continueLastSession ?? false);

function toggleContinueLastSession() {
  const newValue = !continueLastSession.value;
  continueLastSession.value = newValue;
  vscode.postMessage({ type: 'update_setting', key: 'claudix.continueLastSession', value: newValue });
}
</script>

<style scoped>
.settings-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
}

.settings-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
}

.settings-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--vscode-editor-foreground);
}

.settings-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.settings-section-title {
  margin: 0 0 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vscode-descriptionForeground);
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
  padding: 8px 0;
}

.settings-row-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.settings-row-label {
  font-size: 13px;
  color: var(--vscode-editor-foreground);
}

.settings-row-description {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.4;
}

.toggle-btn {
  flex-shrink: 0;
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  background: var(--vscode-input-border, #555);
  transition: background 0.15s ease;
  padding: 0;
  outline: none;
}

.toggle-btn:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}

.toggle-btn.active {
  background: var(--vscode-button-background, #0e7ef6);
}

.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s ease;
  pointer-events: none;
}

.toggle-btn.active .toggle-thumb {
  transform: translateX(16px);
}
</style>
