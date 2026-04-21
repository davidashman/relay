import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import type { SessionStore } from '../core/SessionStore';
import type { Session } from '../core/Session';
import type { SessionOptions } from '../core/Session';

export interface UseTabsReturn {
  /** The explicitly-opened tabs - independent of the full session history */
  tabs: Ref<Session[]>;
  /** Index of the active session in tabs.value; -1 if none */
  activeTabIndex: ComputedRef<number>;
  /** Register the initial startup session as the first (and only) tab */
  addTab: (session: Session) => void;
  /** Create a new session and open it in a new tab */
  createNewTab: (options?: SessionOptions) => Promise<Session>;
  /** Create a new session replacing the current tab in-place */
  replaceCurrentTab: () => Promise<Session>;
  /** Open an existing session in a new tab (or switch if already open) */
  openSessionInNewTab: (session: Session) => void;
  /** Close the tab at the given index */
  closeTab: (index: number) => void;
  /** Switch the active session to the one at the given index */
  switchToTab: (index: number) => void;
}

export function useTabs(sessionStore: SessionStore): UseTabsReturn {
  // Independent list of open tabs — NOT derived from sessionStore.sessions
  const openTabs = ref<Session[]>([]);

  // Bridge active session alien-signal -> Vue ref for computed below
  const activeSession = useSignal(sessionStore.activeSession);

  const activeTabIndex = computed<number>(() => {
    const active = activeSession.value;
    if (!active) return -1;
    return openTabs.value.indexOf(active);
  });

  function addTab(session: Session): void {
    if (!openTabs.value.includes(session)) {
      openTabs.value = [...openTabs.value, session];
    }
    sessionStore.setActiveSession(session);
  }

  async function createNewTab(options?: SessionOptions): Promise<Session> {
    const session = await sessionStore.createSession(options ?? { isExplicit: true });
    openTabs.value = [...openTabs.value, session];
    return session;
  }

  async function replaceCurrentTab(): Promise<Session> {
    const currentIndex = activeTabIndex.value;
    const session = await sessionStore.createSession({ isExplicit: true });

    if (currentIndex >= 0) {
      const arr = [...openTabs.value];
      arr.splice(currentIndex, 1, session);
      openTabs.value = arr;
    } else {
      openTabs.value = [...openTabs.value, session];
    }

    return session;
  }

  function openSessionInNewTab(session: Session): void {
    const existing = openTabs.value.indexOf(session);
    if (existing >= 0) {
      // Already open — just switch to it
      sessionStore.setActiveSession(session);
      return;
    }
    openTabs.value = [...openTabs.value, session];
    sessionStore.setActiveSession(session);
  }

  function closeTab(index: number): void {
    if (openTabs.value.length <= 1) {
      // Last tab — replace with a new empty session rather than leaving zero tabs
      void replaceCurrentTab();
      return;
    }

    const isActive = index === activeTabIndex.value;
    const arr = [...openTabs.value];
    arr.splice(index, 1);
    openTabs.value = arr;

    if (isActive) {
      // Switch to the nearest remaining tab
      const newIndex = Math.min(index, arr.length - 1);
      sessionStore.setActiveSession(arr[newIndex] as unknown as Session);
    }
  }

  function switchToTab(index: number): void {
    const session = openTabs.value[index];
    if (session) sessionStore.setActiveSession(session as Session);
  }

  return {
    tabs: openTabs as unknown as Ref<Session[]>,
    activeTabIndex,
    addTab,
    createNewTab,
    replaceCurrentTab,
    openSessionInNewTab,
    closeTab,
    switchToTab,
  };
}
