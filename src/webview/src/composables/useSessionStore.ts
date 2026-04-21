/**
 * useSessionStore - Vue Composable for SessionStore
 *
 * 1. SessionStore alien-signals Vue refs
 * 2. alien computed Vue computed
 * 3. Vue-friendly API
 *
 * ```typescript
 * const store = new SessionStore(...);
 * const storeAPI = useSessionStore(store);
 * // storeAPI.sessions Vue Ref<Session[]>
 * // storeAPI.activeSession Vue Ref<Session | undefined>
 * ```
 */

import type { ComputedRef, Ref } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import type { SessionStore, PermissionEvent } from '../core/SessionStore';
import type { Session, SessionOptions } from '../core/Session';
import type { BaseTransport } from '../transport/BaseTransport';

/**
 * useSessionStore
 */
export interface UseSessionStoreReturn {
  sessions: Ref<Session[]>;
  activeSession: Ref<Session | undefined>;

  sessionsByLastModified: ComputedRef<Session[]>;
  connectionState: ComputedRef<string>;

  onPermissionRequested: (callback: (event: PermissionEvent) => void) => () => void;
  getConnection: () => Promise<BaseTransport>;
  createSession: (options?: SessionOptions) => Promise<Session>;
  listSessions: () => Promise<void>;
  setActiveSession: (session: Session | undefined) => void;
  dispose: () => void;

  __store: SessionStore;
}

/**
 * useSessionStore - SessionStore Vue Composable API
 *
 * @param store SessionStore
 * @returns Vue-friendly API
 */
export function useSessionStore(store: SessionStore): UseSessionStoreReturn {
  // 🔥 useSignal
  const sessions = useSignal(store.sessions);
  const activeSession = useSignal(store.activeSession);

  // 🔥 useSignal alien computed
  const sessionsByLastModified = useSignal(store.sessionsByLastModified) as unknown as ComputedRef<Session[]>;
  const connectionState = useSignal(store.connectionState) as unknown as ComputedRef<string>;

  // 🔥 this
  const onPermissionRequested = store.onPermissionRequested.bind(store);
  const getConnection = store.getConnection.bind(store);
  const createSession = store.createSession.bind(store);
  const listSessions = store.listSessions.bind(store);
  const setActiveSession = store.setActiveSession.bind(store);
  const dispose = store.dispose.bind(store);

  return {
    sessions,
    activeSession,

    sessionsByLastModified,
    connectionState,

    onPermissionRequested,
    getConnection,
    createSession,
    listSessions,
    setActiveSession,
    dispose,

    __store: store,
  };
}
