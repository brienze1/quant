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
  sessionType: SessionType;
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

export type SessionType = "claude" | "terminal";

export interface CreateSessionRequest {
  name: string;
  description: string;
  repoId: string;
  taskId?: string;
  sessionType: SessionType;
  useWorktree: boolean;
  skipPermissions: boolean;
  autoPull: boolean;
  pullBranch: string;
  branchNamePattern: string;
  model: string;
  extraCliArgs: string;
  directoryOverride?: string;
}

export interface Shortcut {
  name: string;
  command: string;
}

export interface Config {
  // General
  startOnLogin: boolean;
  notifications: boolean;
  autoUpdate: boolean;
  shortcuts: Shortcut[];

  // Git & Branches
  autoPull: boolean;
  defaultPullBranch: string;
  branchNamePattern: string;
  commitMessagePrefix: string;
  deleteBranchOnDone: boolean;
  branchOverrides: Record<string, string>;

  // Sessions
  useWorktreeDefault: boolean;
  skipPermissions: boolean;
  maxConcurrentSessions: number;
  autoResumeOnStart: boolean;
  autoStopIdle: boolean;
  idleTimeoutMinutes: number;

  // Storage & Data
  dataDirectory: string;
  worktreeDirectory: string;
  logDirectory: string;

  // Terminal
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: string;
  cursorBlink: boolean;
  scrollbackLines: number;
  newLineKey: string;

  // Claude CLI
  cliBinaryPath: string;
  extraCliArgs: string;
  defaultModel: string;
  envVariables: Record<string, string>;
}
