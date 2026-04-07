import { onMounted, onUnmounted, watch } from 'vue';
import { signal, effect } from 'alien-signals';
import { EventEmitter } from '../utils/events';
import { ConnectionManager } from '../core/ConnectionManager';
import { VSCodeTransport } from '../transport/VSCodeTransport';
import { AppContext } from '../core/AppContext';
import { SessionStore } from '../core/SessionStore';
import type { SelectionRange, Session } from '../core/Session';
import { useTabs, type UseTabsReturn } from './useTabs';

export interface RuntimeInstance {
  connectionManager: ConnectionManager;
  appContext: AppContext;
  sessionStore: SessionStore;
  tabs: UseTabsReturn;
  atMentionEvents: EventEmitter<string>;
  selectionEvents: EventEmitter<any>;
}

export function useRuntime(): RuntimeInstance {
  const atMentionEvents = new EventEmitter<string>();
  const selectionEvents = new EventEmitter<any>();

  const connectionManager = new ConnectionManager(() => new VSCodeTransport(atMentionEvents, selectionEvents));
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

  const sessionStore = new SessionStore(connectionManager, {
    commandRegistry: appContext.commandRegistry,
    currentSelection: currentSelectionSignal,
    fileOpener: appContext.fileOpener,
    showNotification: appContext.showNotification?.bind(appContext),
    startNewConversationTab: appContext.startNewConversationTab?.bind(appContext),
    renameTab: appContext.renameTab?.bind(appContext),
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

  // Register built-in /new command - opens a new session in a new tab
  appContext.commandRegistry.registerAction(
    {
      id: 'slash-command-new',
      label: '/new',
      description: 'Open a new session in a new tab'
    },
    'Slash Commands',
    () => {
      void tabs.createNewTab();
    }
  );

  onMounted(() => {
    let disposed = false;

    (async () => {
      const connection = await connectionManager.get();
      try { await connection.opened; } catch (e) { console.error('[runtime] open failed', e); return; }

      if (disposed) return;

      connection.newSessionEvents.add(() => {
        if (!disposed) void tabs.replaceCurrentTab();
      });

      connection.newTabEvents.add(() => {
        if (!disposed) void tabs.createNewTab();
      });

      connection.closeTabEvents.add(() => {
        if (!disposed) tabs.closeTab(tabs.activeTabIndex.value);
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
        const continueLastSession = connection.config()?.continueLastSession ?? false;
        const recentSessions = sessionStore.sessionsByLastModified();
        if (continueLastSession && recentSessions.length > 0) {
          tabs.addTab(recentSessions[0]);
        } else {
          await tabs.createNewTab({ isExplicit: false });
        }
      }
    })();

    onUnmounted(() => {
      disposed = true;

      // 清理命令注册
      slashCommandDisposers.forEach(dispose => dispose());
      cleanupSlashCommands();

      // 清理通知监听器
      removePermissionListener();
      stopTabsWatch();
      for (const stop of completionWatchers.values()) stop();
      completionWatchers.clear();

      connectionManager.close();
    });
  });

  return { connectionManager, appContext, sessionStore, tabs, atMentionEvents, selectionEvents };
}

