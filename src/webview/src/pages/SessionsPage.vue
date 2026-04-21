<template>
  <div class="sessions-page">
    <!-- Search bar - only shown when needed -->
    <Motion
      v-if="showSearch"
      class="search-bar"
      :initial="{ opacity: 0, y: -20 }"
      :animate="{ opacity: 1, y: 0 }"
      :exit="{ opacity: 0, y: -20 }"
      :transition="{ duration: 0.2, ease: 'easeOut' }"
    >
      <input
        ref="searchInput"
        v-model="searchQuery"
        type="text"
        placeholder="Search Agent/Chat Threads"
        class="search-input"
        @keydown.escape="hideSearch"
      >
    </Motion>

    <div class="page-content custom-scroll-container">
      <!-- Loading state -->
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <p>Loading session history...</p>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="error-state">
        <p class="error-message">{{ error }}</p>
        <button class="btn-primary" @click="refreshSessions">Retry</button>
      </div>

      <!-- Empty state -->
      <div v-else-if="sessionList.length === 0" class="empty-state">
        <div class="empty-icon">
          <Icon icon="comment-discussion" :size="48" />
        </div>
        <h3>No session history</h3>
        <p class="empty-hint">Your conversation history will appear here after you start chatting with Claude</p>
        <button class="btn-primary" @click="startNewChat">Start new chat</button>
      </div>

      <!-- Session list -->
      <div v-else class="sessions-container">
        <div
          v-for="(session, index) in filteredSessions"
          :key="session.sessionId.value || `temp-${index}`"
          class="session-card"
          @click="openSession(session)"
        >
            <div class="session-card-header">
              <h3 class="session-title">{{ session.summary.value || 'New Conversation' }}</h3>
              <div class="session-card-badges">
                <span
                  v-if="(session.permissionRequests.value?.length ?? 0) > 0"
                  class="session-permission-dot"
                  title="Awaiting approval"
                ></span>
                <div class="session-date">{{ formatRelativeTime(session.lastModifiedTime.value) }}</div>
              </div>
            </div>

            <span v-if="session.sessionId.value" class="session-id">{{ session.sessionId.value }}</span>
            <span class="session-messages">{{ session.messageCount.value }} messages</span>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, inject } from 'vue';
import { Motion } from 'motion-v';
import Icon from '../components/Icon.vue';
import { RuntimeKey } from '../composables/runtimeContext';
import { useSessionStore } from '../composables/useSessionStore';
import { useSession } from '../composables/useSession';
import type { Session } from '../core/Session';

// Inject runtime
const runtime = inject(RuntimeKey);
if (!runtime) {
  throw new Error('[SessionsPage] runtime not provided');
}

// 🔥 使用 useSessionStore 包装为 Vue-friendly API
const store = useSessionStore(runtime.sessionStore);

// 🔥 视图模型：将 alien-signals Session 转换为 Vue-friendly 包装
const sessionList = computed(() => {
  const rawSessions = (store.sessionsByLastModified.value || []).filter(Boolean) as Session[];
  return rawSessions.map(raw => useSession(raw));
});

// Component state
const loading = ref(true);
const error = ref('');
const searchQuery = ref('');
const showSearch = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);


// Computed: filter and sort session list
const filteredSessions = computed(() => {
  let sessions = [...sessionList.value];

  // Search filter
  const query = searchQuery.value.trim().toLowerCase();
  if (query) {
    sessions = sessions.filter(session => {
      const summary = (session.summary.value || '').toLowerCase();
      const sessionId = (session.sessionId.value || '').toLowerCase();
      return summary.includes(query) || sessionId.includes(query);
    });
  }

  // Already sorted by sessionsByLastModified in reverse chronological order, no need to sort again
  return sessions;
});

// Methods
const refreshSessions = async () => {
  loading.value = true;
  error.value = '';

  try {
    // 🔥 使用包装后的方法
    await store.listSessions();
  } catch (err) {
    error.value = `Failed to load sessions: ${err}`;
  } finally {
    loading.value = false;
  }
};


const openSession = async (wrappedSession: ReturnType<typeof useSession> | undefined) => {
  if (!wrappedSession) return;
  const connection = await runtime.connectionManager.get();
  const summary = wrappedSession.summary.value || '';
  const title = summary.length > 25 ? `${summary.slice(0, 24)}\u2026` : summary || 'Chat';
  await connection.openSessionPanel(
    wrappedSession.sessionId.value || null,
    title
  );
};

const createNewSession = async () => {
  const connection = await runtime.connectionManager.get();
  await connection.startNewConversationTab();
};

const startNewChat = async () => {
  const connection = await runtime.connectionManager.get();
  await connection.startNewConversationTab();
};

// Search functionality
const toggleSearch = async () => {
  showSearch.value = !showSearch.value;
  if (showSearch.value) {
    await nextTick();
    searchInput.value?.focus();
  } else {
    searchQuery.value = '';
  }
};

const hideSearch = () => {
  showSearch.value = false;
  searchQuery.value = '';
};

// Format relative time
function formatRelativeTime(input?: number | string | Date): string {
  if (input === undefined || input === null) return 'just now';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return 'just now';

  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.max(1, Math.round(diff / 3_600_000))}h ago`;
  const days = Math.max(1, Math.round(diff / 86_400_000));
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US');
}

// Handle messages from the extension (e.g. relay.toggleSearch command)
const handleExtensionMessage = async (event: MessageEvent) => {
  if (event.data?.type === 'from-extension' && event.data?.message?.type === 'toggle_search') {
    await toggleSearch();
  }
};

// Lifecycle
onMounted(() => {
  refreshSessions();
  window.addEventListener('message', handleExtensionMessage);
});

onUnmounted(() => {
  window.removeEventListener('message', handleExtensionMessage);
});
</script>

<style scoped>
.sessions-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  /* background: var(--vscode-editor-background); */
  color: var(--vscode-editor-foreground);
}

.search-bar {
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-panel-background);
  padding: 8px 12px;
}

.search-bar .search-input {
  width: 100%;
  padding: 2px 8px;
  border: 1px solid var(--vscode-input-border);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border-radius: 4px;
  font-size: 14px;
  outline: none;
}

.search-bar .search-input:focus {
  border-color: var(--vscode-focusBorder);
}

.btn-primary, .btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: baseline;
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background-color 0.2s;
}

.btn-primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.btn-primary:hover {
  background: var(--vscode-button-hoverBackground);
}

.btn-secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.btn-secondary:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.page-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.loading-state, .error-state, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  text-align: center;
  flex: 1;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--vscode-progressBar-background);
  border-top: 2px solid var(--vscode-progressBar-activeForeground);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-message {
  color: var(--vscode-errorForeground);
  margin-bottom: 16px;
}

.empty-state {
  gap: 16px;
}

.empty-icon {
  font-size: 48px;
  opacity: 0.6;
}

.empty-icon .codicon {
  font-size: 48px;
}

.empty-state h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
}

.empty-hint {
  color: var(--vscode-descriptionForeground);
  font-size: 14px;
  margin: 0;
}

.sessions-container {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.session-card {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 6px 12px;
  background: var(--vscode-editor-background);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.session-card:hover {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-list-hoverBackground);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.session-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.session-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  flex: 1;
  /* Limit title length to avoid overflow */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-card-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.session-date {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}

.session-permission-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vscode-notificationsInfoIcon-foreground, #4fc3f7);
  flex-shrink: 0;
}

.session-messages {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.session-id {
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 9px;
  font-style: italic;
  opacity: 0.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

</style>
