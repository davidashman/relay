export interface SessionSummary {
  id: string;
  lastModified: number;
  summary: string;
  worktree?: { name: string; path: string };
  agent?: string;
  messageCount: number;
  isCurrentWorkspace: boolean;
}
