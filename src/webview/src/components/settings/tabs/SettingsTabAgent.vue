<template>
  <SettingsTab title="Agent">
    <!-- Default Agent Section -->
    <SettingsSection title="Session Defaults">
      <SettingsSubSection caption="Configure which agent definition is used when starting new sessions.">
        <SettingsCell
          label="Default Agent"
          description="Agent used when opening new sessions via Cmd+N. Leave empty for no agent."
        >
          <template #trailing>
            <div v-if="loading" class="agent-loading">Loading…</div>
            <select
              v-else
              class="agent-select"
              :value="defaultAgent"
              @change="updateDefaultAgent(($event.target as HTMLSelectElement).value)"
            >
              <option value="">None (default Claude Code)</option>
              <option
                v-for="agent in agents"
                :key="agent.name"
                :value="agent.name"
              >{{ agent.name }}{{ agent.description ? ` — ${agent.description}` : '' }}</option>
            </select>
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>

    <!-- Chat History Section -->
    <SettingsSection title="Chat History">
      <SettingsSubSection>
        <SettingsCell
          label="Cleanup Period"
          description="How long to locally retain chat transcripts based on last activity date"
        >
          <template #trailing>
            <div class="flex items-center gap-2">
              <NumberInput
                :model-value="cleanupPeriodDays"
                @update:model-value="updateCleanupPeriod"
                :min="1"
                width="68px"
              />
              <span class="text-xs text-(--cursor-text-secondary)">days</span>
            </div>
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>
  </SettingsTab>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import NumberInput from '../../Common/NumberInput.vue';
import { useSettingsStore } from '../../../composables/useSettingsStore';
import { transport } from '../../../core/runtimeTransport';
import type { AgentDefinition } from '../../../../../shared/messages';

const { settings, updateSetting } = useSettingsStore();

const cleanupPeriodDays = computed(() => settings.value.cleanupPeriodDays ?? 720);
const updateCleanupPeriod = (value: number) => {
  updateSetting('cleanupPeriodDays', value, 'global');
};

const agents = ref<AgentDefinition[]>([]);
const defaultAgent = ref('');
const loading = ref(true);

onMounted(async () => {
  try {
    const [agentsResp, configResp] = await Promise.all([
      transport.listAgents(),
      transport.getExtensionConfig(),
    ]);
    agents.value = agentsResp?.agents ?? [];
    defaultAgent.value = configResp?.config?.defaultAgent ?? '';
  } catch (e) {
    console.error('[SettingsTabAgent] Failed to load agents or config:', e);
  } finally {
    loading.value = false;
  }
});

async function updateDefaultAgent(value: string) {
  defaultAgent.value = value;
  try {
    await transport.updateExtensionConfig('defaultAgent', value);
  } catch (e) {
    console.error('[SettingsTabAgent] Failed to save defaultAgent:', e);
  }
}
</script>

<style scoped>
.agent-loading {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.agent-select {
  background: var(--vscode-dropdown-background);
  color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border);
  border-radius: 3px;
  padding: 3px 6px;
  font-size: 12px;
  cursor: pointer;
  max-width: 280px;
}

.agent-select:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
</style>
