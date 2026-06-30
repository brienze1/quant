export interface Repo {
  id: string;
  name: string;
  path: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
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
  // When set, the new session adopts (resumes) this existing claude
  // conversation; the backend overrides the working directory to the
  // transcript's cwd and rejects worktree mode.
  claudeSessionId?: string;
}

// An on-disk claude CLI conversation not yet tracked by quant.
export interface ExternalSession {
  id: string;
  cwd: string;
  firstMessage: string;
  modTime: string;
  sizeBytes: number;
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
  // issue #50: typed metadata contract.
  inputs: JobInputSpec[];
  outputs: JobOutputSpec[];
  onSuccess: string[];
  onFailure: string[];
  triggeredBy: TriggerRef[];
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

// issue #50: typed metadata contract specs (mirror entity.JobInputSpec / JobOutputSpec).
export interface JobInputSpec {
  key: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
}

export interface JobOutputSpec {
  key: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  source: "produced" | "passthrough";
}

// Unified row shape used by SchemaFieldEditor for both inputs (required) and
// outputs (source). type/source are broadened to string because the editor's
// <select> onChange handlers assign raw e.target.value.
export interface SchemaField {
  key: string;
  type: string;
  required?: boolean;
  source?: string;
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
  // issue #50: typed metadata contract.
  inputs?: JobInputSpec[];
  outputs?: JobOutputSpec[];
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
  // issue #50: produced typed metadata + validation surface.
  metadata?: Record<string, unknown>;
  validationError?: string;
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
  activeSessionId: string;
  openSessionIds: string[];
  voicePaneOpen: boolean;

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
  // Base persona appended to every spawned session. Empty = use the built-in
  // default. `defaultBasePersona` is read-only (the built-in text) so the UI can
  // show it as a placeholder and offer a reset-to-default action.
  basePersona: string;
  defaultBasePersona?: string;

  // Remote Access
  remoteAccessEnabled: boolean;
  remoteAccessPort: number;
  remoteAccessPasscode: string;

  // Voice
  voice: VoiceConfig;
}

// VoiceConfig mirrors the Go entity.VoiceConfig / VoiceConfigDTO. The raw API key
// is never sent to the frontend: `apiKey` is write-only (set it to change the key,
// leave it empty/undefined to keep the existing one) and `hasApiKey` reports
// whether a key is currently stored Go-side.
export interface VoiceConfig {
  enabled: boolean;
  provider: "auto" | "local" | "cloud";
  // baseUrl is the legacy single endpoint, kept as a back-compat fallback for
  // both STT and TTS when the per-operation URLs below are empty.
  baseUrl: string;
  // Separate self-hosted STT/TTS endpoints (e.g. Whisper :2022, Kokoro :8880).
  // Empty = fall back to baseUrl, then the provider default. Not secrets.
  sttBaseUrl: string;
  ttsBaseUrl: string;
  apiKey?: string;
  hasApiKey?: boolean;
  sttModel: string;
  ttsModel: string;
  voice: string;
  speed: number;
  // Milliseconds of silence the VAD waits through before ending the user's turn
  // (frontend redemption window); higher = more time to pause/think mid-sentence.
  pauseMs: number;
  // Optional user-authored guidance appended to the built-in voice persona at
  // session kickoff. Empty = none.
  instructions: string;
}

// VoiceSpeechResult is the payload returned by the Synthesize proxy: base64
// audio + its content type. Returned as a struct (not a tuple) so it round-trips
// over both the Wails desktop and remote/tunnel transports.
export interface VoiceSpeechResult {
  audioB64: string;
  contentType: string;
}

// VoicePingResult mirrors the Go voice.PingResult struct returned by the
// per-engine connection probe (Settings → Voice "Test connection"): whether the
// STT/TTS server is reachable plus a short human-readable detail.
export interface VoicePingResult {
  ok: boolean;
  detail: string;
}

// --- Remote Access ---

// RemoteStatus mirrors the Go remote.Status struct returned by remoteController.
export interface RemoteStatus {
  enabled: boolean;
  url: string;
  passcode: string;
  port: number;
  clients: number;
  cloudflaredInstalled: boolean;
  error: string;
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

// --- Mindmap ---

export interface MindmapNode {
  id: string;
  parentId: string;
  kind: string;
  label: string;
  text: string;
  status: string;
  note: string;
  progress: number;
  board: string;
  color?: string;
}

// --- Files pane ---

// FileEntry mirrors the Go entity.FileEntry returned by fileController.ListDir.
// `path` is always forward-slash relative to the session root.
export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modTime: string;
}

// FileReadResult mirrors the Go entity.FileContent returned by
// fileController.ReadFile. tooLarge/binary files come back with empty content.
export interface FileReadResult {
  content: string;
  size: number;
  tooLarge: boolean;
  binary: boolean;
}

// FileBase64Result mirrors the Go entity.FileBase64Content returned by
// fileController.ReadFileBase64 (raw bytes for image tabs). tooLarge files
// come back with empty contentBase64.
export interface FileBase64Result {
  contentBase64: string;
  mime: string;
  size: number;
  tooLarge: boolean;
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

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes: string;
  releaseUrl: string;
}
