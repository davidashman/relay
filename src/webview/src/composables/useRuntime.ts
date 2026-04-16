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
  const bootstrap = window.CLAUDIX_BOOTSTRAP;
  const isPanelMode = bootstrap?.host === 'panel';
  // The sessionId to pre-select in panel mode (empty string = create new)
  const panelSessionId = isPanelMode ? (bootstrap?.id ?? '') : '';
  // The initial title for this panel (from bootstrap, set before sessions load)
  const panelTitle = isPanelMode ? (bootstrap?.title ?? '') : '';

  // True while the panel is loading an existing session (before activeSession is set)
  const isLoadingExistingSession = isPanelMode && !!panelSessionId && !panelSessionId.startsWith('new-chat-');
  const sessionLoadingSignal = signal(isLoadingExistingSession);

  // 复用全局 Transport 单例，确保同一 Webview 宿主只存在一条通信通道
  const connectionManager = new ConnectionManager(() => transport);
  const appContext = new AppContext(connectionManager);

  // 创建 alien-signal 用于 SessionContext
  // AppContext.currentSelection 是 Vue Ref，但 SessionContext 需要 alien-signal
  const currentSelectionSignal = signal<SelectionRange | undefined>(undefined);

  // 双向同步 Vue Ref ↔ Alien Signal
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

  const sessionStore = new SessionStore(connectionManager, {
    commandRegistry: appContext.commandRegistry,
    currentSelection: currentSelectionSignal,
    fileOpener: appContext.fileOpener,
    showNotification: appContext.showNotification?.bind(appContext),
    startNewConversationTab: panelStartNewConversationTab,
    renameTab: panelRenameTab,
    openURL: appContext.openURL.bind(appContext)
  });

  selectionEvents.add((selection) => {
    appContext.currentSelection(selection);
  });

  const tabs = useTabs(sessionStore);

  // --- Notification wiring ---
  function tabTitle(session: Session): string {
    const s = session.summary();
    return s && s.length > 20 ? `${s.slice(0, 19)}\u2026` : (s || 'New Conversation');
  }

  // In panel mode, keep the VSCode editor tab badge in sync with pending permission requests
  const stopPanelBadgeEffect = isPanelMode
    ? effect(() => {
        const activeSession = sessionStore.activeSession();
        const conn = connectionManager.connection();
        if (!activeSession || !conn) return;
        const count = activeSession.permissionRequests().length;
        void conn.setPanelBadge(count);
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

  // SessionStore 内部的 effect 会自动监听 connection 建立并拉取会话列表

  // 监听 claudeConfig 变化并注册 Slash Commands
  let slashCommandDisposers: Array<() => void> = [];

  const cleanupSlashCommands = effect(() => {
    const connection = connectionManager.connection();
    const claudeConfig = connection?.claudeConfig();

    // 清理旧的 Slash Commands
    slashCommandDisposers.forEach(dispose => dispose());
    slashCommandDisposers = [];

    // 注册新的 Slash Commands
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

      try {
        const selection = await connection.getCurrentSelection();
        if (!disposed) appContext.currentSelection(selection?.selection ?? undefined);
      } catch (e) { console.warn('[runtime] selection fetch failed', e); }

      try {
        const assets = await connection.getAssetUris();
        if (!disposed) appContext.assetUris(assets.assetUris);
      } catch (e) { console.warn('[runtime] assets fetch failed', e); }

      await sessionStore.listSessions();
      if (!disposed && !sessionStore.activeSession()) {
        if (isPanelMode) {
          // Panel mode: pre-select the session from bootstrap.id, or create new
          const isNewSession = !panelSessionId || panelSessionId.startsWith('new-chat-');
          if (!isNewSession) {
            // Find the session with matching ID in the loaded sessions
            const targetSession = sessionStore.sessions().find(
              s => s.sessionId() === panelSessionId
            );
            if (targetSession) {
              tabs.addTab(targetSession);
            } else {
              // Session not found (maybe from another workspace), create new
              await tabs.createNewTab({ isExplicit: false });
            }
          } else {
            await tabs.createNewTab({ isExplicit: false });
          }
        } else if (bootstrap?.host !== 'sidebar') {
          await tabs.createNewTab({ isExplicit: false });
        }
        // Sidebar mode: no tab creation needed — sidebar just shows session list
      }
      // Clear loading state once sessions are resolved
      sessionLoadingSignal(false);
    })();

    onUnmounted(() => {
      disposed = true;

      // 清理命令注册
      slashCommandDisposers.forEach(dispose => dispose());
      cleanupSlashCommands();

      // 清理通知监听器
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

