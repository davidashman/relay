import { onMounted, onUnmounted, watch } from 'vue';
import { signal, effect } from 'alien-signals';
import { EventEmitter } from '../utils/events';
import { ConnectionManager } from '../core/ConnectionManager';
import { AppContext } from '../core/AppContext';
import { SessionStore } from '../core/SessionStore';
import type { SelectionRange, Session } from '../core/Session';
import { transport, atMentionEvents, selectionEvents } from '../core/runtimeTransport';
import { useTabs, type UseTabsReturn } from './useTabs';

export interface RuntimeInstance {
  connectionManager: ConnectionManager;
  appContext: AppContext;
  sessionStore: SessionStore;
  tabs: UseTabsReturn;
  atMentionEvents: EventEmitter<string>;
  selectionEvents: EventEmitter<any>;
  sessionLoading: ReturnType<typeof signal<boolean>>;
}

export function useRuntime(): RuntimeInstance {
  // Detect host context from bootstrap config
  const bootstrap = window.RELAY_BOOTSTRAP;
  const isPanelMode = bootstrap?.host === 'panel';
  // The sessionId to pre-select in panel mode (empty string = create new)
  const panelSessionId = isPanelMode ? (bootstrap?.sessionId ?? '') : '';
  // The initial title for this panel (from bootstrap, set before sessions load)
  const panelTitle = isPanelMode ? (bootstrap?.title ?? '') : '';
  // The agent to use for new sessions created in this panel
  const panelInitialAgent = isPanelMode ? (bootstrap?.initialAgent ?? '') : '';

  // sessionLoading is true while:
  //   (a) this panel has a panelSessionId but no activeSession yet (finding the session), OR
  //   (b) the active session's isLoading signal is true (loading messages from the server)
  // It starts as true for panels restoring an existing session, and is kept reactive thereafter.
  const sessionLoadingSignal = signal(isPanelMode && !!panelSessionId);

  // Transport Webview
  const connectionManager = new ConnectionManager(() => transport);
  const appContext = new AppContext(connectionManager);

  // alien-signal SessionContext
  // AppContext.currentSelection Vue Ref SessionContext alien-signal
  const currentSelectionSignal = signal<SelectionRange | undefined>(undefined);

  // Vue Ref ↔ Alien Signal
  // Vue Ref → Alien Signal
  watch(
    () => appContext.currentSelection(),
    (newValue) => {
      currentSelectionSignal(newValue);
    },
    { immediate: true }
  );

  // In panel mode, bypass the openNewInTab check so renameTab always fires
  // (panels always have openNewInTab semantics regardless of the config flag)
  const panelRenameTab = isPanelMode
    ? (title: string) => {
        const connection = connectionManager.connection();
        if (connection) { void connection.renameTab(title); return true; }
        return false;
      }
    : appContext.renameTab?.bind(appContext);

  const panelStartNewConversationTab = isPanelMode
    ? (initialPrompt?: string) => {
        const connection = connectionManager.connection();
        if (connection) { void connection.startNewConversationTab(initialPrompt); return true; }
        return false;
      }
    : appContext.startNewConversationTab?.bind(appContext);

  // Only meaningful in panel mode: notify the extension when the panel's
  // active session ID changes so the persisted open-panels list stays in sync
  // (e.g. after /clear creates a new session inside the same panel).
  const panelUpdatePanelSession = isPanelMode
    ? (sessionId: string | null) => {
        const connection = connectionManager.connection();
        if (connection) void connection.updatePanelSession(sessionId);
      }
    : undefined;

  const sessionStore = new SessionStore(connectionManager, {
    commandRegistry: appContext.commandRegistry,
    currentSelection: currentSelectionSignal,
    fileOpener: appContext.fileOpener,
    showNotification: appContext.showNotification?.bind(appContext),
    startNewConversationTab: panelStartNewConversationTab,
    renameTab: panelRenameTab,
    updatePanelSession: panelUpdatePanelSession,
    openURL: appContext.openURL.bind(appContext)
  });

  selectionEvents.add((selection) => {
    appContext.currentSelection(selection);
  });

  const tabs = useTabs(sessionStore);

  // Keep sessionLoadingSignal reactive: true while waiting for session to appear
  // (panelSessionId set but no activeSession yet) or while session.isLoading is true.
  effect(() => {
    const active = sessionStore.activeSession();
    if (!active) {
      sessionLoadingSignal(isPanelMode && !!panelSessionId);
    } else {
      sessionLoadingSignal(active.isLoading());
    }
  });

  // --- Notification wiring ---
  function tabTitle(session: Session): string {
    const s = session.summary();
    return s && s.length > 20 ? `${s.slice(0, 19)}\u2026` : (s || 'New Conversation');
  }

  // In panel mode, keep the VSCode tab icon in sync with session state:
  // pending (blue) → working (orange) → done (green)
  let _panelIconLastSession: Session | undefined;
  let _panelIconEverBusy = false;

  const stopPanelBadgeEffect = isPanelMode
    ? effect(() => {
        const activeSession = sessionStore.activeSession();
        const conn = connectionManager.connection();

        // Reset ever-busy tracking when the active session changes (e.g. after /clear)
        if (activeSession !== _panelIconLastSession) {
          _panelIconEverBusy = false;
          _panelIconLastSession = activeSession;
        }

        if (!activeSession || !conn) return;

        const permCount = activeSession.permissionRequests().length;
        const busy = activeSession.busy();

        if (busy) _panelIconEverBusy = true;

        let iconState: 'default' | 'working' | 'done' | 'pending';
        if (permCount > 0) iconState = 'pending';
        else if (busy) iconState = 'working';
        else if (_panelIconEverBusy) iconState = 'done';
        else iconState = 'default';

        void conn.setPanelBadge(permCount, iconState);
      })
    : undefined;

  const removePermissionListener = sessionStore.onPermissionRequested(({ session }) => {
    if (sessionStore.activeSession() !== session && tabs.tabs.value?.includes(session)) {
      void appContext.showNotification(
        `"${tabTitle(session)}" needs your permission`,
        'warning',
        [],
        true
      );
    }
  });

  const completionWatchers = new Map<Session, () => void>();

  const stopTabsWatch = watch(tabs.tabs, (currentTabs) => {
    if (!currentTabs) return;
    for (const session of currentTabs) {
      if (!completionWatchers.has(session)) {
        let lastBusy = session.busy();
        const stopEffect = effect(() => {
          const isBusy = session.busy();
          if (lastBusy && !isBusy && sessionStore.activeSession() !== session) {
            void appContext.showNotification(
              `"${tabTitle(session)}" has finished`,
              'info',
              [],
              true
            );
          }
          lastBusy = isBusy;
        });
        completionWatchers.set(session, stopEffect);
      }
    }
    for (const [session, stop] of completionWatchers) {
      if (!currentTabs.includes(session)) {
        stop();
        completionWatchers.delete(session);
      }
    }
  }, { immediate: true });

  // SessionStore effect connection

  // claudeConfig Slash Commands
  let slashCommandDisposers: Array<() => void> = [];

  const cleanupSlashCommands = effect(() => {
    const connection = connectionManager.connection();
    const claudeConfig = connection?.claudeConfig();

    // Slash Commands
    slashCommandDisposers.forEach(dispose => dispose());
    slashCommandDisposers = [];

    // Slash Commands
    if (claudeConfig?.slashCommands && Array.isArray(claudeConfig.slashCommands)) {
      slashCommandDisposers = claudeConfig.slashCommands
        .filter((cmd: any) => typeof cmd?.name === 'string' && cmd.name)
        .map((cmd: any) => {
          return appContext.commandRegistry.registerAction(
            {
              id: `slash-command-${cmd.name}`,
              label: `/${cmd.name}`,
              description: typeof cmd?.description === 'string' ? cmd.description : undefined
            },
            'Slash Commands',
            () => {
              console.log('[Runtime] Execute slash command:', cmd.name);
              const activeSession = sessionStore.activeSession();
              if (activeSession) {
                void activeSession.send(`/${cmd.name}`, [], false);
              } else {
                console.warn('[Runtime] No active session to execute slash command');
              }
            }
          );
        });

      console.log('[Runtime] Registered', slashCommandDisposers.length, 'slash commands');
    }
  });

  // Register built-in /clear command - replaces current tab with a new session
  appContext.commandRegistry.registerAction(
    {
      id: 'slash-command-clear',
      label: '/clear',
      description: 'Start a new session (replaces current tab)'
    },
    'Slash Commands',
    () => {
      void tabs.replaceCurrentTab();
    }
  );

  // Register built-in /new command - in panel mode opens a new panel, otherwise new tab
  appContext.commandRegistry.registerAction(
    {
      id: 'slash-command-new',
      label: '/new',
      description: isPanelMode ? 'Open a new chat panel' : 'Open a new session in a new tab'
    },
    'Slash Commands',
    () => {
      if (isPanelMode) {
        const connection = connectionManager.connection();
        if (connection) void connection.startNewConversationTab();
      } else {
        void tabs.createNewTab();
      }
    }
  );

  onMounted(() => {
    let disposed = false;

    (async () => {
      const connection = await connectionManager.get();
      try { await connection.opened; } catch (e) { console.error('[runtime] open failed', e); sessionLoadingSignal(false); return; }

      if (disposed) return;

      // Immediately set the panel title from bootstrap before sessions load,
      // so the tab title is correct from the first moment the webview is ready
      if (panelTitle) {
        void connection.renameTab(panelTitle);
      }

      connection.newSessionEvents.add(() => {
        if (!disposed) void tabs.replaceCurrentTab();
      });

      connection.newTabEvents.add(() => {
        if (disposed) return;
        if (isPanelMode) {
          // In panel mode, open a new panel instead of an internal tab
          void connection.startNewConversationTab();
        } else {
          void tabs.createNewTab();
        }
      });

      connection.closeTabEvents.add(() => {
        if (!disposed && !isPanelMode) tabs.closeTab(tabs.activeTabIndex.value);
        // In panel mode the user closes the panel with the native VSCode X button
      });

      connection.compactSessionEvents.add(() => {
        if (disposed) return;
        const activeSession = sessionStore.activeSession();
        if (activeSession) void activeSession.send('/compact', [], false);
      });

      try {
        const selection = await connection.getCurrentSelection();
        if (!disposed) appContext.currentSelection(selection?.selection ?? undefined);
      } catch (e) { console.warn('[runtime] selection fetch failed', e); }

      try {
        const assets = await connection.getAssetUris();
        if (!disposed) appContext.assetUris(assets.assetUris);
      } catch (e) { console.warn('[runtime] assets fetch failed', e); }

      console.log(`[restore] panelSessionId=${JSON.stringify(panelSessionId)} isPanelMode=${isPanelMode}`);
      if (!disposed && !sessionStore.activeSession()) {
        if (isPanelMode) {
          if (panelSessionId) {
            // Load the specific session directly rather than searching through
            // the full list — avoids the race where "not found" creates a new
            // tab that fires updatePanelSession(null) and wipes persisted history.
            const targetSession = await sessionStore.loadSessionById(panelSessionId);
            if (!disposed) {
              if (targetSession) {
                console.log(`[restore] found target session ${panelSessionId}, calling addTab`);
                tabs.addTab(targetSession);
              } else {
                console.error(`[restore] session ${panelSessionId} NOT FOUND — showing error`);
                // Stop the loading spinner (the reactive effect keeps it true while
                // panelSessionId is set and no activeSession exists; set it false
                // explicitly since we are not creating a session).
                sessionLoadingSignal(false);
                void appContext.showNotification(
                  `Could not restore session. The session may have been deleted or is no longer accessible.`,
                  'error'
                );
              }
            }
          } else {
            console.log(`[restore] no panelSessionId, creating new tab`);
            await tabs.createNewTab({ isExplicit: false, initialAgent: panelInitialAgent || undefined });
          }
        } else if (bootstrap?.host !== 'sidebar') {
          await tabs.createNewTab({ isExplicit: false });
        }
        // Sidebar mode: no tab creation needed — sidebar just shows session list
      }
      console.log(`[restore] done, activeSession=${sessionStore.activeSession()?.sessionId()}`);
    })();

    onUnmounted(() => {
      disposed = true;

      slashCommandDisposers.forEach(dispose => dispose());
      cleanupSlashCommands();

      removePermissionListener();
      stopPanelBadgeEffect?.();
      stopTabsWatch();
      for (const stop of completionWatchers.values()) stop();
      completionWatchers.clear();

      connectionManager.close();
    });
  });

  return { connectionManager, appContext, sessionStore, tabs, atMentionEvents, selectionEvents, sessionLoading: sessionLoadingSignal };
}

