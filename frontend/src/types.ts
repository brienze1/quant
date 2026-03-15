export interface Repo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  repoId: string;
  tag: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string;
}

export interface Session {
  id: string;
  name: string;
  description: string;
  status: "idle" | "running" | "paused" | "done" | "error";
  repoId: string;
  taskId: string;
  directory: string;
  worktreePath: string;
  branchName: string;
  claudeConvId: string;
  pid: number;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  archivedAt: string;
}

export type ActionType =
  | "user_message"
  | "claude_read"
  | "claude_edit"
  | "claude_create"
  | "claude_bash"
  | "claude_result";

export interface Action {
  id: string;
  sessionId: string;
  type: ActionType;
  content: string;
  timestamp: string;
}

export interface CreateRepoRequest {
  name: string;
  path: string;
}

export interface CreateTaskRequest {
  repoId: string;
  tag: string;
  name: string;
}

export interface CreateSessionRequest {
  name: string;
  description: string;
  repoId: string;
  taskId?: string;
  useWorktree?: boolean;
  skipPermissions?: boolean;
}
