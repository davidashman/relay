/**
 * useSession - Vue Composable for Session
 *
 * 1. Session alien-signals Vue refs
 * 2. alien computed Vue computed
 * 3. Vue-friendly API
 *
 * ```typescript
 * const session = new Session(...);
 * const sessionAPI = useSession(session);
 * // sessionAPI.messages Vue Ref<any[]>
 * // sessionAPI.busy Vue Ref<boolean>
 * ```
 */

import { computed } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { Session, SelectionRange } from '../core/Session';
import type { PermissionRequest } from '../core/PermissionRequest';
import type { BaseTransport } from '../transport/BaseTransport';
import type { ModelOption } from '../../../shared/messages';
import type { QueuedMessage } from '../types/queue';

/**
 * useSession
 */
export interface UseSessionReturn {
  connection: Ref<BaseTransport | undefined>;
  busy: Ref<boolean>;
  isLoading: Ref<boolean>;
  error: Ref<string | undefined>;
  sessionId: Ref<string | undefined>;
  isExplicit: Ref<boolean>;
  lastModifiedTime: Ref<number>;

  messages: Ref<any[]>;
  messageCount: Ref<number>;
  outboundQueue: Ref<QueuedMessage[]>;
  cwd: Ref<string | undefined>;
  permissionMode: Ref<PermissionMode>;
  summary: Ref<string | undefined>;
  modelSelection: Ref<string | undefined>;
  thinkingLevel: Ref<string>;
  effortLevel: Ref<string | undefined>;
  currentThinking: Ref<string | undefined>;
  hasActiveTool: Ref<boolean>;
  streamingText: Ref<string | undefined>;
  todos: Ref<any[]>;
  worktree: Ref<{ name: string; path: string } | undefined>;
  selection: Ref<SelectionRange | undefined>;
  compactingMode: Ref<boolean>;
  currentTurnToolCallCount: Ref<number>;
  roamingWarning: Ref<boolean>;

  usageData: Ref<{
    inputTokens: number;
    outputTokens: number;
    contextTokens: number;
    totalCost: number;
    contextWindow: number;
  }>;

  claudeConfig: ComputedRef<any>;
  config: ComputedRef<any>;
  permissionRequests: ComputedRef<PermissionRequest[]>;

  isOffline: ComputedRef<boolean>;

  getConnection: () => Promise<BaseTransport>;
  preloadConnection: () => Promise<void>;
  loadFromServer: () => Promise<void>;
  send: (
    input: string,
    attachments?: Array<{ fileName: string; mediaType: string; data: string }>,
    includeSelection?: boolean
  ) => Promise<void>;
  launchClaude: () => Promise<string>;
  interrupt: () => Promise<void>;
  restartClaude: () => Promise<void>;
  listFiles: (pattern?: string) => Promise<any>;
  setPermissionMode: (mode: PermissionMode, applyToConnection?: boolean) => Promise<boolean>;
  exitPlanMode: () => Promise<void>;
  setModel: (model: ModelOption) => Promise<boolean>;
  setThinkingLevel: (level: string) => Promise<void>;
  setEffortLevel: (level: string) => Promise<void>;
  getMcpServers: () => Promise<any>;
  openConfigFile: (configType: string) => Promise<void>;
  onPermissionRequested: (callback: (request: PermissionRequest) => void) => () => void;
  removeFromQueue: (id: string) => void;
  sendQueuedNow: (id: string) => void;
  isSessionRoaming: () => boolean;
  dismissRoamingWarning: () => void;
  dispose: () => void;

  __session: Session;
}

/**
 * useSession - Session Vue Composable API
 *
 * @param session Session
 * @returns Vue-friendly API
 */
