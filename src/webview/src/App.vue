<template>
  <div class="app-wrapper">
    <main class="app-main">
      <div class="page-container">
        <Motion
          :animate="pageAnimation"
          :transition="{ duration: 0.3, ease: 'easeOut' }"
          class="motion-wrapper"
        >
          <SessionsPage
            v-if="currentPage === 'sessions'"
            key="sessions"
            @switch-to-chat="handleSwitchToChat"
          />
          <ChatPage
            v-else-if="currentPage === 'chat'"
            key="chat"
          />
          <SettingsPage
            v-else-if="currentPage === 'settings'"
            key="settings"
          />
          <!-- IconTestPage -->
          <!-- <IconTestPage
            v-else-if="currentPage === 'icontest'"
            key="icontest"
          /> -->
        </Motion>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, provide } from 'vue';
import { Motion } from 'motion-v';
import SessionsPage from './pages/SessionsPage.vue';
import ChatPage from './pages/ChatPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import './styles/claude-theme.css';
import { useRuntime } from './composables/useRuntime';
import { RuntimeKey } from './composables/runtimeContext';
import { transport } from './core/runtimeTransport';
// import IconTestPage from './pages/IconTestPage.vue';

type PageName = 'sessions' | 'chat' | 'settings';

const bootstrap = window.RELAY_BOOTSTRAP;
const initialPage = (bootstrap?.page as PageName | undefined) ?? 'chat';
const currentPage = ref<PageName>(initialPage);
const pageAnimation = ref({ opacity: 1, x: 0 });

const needsRuntime = initialPage === 'chat' || initialPage === 'sessions';
const runtime = needsRuntime ? useRuntime() : null;

if (runtime) {
  provide(RuntimeKey, runtime);
}

// Send focus state to extension via transport
function sendFocusState(focused: boolean) {
  transport.sendMessage({
    type: 'focus_changed',
    focused
  });
}

// Focus/blur event handlers
function handleFocus() {
  sendFocusState(true);
}

function handleBlur() {
  sendFocusState(false);
}

onMounted(() => {
  if (runtime) {
    console.log('[App] runtime initialized', runtime);
  } else {
    console.log('[App] runtime not initialized for page', initialPage);
  }

  // Set initial focus state and listen for focus changes
  window.addEventListener('focus', handleFocus);
  window.addEventListener('blur', handleBlur);

  // Send initial focus state
  sendFocusState(document.hasFocus());
});

onUnmounted(() => {
  window.removeEventListener('focus', handleFocus);
  window.removeEventListener('blur', handleBlur);
});

function switchToPage(page: 'sessions' | 'chat') {
  pageAnimation.value = { opacity: 0, x: 0 };

  setTimeout(() => {
    currentPage.value = page;
    if (page === 'sessions') {
      pageAnimation.value = { opacity: 0.7, x: -3 };
      setTimeout(() => {
        pageAnimation.value = { opacity: 1, x: 0 };
      }, 50);
    } else {
      pageAnimation.value = { opacity: 0.7, x: 3 };
      setTimeout(() => {
        pageAnimation.value = { opacity: 1, x: 0 };
      }, 50);
    }
  }, 0);
}

function handleSwitchToChat(sessionId?: string) {
  if (sessionId) {
    console.log('Switching to chat with session:', sessionId);
  }
  switchToPage('chat');
}
</script>

<style>
.app-wrapper {
  display: flex;
  flex-direction: column;
  height: 100vh;
  color: var(--vscode-editor-foreground);
}

.app-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.page-container {
  position: relative;
  flex: 1;
  width: 100%;
  overflow: hidden;
}

.motion-wrapper {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
}
</style>
