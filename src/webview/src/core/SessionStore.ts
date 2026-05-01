import { signal, computed, effect } from 'alien-signals';
import { EventEmitter } from '../utils/events';
import type { ConnectionManager } from './ConnectionManager';
import { Session, type SessionContext, type SessionOptions } from './Session';
import type { PermissionRequest } from './PermissionRequest';
import type { SessionSummary } from './types';

export interface PermissionEvent {
  session: Session;
  permissionRequest: PermissionRequest;
}

export class SessionStore {
  readonly sessions = signal<Session[]>([]);
  readonly activeSession = signal<Session | undefined>(undefined);
  readonly permissionRequested = new EventEmitter<PermissionEvent>();

  readonly sessionsByLastModified = computed(() =>
    [...this.sessions()].sort((a, b) => b.lastModifiedTime() - a.lastModifiedTime())
  );

  readonly connectionState = computed(() => this.connectionManager.state());

  private currentConnectionPromise?: Promise<void>;
  private effectCleanups: Array<() => void> = [];
  /** Tracks whether a session has ever been active; prevents renaming to the default title
   *  before the first session loads (which would cause a spurious reactive re-fire when the
   *  connection signal changes and turn the title to 'Claude Code' during the loading spinner). */
  private hadActiveSession = false;

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly context: SessionContext
  ) {
    this.effectCleanups.push(
      effect(() => {
        if (this.connectionManager.connection()) {
          void this.listSessions();
        }
      })
    );

    this.effectCleanups.push(
      effect(() => {
        const session = this.activeSession();
        const defaultTitle = 'Claude Code';

        if (!session) {
          // Only reset to the default title after a session has been active at least once.
          // Calling renameTab here before that point reads the connection signal inside
          // panelRenameTab, which registers it as a reactive dependency. When the connection
          // is first established the effect would re-fire with session=undefined and
          // overwrite the correct bootstrap title with 'Claude Code'.
          if (this.hadActiveSession) {
            this.context.renameTab?.(defaultTitle);
          }
          return;
        }

        this.hadActiveSession = true;

        console.log(`[SessionStore] activeSession changed to ${session.sessionId()}, isOffline=${session.isOffline()}`);
        if (session.isOffline()) {
          console.log(`[SessionStore] calling loadFromServer for ${session.sessionId()}`);
          session.loadFromServer();
        } else {
          console.log(`[SessionStore] calling preloadConnection for ${session.sessionId()} (has connection=${!!session.connection?.()}, messages=${session.messages?.()?.length ?? '?'})`);
          session.preloadConnection();
        }

        const url = new URL(window.location.toString());
        if (session.sessionId()) {
          url.searchParams.set('session', session.sessionId()!);
        } else {
          url.searchParams.delete('session');
        }
        window.history.replaceState({}, '', url.toString());

        this.context.updatePanelSession?.(session.sessionId() ?? null);

        const summary = session.summary();
        const title = summary && summary.length > 25 ? `${summary.slice(0, 24)}…` : summary;
        this.context.renameTab?.(title || defaultTitle);
      })
    );

    this.effectCleanups.push(
      effect(() => {
        const sessions = this.sessions();
        const seen = new Map<string, Session>();
        const deduped: Session[] = [];
        let changed = false;

        for (const session of sessions) {
          const id = session.sessionId();
          if (!id) {
            deduped.push(session);
            continue;
          }

          const duplicate = seen.get(id);
          if (duplicate && duplicate !== session) {
            this.mergeSessionMetadata(duplicate, session);
            if (this.activeSession() === session) {
              this.activeSession(duplicate);
            }
            changed = true;
            continue;
          }

          seen.set(id, session);
          deduped.push(session);
        }

        if (changed) {
          this.sessions([...deduped].sort((a, b) => b.lastModifiedTime() - a.lastModifiedTime()));
        }
      })
    );
  }

  onPermissionRequested(callback: (event: PermissionEvent) => void): () => void {
    return this.permissionRequested.add(callback);
  }

  async getConnection() {
    return this.connectionManager.get();
  }

  async createSession(options: SessionOptions = {}): Promise<Session> {
    const session = new Session(() => this.getConnection(), this.context, options);

    this.sessions([session, ...this.sessions()]);
    this.activeSession(session);

    this.attachPermissionListener(session);

    // Eagerly establish connection so config becomes available
    await session.getConnection();

    return session;
  }

  async listSessions(): Promise<void> {
    if (this.currentConnectionPromise) {
      console.log('[SessionStore.listSessions] deduplicated — returning in-flight promise');
      return this.currentConnectionPromise;
    }

    console.log('[SessionStore.listSessions] starting RPC');
    this.currentConnectionPromise = (async () => {
      try {
        const connection = await this.getConnection();
        const response = await connection.listSessions();

        const rawIds = (response.sessions ?? []).map((s: any) => s.id);
        console.log(`[SessionStore.listSessions] RPC returned ${rawIds.length} sessions: [${rawIds.join(', ')}]`);

        const existing = new Map(
          this.sessions()
            .filter((session) => !!session.sessionId())
            .map((session) => [session.sessionId() as string, session])
        );

        for (const summary of response.sessions ?? []) {
          if (!summary.isCurrentWorkspace) {
            console.log(`[SessionStore.listSessions] skipping non-workspace session ${summary.id}`);
            continue;
          }

          const existingSession = existing.get(summary.id);
          if (existingSession) {
            existingSession.lastModifiedTime(summary.lastModified);
            existingSession.summary(summary.summary);
            existingSession.worktree(summary.worktree);
            existingSession.messageCount(summary.messageCount ?? 0);
            continue;
          }

          const session = Session.fromServer(
            summary as SessionSummary,
            () => this.getConnection(),
            this.context
          );

          this.attachPermissionListener(session);
          this.sessions([...this.sessions(), session]);
        }

        this.sessions(
          [...this.sessions()].sort((a, b) => b.lastModifiedTime() - a.lastModifiedTime())
        );
        console.log(`[SessionStore.listSessions] done, store now has ${this.sessions().length} sessions`);
      } catch (e) {
        console.error('[SessionStore.listSessions] error:', e);
        throw e;
      } finally {
        this.currentConnectionPromise = undefined;
      }
    })();

    await this.currentConnectionPromise;
  }

  setActiveSession(session: Session | undefined): void {
    this.activeSession(session);
  }

  /**
   * Wait for the session list to load, then return the session with the given
   * ID, or null if it doesn't exist or isn't part of the current workspace.
   */
  async loadSessionById(sessionId: string): Promise<Session | null> {
    await this.listSessions();
    return this.sessions().find(s => s.sessionId() === sessionId) ?? null;
  }

  dispose(): void {
    // effects
    for (const cleanup of this.effectCleanups) {
      cleanup();
    }
    this.effectCleanups = [];

    // sessions
    for (const session of this.sessions()) {
      session.dispose();
    }
  }

  private attachPermissionListener(session: Session): void {
    session.onPermissionRequested((request) => {
      this.permissionRequested.emit({
        session,
        permissionRequest: request
      });
      if (this.activeSession() !== session) {
        this.activeSession(session);
      }
    });
  }

  private mergeSessionMetadata(target: Session, source: Session): void {
    if (source.summary() && source.summary() !== target.summary()) {
      target.summary(source.summary());
    }

    if (source.lastModifiedTime() > target.lastModifiedTime()) {
      target.lastModifiedTime(source.lastModifiedTime());
    }

    if (!target.worktree() && source.worktree()) {
      target.worktree(source.worktree());
    }
  }
}