export function useSession(session: Session): UseSessionReturn {
  // useSignal signals/computed
  const connection = useSignal(session.connection);
  const busy = useSignal(session.busy);
  const isLoading = useSignal(session.isLoading);
  const error = useSignal(session.error);
  const sessionId = useSignal(session.sessionId);
  const isExplicit = useSignal(session.isExplicit);
  const lastModifiedTime = useSignal(session.lastModifiedTime);
  const messages = useSignal(session.messages);
  const messageCount = useSignal(session.messageCount);
  const outboundQueue = useSignal(session.outboundQueue);
  const cwd = useSignal(session.cwd);
  const permissionMode = useSignal(session.permissionMode);
  const summary = useSignal(session.summary);
  const modelSelection = useSignal(session.modelSelection);
  const thinkingLevel = useSignal(session.thinkingLevel);
  const effortLevel = useSignal(session.effortLevel);
  const currentThinking = useSignal(session.currentThinking);
  const hasActiveTool = useSignal(session.hasActiveTool);
  const streamingText = useSignal(session.streamingText);
  const todos = useSignal(session.todos);
  const worktree = useSignal(session.worktree);
  const selection = useSignal(session.selection);
  const usageData = useSignal(session.usageData);
  const compactingMode = useSignal(session.compactingMode);
  const currentTurnToolCallCount = useSignal(session.currentTurnToolCallCount);
  const roamingWarning = useSignal(session.roamingWarning as any) as Ref<boolean>;

  // useSignal alien computed-only setter
  const claudeConfig = useSignal(session.claudeConfig as any);
  const config = useSignal(session.config as any);
  const permissionRequests = useSignal(session.permissionRequests) as unknown as ComputedRef<PermissionRequest[]>;

  // Vue computed
  const isOffline = computed(() => session.isOffline());

  // this
  const getConnection = session.getConnection.bind(session);
  const preloadConnection = session.preloadConnection.bind(session);
  const loadFromServer = session.loadFromServer.bind(session);
  const send = session.send.bind(session);
  const launchClaude = session.launchClaude.bind(session);
  const interrupt = session.interrupt.bind(session);
  const restartClaude = session.restartClaude.bind(session);
  const listFiles = session.listFiles.bind(session);
  const setPermissionMode = session.setPermissionMode.bind(session);
  const exitPlanMode = session.exitPlanMode.bind(session);
  const setModel = session.setModel.bind(session);
  const setThinkingLevel = session.setThinkingLevel.bind(session);
  const setEffortLevel = session.setEffortLevel.bind(session);
  const getMcpServers = session.getMcpServers.bind(session);
  const openConfigFile = session.openConfigFile.bind(session);
  const onPermissionRequested = session.onPermissionRequested.bind(session);
  const removeFromQueue = session.removeFromQueue.bind(session);
  const sendQueuedNow = session.sendQueuedNow.bind(session);
  const isSessionRoaming = session.isSessionRoaming.bind(session);
  const dismissRoamingWarning = session.dismissRoamingWarning.bind(session);
  const dispose = session.dispose.bind(session);

  return {
    connection,
    busy,
    isLoading,
    error,
    sessionId,
    isExplicit,
    lastModifiedTime,
    messages,
    messageCount,
    outboundQueue,
    cwd,
    permissionMode,
    summary,
    modelSelection,
    thinkingLevel,
    effortLevel,
    currentThinking,
    hasActiveTool,
    streamingText,
    todos,
    worktree,
    selection,
    usageData,
    compactingMode,
    currentTurnToolCallCount,
    roamingWarning,

    claudeConfig,
    config,
    permissionRequests,
    isOffline,

    getConnection,
    preloadConnection,
    loadFromServer,
    send,
    launchClaude,
    interrupt,
    restartClaude,
    listFiles,
    setPermissionMode,
    exitPlanMode,
    setModel,
    setThinkingLevel,
    setEffortLevel,
    getMcpServers,
    openConfigFile,
    onPermissionRequested,
    removeFromQueue,
    sendQueuedNow,
    isSessionRoaming,
    dismissRoamingWarning,
    dispose,

    __session: session,
  };
}
