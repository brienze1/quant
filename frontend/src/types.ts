export interface Repo {
  id: string;
  name: string;
  path: string;
  workspaceId: string;
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
  workspaceId: string;
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
  workspaceId?: string;
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
  workspaceId?: string;
}

// --- Jobs ---

export type JobType = "claude" | "bash";
export type JobRunStatus = "pending" | "running" | "success" | "failed" | "cancelled" | "timed_out" | "waiting";
export type ScheduleType = "recurring" | "one_time";

export interface Job {
  id: string;
  name: string;
  description: string;
  type: JobType;
  workingDirectory: string;
  scheduleEnabled: boolean;
  scheduleType: ScheduleType;
  cronExpression: string;
  scheduleInterval: number;
  timeoutSeconds: number;
  prompt: string;
  allowBypass: boolean;
  autonomousMode: boolean;
  maxRetries: number;
  model: string;
  overrideRepoCommand: string;
  claudeCommand: string;
  agentId?: string;
  successPrompt: string;
  failurePrompt: string;
  metadataPrompt: string;
  triagePrompt: string;
  interpreter: string;
  scriptContent: string;
  envVariables: Record<string, string>;
  onSuccess: string[];
  onFailure: string[];
  triggeredBy: TriggerRef[];
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TriggerRef {
  jobId: string;
  triggerOn: "success" | "failure";
}

export interface CreateJobRequest {
  name: string;
  description: string;
  type: JobType;
  workingDirectory: string;
  scheduleEnabled: boolean;
  scheduleType: ScheduleType;
  cronExpression: string;
  scheduleInterval: number;
  timeoutSeconds: number;
  prompt: string;
  allowBypass: boolean;
  autonomousMode: boolean;
  maxRetries: number;
  model: string;
  overrideRepoCommand: string;
  claudeCommand: string;
  agentId?: string;
  successPrompt: string;
  failurePrompt: string;
  metadataPrompt: string;
  triagePrompt: string;
  interpreter: string;
  scriptContent: string;
  envVariables: Record<string, string>;
  onSuccess: string[];
  onFailure: string[];
  workspaceId?: string;
}

export interface UpdateJobRequest extends CreateJobRequest {
  id: string;
}

export interface JobRun {
  id: string;
  jobId: string;
  status: JobRunStatus;
  triggeredBy: string;
  correlationId: string;
  sessionId: string;
  modelUsed: string;
  durationMs: number;
  tokensUsed: number;
  result: string;
  errorMessage: string;
  injectedContext: string;
  startedAt: string;
  finishedAt: string;
}

export interface DiffFile {
  path: string;
  status: string; // "M" | "A" | "D" | "R" | "?"
  oldPath: string;
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
  assistantModel: string;
  envVariables: Record<string, string>;
  commandOverrides: Record<string, string>;
}

// --- Agents ---

export interface Agent {
  id: string;
  name: string;
  color: string;
  role: string;
  goal: string;
  model: string;
  autonomousMode: boolean;
  mcpServers: Record<string, boolean>;
  envVariables: Record<string, string>;
  boundaries: string[];
  skills: Record<string, boolean>;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentRequest {
  name: string;
  color: string;
  role: string;
  goal: string;
  model: string;
  autonomousMode: boolean;
  mcpServers: Record<string, boolean>;
  envVariables: Record<string, string>;
  boundaries: string[];
  skills: Record<string, boolean>;
  workspaceId?: string;
}

export interface UpdateAgentRequest extends CreateAgentRequest {
  id: string;
}

export interface SkillInfo {
  name: string;
  filePath: string;
}

// --- Workspaces ---

export interface Workspace {
  id: string;
  name: string;
  claudeConfigPath?: string;
  mcpConfigPath?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Job Groups ---

export interface JobGroup {
  id: string;
  name: string;
  jobIds: string[];
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobGroupRequest {
  name: string;
  jobIds: string[];
  workspaceId?: string;
}

export interface UpdateJobGroupRequest {
  id: string;
  name: string;
  jobIds: string[];
  workspaceId?: string;
}

export interface CreateWorkspaceRequest {
  name: string;
  claudeConfigPath?: string;
  mcpConfigPath?: string;
}

export interface UpdateWorkspaceRequest {
  id: string;
  name: string;
  claudeConfigPath?: string;
  mcpConfigPath?: string;
}

export interface PathValidationResult {
  claudeConfigValid: boolean;
  claudeConfigError: string;
  mcpConfigValid: boolean;
  mcpConfigError: string;
}

// --- Changelog ---

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: Record<string, string[]>;
}

export interface Changelog {
  entries: ChangelogEntry[];
}
