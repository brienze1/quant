import type {
  Repo,
  Task,
  Session,
  Action,
  Config,
  DiffFile,
  Job,
  JobRun,
  Agent,
  SkillInfo,
  Workspace,
  JobGroup,
  Changelog,
  UpdateInfo,
  CreateRepoRequest,
  CreateTaskRequest,
  CreateSessionRequest,
  CreateJobRequest,
  UpdateJobRequest,
  CreateAgentRequest,
  UpdateAgentRequest,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  CreateJobGroupRequest,
  UpdateJobGroupRequest,
  PathValidationResult,
  MindmapNode,
  FileEntry,
  FileReadResult,
  FileBase64Result,
  RemoteStatus,
  VoiceSpeechResult,
  VoicePingResult,
  VoiceRuntimeStatus,
  VoiceRuntimeEvent,
  ExternalSession,
  CrewAssignment,
  CrewEnvelope,
} from "./types";

// These functions map to Go controller methods bound via Wails.
// After `wails generate`, the real bindings will be at wailsjs/go/...
// For now, we call through window.go which Wails injects at runtime.

function callGo<T>(pkg: string, struct_: string, method: string, ...args: unknown[]): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w?.go?.[pkg]?.[struct_]?.[method]) {
    return w.go[pkg][struct_][method](...args);
  }
  return Promise.reject(new Error(`Binding not available: ${pkg}.${struct_}.${method}`));
}

const PKG = "controller";

// --- Repos ---

const REPO_CTRL = "repoController";

export function browseDirectory(): Promise<string> {
  return callGo(PKG, REPO_CTRL, "BrowseDirectory");
}

export function openRepo(req: CreateRepoRequest): Promise<Repo> {
  return callGo(PKG, REPO_CTRL, "OpenRepo", req);
}

export function listReposByWorkspace(workspaceId: string): Promise<Repo[]> {
  return callGo(PKG, REPO_CTRL, "ListReposByWorkspace", workspaceId);
}

export function listClosedReposByWorkspace(
  workspaceId: string,
  limit: number,
  offset: number
): Promise<Repo[]> {
  return callGo(PKG, REPO_CTRL, "ListClosedReposByWorkspace", workspaceId, limit, offset);
}

export function getRepo(id: string): Promise<Repo> {
  return callGo(PKG, REPO_CTRL, "GetRepo", id);
}

export function removeRepo(id: string): Promise<void> {
  return callGo(PKG, REPO_CTRL, "RemoveRepo", id);
}

export function openInTerminal(path: string): Promise<void> {
  return callGo(PKG, REPO_CTRL, "OpenInTerminal", path);
}

export function openInFinder(path: string): Promise<void> {
  return callGo(PKG, REPO_CTRL, "OpenInFinder", path);
}

// --- Tasks ---

const TASK_CTRL = "taskController";

export function createTask(req: CreateTaskRequest): Promise<Task> {
  return callGo(PKG, TASK_CTRL, "CreateTask", req);
}

export function listTasksByRepo(repoId: string): Promise<Task[]> {
  return callGo(PKG, TASK_CTRL, "ListTasksByRepo", repoId);
}

export function getTask(id: string): Promise<Task> {
  return callGo(PKG, TASK_CTRL, "GetTask", id);
}

export function deleteTask(id: string): Promise<void> {
  return callGo(PKG, TASK_CTRL, "DeleteTask", id);
}

export function archiveTask(id: string): Promise<void> {
  return callGo(PKG, TASK_CTRL, "ArchiveTask", id);
}

export function unarchiveTask(id: string): Promise<void> {
  return callGo(PKG, TASK_CTRL, "UnarchiveTask", id);
}

export function renameTask(id: string, newTag: string, newName: string): Promise<void> {
  return callGo(PKG, TASK_CTRL, "RenameTask", id, newTag, newName);
}

// --- Sessions ---

const SESSION_CTRL = "sessionController";

export function createSession(req: CreateSessionRequest): Promise<Session> {
  return callGo(PKG, SESSION_CTRL, "CreateSession", req);
}

export function startAssistantSession(model: string): Promise<Session> {
  return callGo(PKG, SESSION_CTRL, "StartAssistantSession", model);
}

export function quantiChat(convID: string, message: string, model: string): Promise<string> {
  return callGo(PKG, SESSION_CTRL, "QuantiChat", convID, message, model);
}

export function startSession(id: string, rows: number, cols: number): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "StartSession", id, rows, cols);
}

export function resumeSession(id: string, rows: number, cols: number): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "ResumeSession", id, rows, cols);
}

export function listSessionsByRepo(repoId: string): Promise<Session[]> {
  return callGo(PKG, SESSION_CTRL, "ListSessionsByRepo", repoId);
}

export function listSessionsByTask(taskId: string): Promise<Session[]> {
  return callGo(PKG, SESSION_CTRL, "ListSessionsByTask", taskId);
}

export function getSession(id: string): Promise<Session> {
  return callGo(PKG, SESSION_CTRL, "GetSession", id);
}

export function stopSession(id: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "StopSession", id);
}

export function deleteSession(id: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "DeleteSession", id);
}

export function archiveSession(id: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "ArchiveSession", id);
}

export function unarchiveSession(id: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "UnarchiveSession", id);
}

export function sendMessage(id: string, message: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "SendMessage", id, message);
}

export function resizeTerminal(id: string, rows: number, cols: number): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "ResizeTerminal", id, rows, cols);
}

export function getSessionOutput(id: string): Promise<string> {
  return callGo(PKG, SESSION_CTRL, "GetSessionOutput", id);
}

export function moveSessionToTask(sessionId: string, newTaskId: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "MoveSessionToTask", sessionId, newTaskId);
}

export function renameSession(id: string, newName: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "RenameSession", id, newName);
}

export function listAdoptableSessions(directory: string): Promise<ExternalSession[]> {
  return callGo<ExternalSession[] | null>(PKG, SESSION_CTRL, "ListAdoptableSessions", directory).then(
    (r) => r ?? []
  );
}

// Re-point a stopped quant session at a different claude conversation;
// empty claudeId detaches (fresh conversation on next start).
export function setClaudeSessionId(sessionId: string, claudeId: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "SetClaudeSessionID", sessionId, claudeId);
}

export function checkBranchExists(repoId: string, branchName: string): Promise<boolean> {
  return callGo(PKG, SESSION_CTRL, "CheckBranchExists", repoId, branchName);
}

export function runShortcut(sessionId: string, command: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "RunShortcut", sessionId, command);
}

export function gitCommit(sessionId: string, message: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "GitCommit", sessionId, message);
}

export function gitPull(sessionId: string, branch: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "GitPull", sessionId, branch);
}

export function gitPush(sessionId: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "GitPush", sessionId);
}

export function getUnpushedCommits(sessionId: string): Promise<string[]> {
  return callGo(PKG, SESSION_CTRL, "GetUnpushedCommits", sessionId);
}

export function getCurrentBranch(sessionId: string): Promise<string> {
  return callGo(PKG, SESSION_CTRL, "GetCurrentBranch", sessionId);
}

export function listBranches(sessionId: string): Promise<string[]> {
  return callGo(PKG, SESSION_CTRL, "ListBranches", sessionId);
}

export function gitDiffFiles(sessionId: string): Promise<DiffFile[]> {
  return callGo(PKG, SESSION_CTRL, "GitDiffFiles", sessionId);
}

export function gitDiffFile(sessionId: string, filePath: string): Promise<string> {
  return callGo(PKG, SESSION_CTRL, "GitDiffFile", sessionId, filePath);
}

export function gitGetFileContent(sessionId: string, filePath: string, version: string): Promise<string> {
  return callGo(PKG, SESSION_CTRL, "GitGetFileContent", sessionId, filePath, version);
}

export function gitSaveFileContent(sessionId: string, filePath: string, content: string): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "GitSaveFileContent", sessionId, filePath, content);
}

export function gitCommitFiles(sessionId: string, message: string, files: string[]): Promise<void> {
  return callGo(PKG, SESSION_CTRL, "GitCommitFiles", sessionId, message, files);
}

// --- Actions ---

const ACTION_CTRL = "actionController";

export function getActions(sessionId: string): Promise<Action[]> {
  return callGo(PKG, ACTION_CTRL, "GetActions", sessionId);
}

// --- Config ---

const CONFIG_CTRL = "configController";

export function getConfig(): Promise<Config> {
  return callGo(PKG, CONFIG_CTRL, "GetConfig");
}

export function saveConfig(config: Config): Promise<void> {
  return callGo(PKG, CONFIG_CTRL, "SaveConfig", config);
}

// Lift the voice pane open/close flag to a single global, config-backed value.
// The backend persists it and emits a "voice:pane" event so every session tab
// and remote client stays in sync.
export function setVoicePaneOpen(open: boolean): Promise<void> {
  return callGo(PKG, CONFIG_CTRL, "SetVoicePaneOpen", open);
}

export function resetDatabase(): Promise<void> {
  return callGo(PKG, CONFIG_CTRL, "ResetDatabase");
}

export function clearSessionLogs(): Promise<void> {
  return callGo(PKG, CONFIG_CTRL, "ClearSessionLogs");
}

export function browseConfigDirectory(): Promise<string> {
  return callGo(PKG, CONFIG_CTRL, "BrowseDirectory");
}

export function sendNotification(title: string, message: string): Promise<void> {
  return callGo(PKG, CONFIG_CTRL, "SendNotification", title, message);
}

export function getQuantiFile(name: string): Promise<string> {
  return callGo(PKG, CONFIG_CTRL, "GetQuantiFile", name);
}

export function saveQuantiFile(name: string, content: string): Promise<void> {
  return callGo(PKG, CONFIG_CTRL, "SaveQuantiFile", name, content);
}

// --- Jobs ---

const JOB_CTRL = "jobController";

export function createJob(req: CreateJobRequest): Promise<Job> {
  return callGo(PKG, JOB_CTRL, "CreateJob", req);
}

export function updateJob(req: UpdateJobRequest): Promise<Job> {
  return callGo(PKG, JOB_CTRL, "UpdateJob", req);
}

export function deleteJob(id: string): Promise<void> {
  return callGo(PKG, JOB_CTRL, "DeleteJob", id);
}

export function getJob(id: string): Promise<Job> {
  return callGo(PKG, JOB_CTRL, "GetJob", id);
}

export function listJobs(): Promise<Job[]> {
  return callGo(PKG, JOB_CTRL, "ListJobs");
}

export function runJob(id: string): Promise<JobRun> {
  return callGo(PKG, JOB_CTRL, "RunJob", id);
}

export function rerunJob(jobId: string, originalRunId: string): Promise<JobRun> {
  return callGo(PKG, JOB_CTRL, "RerunJob", jobId, originalRunId);
}

export function resumeJob(runId: string, context: string): Promise<JobRun> {
  return callGo(PKG, JOB_CTRL, "ResumeJob", runId, context);
}

export function advancePipeline(runId: string, targetJobId: string, context: string): Promise<JobRun> {
  return callGo(PKG, JOB_CTRL, "AdvancePipeline", runId, targetJobId, context);
}

export function listRunsByCorrelation(correlationId: string): Promise<JobRun[]> {
  return callGo(PKG, JOB_CTRL, "ListRunsByCorrelation", correlationId);
}

export function cancelRun(runId: string): Promise<void> {
  return callGo(PKG, JOB_CTRL, "CancelRun", runId);
}

export function getRun(runId: string): Promise<JobRun> {
  return callGo(PKG, JOB_CTRL, "GetRun", runId);
}

export function listRunsByJob(jobId: string): Promise<JobRun[]> {
  return callGo(PKG, JOB_CTRL, "ListRunsByJob", jobId);
}

export function listRunsByJobPaginated(jobId: string, limit: number, offset: number): Promise<JobRun[]> {
  return callGo(PKG, JOB_CTRL, "ListRunsByJobPaginated", jobId, limit, offset);
}

export function getRunOutput(runId: string): Promise<string> {
  return callGo(PKG, JOB_CTRL, "GetRunOutput", runId);
}

// --- Agents ---

const AGENT_CTRL = "agentController";

export function createAgent(req: CreateAgentRequest): Promise<Agent> {
  return callGo(PKG, AGENT_CTRL, "CreateAgent", req);
}

export function updateAgent(req: UpdateAgentRequest): Promise<Agent> {
  return callGo(PKG, AGENT_CTRL, "UpdateAgent", req);
}

export function deleteAgent(id: string): Promise<void> {
  return callGo(PKG, AGENT_CTRL, "DeleteAgent", id);
}

export function getAgent(id: string): Promise<Agent> {
  return callGo(PKG, AGENT_CTRL, "GetAgent", id);
}

export function listAgents(): Promise<Agent[]> {
  return callGo(PKG, AGENT_CTRL, "ListAgents");
}

export function listAvailableSkills(workspaceId: string): Promise<SkillInfo[]> {
  return callGo(PKG, AGENT_CTRL, "ListAvailableSkills", workspaceId);
}

export function listAvailableMcpServers(workspaceId: string): Promise<string[]> {
  return callGo(PKG, AGENT_CTRL, "ListAvailableMcpServers", workspaceId);
}

// --- Job Groups ---

const JOB_GROUP_CTRL = "jobGroupController";

export function createJobGroup(req: CreateJobGroupRequest): Promise<JobGroup> {
  return callGo(PKG, JOB_GROUP_CTRL, "CreateJobGroup", req);
}

export function updateJobGroup(req: UpdateJobGroupRequest): Promise<JobGroup> {
  return callGo(PKG, JOB_GROUP_CTRL, "UpdateJobGroup", req);
}

export function deleteJobGroup(id: string): Promise<void> {
  return callGo(PKG, JOB_GROUP_CTRL, "DeleteJobGroup", id);
}

export function listJobGroupsByWorkspace(workspaceId: string): Promise<JobGroup[]> {
  return callGo(PKG, JOB_GROUP_CTRL, "ListJobGroupsByWorkspace", workspaceId);
}

// --- Workspaces ---

const WORKSPACE_CTRL = "workspaceController";

export function createWorkspace(req: CreateWorkspaceRequest): Promise<Workspace> {
  return callGo(PKG, WORKSPACE_CTRL, "CreateWorkspace", req);
}

export function updateWorkspace(req: UpdateWorkspaceRequest): Promise<Workspace> {
  return callGo(PKG, WORKSPACE_CTRL, "UpdateWorkspace", req);
}

export function deleteWorkspace(id: string): Promise<void> {
  return callGo(PKG, WORKSPACE_CTRL, "DeleteWorkspace", id);
}

export function getWorkspace(id: string): Promise<Workspace> {
  return callGo(PKG, WORKSPACE_CTRL, "GetWorkspace", id);
}

export function listWorkspaces(): Promise<Workspace[]> {
  return callGo(PKG, WORKSPACE_CTRL, "ListWorkspaces");
}

export function getCurrentWorkspace(): Promise<Workspace> {
  return callGo(PKG, WORKSPACE_CTRL, "GetCurrentWorkspace");
}

export function setCurrentWorkspace(id: string): Promise<void> {
  return callGo(PKG, WORKSPACE_CTRL, "SetCurrentWorkspace", id);
}

export function browseClaudeConfigDir(): Promise<string> {
  return callGo(PKG, WORKSPACE_CTRL, "BrowseClaudeConfigDir");
}

export function browseMcpConfigFile(): Promise<string> {
  return callGo(PKG, WORKSPACE_CTRL, "BrowseMcpConfigFile");
}

export function validateWorkspacePaths(claudeRoot: string, mcpRoot: string): Promise<PathValidationResult> {
  return callGo(PKG, WORKSPACE_CTRL, "ValidatePaths", claudeRoot, mcpRoot);
}

// --- Mindmap ---

const MINDMAP_CTRL = "mindmapController";

export function getMindmap(sessionId: string, board: string): Promise<MindmapNode[]> {
  return callGo(PKG, MINDMAP_CTRL, "GetMindmap", sessionId, board);
}

export function setMindmapNode(
  sessionId: string,
  board: string,
  node: MindmapNode
): Promise<MindmapNode> {
  return callGo(PKG, MINDMAP_CTRL, "SetMindmapNode", sessionId, board, node);
}

export function removeMindmapNode(
  sessionId: string,
  board: string,
  id: string,
  subtree: boolean
): Promise<void> {
  return callGo(PKG, MINDMAP_CTRL, "RemoveMindmapNode", sessionId, board, id, subtree);
}

export function clearMindmapBoard(sessionId: string, board: string): Promise<void> {
  return callGo(PKG, MINDMAP_CTRL, "ClearMindmapBoard", sessionId, board);
}

export function listBoards(sessionId: string): Promise<string[]> {
  return callGo(PKG, MINDMAP_CTRL, "ListBoards", sessionId);
}

export function moveMindmapBoard(
  sessionId: string,
  board: string,
  toSessionId: string
): Promise<string> {
  return callGo(PKG, MINDMAP_CTRL, "MoveBoard", sessionId, board, toSessionId);
}

export function renameBoard(
  sessionId: string,
  oldName: string,
  newName: string
): Promise<string> {
  return callGo(PKG, MINDMAP_CTRL, "RenameBoard", sessionId, oldName, newName);
}

// --- Crew ---

const CREW_CTRL = "crewController";

// Worker assignments under a supervisor session.
export function getCrew(sessionId: string): Promise<CrewAssignment[]> {
  return callGo<CrewAssignment[] | null>(PKG, CREW_CTRL, "GetCrew", sessionId).then((r) => r ?? []);
}

// A worker's assignment, or null when unassigned.
export function getCrewSupervisor(sessionId: string): Promise<CrewAssignment | null> {
  return callGo<CrewAssignment | null>(PKG, CREW_CTRL, "GetSupervisor", sessionId).then(
    (r) => r ?? null
  );
}

export function getAllCrewAssignments(): Promise<CrewAssignment[]> {
  return callGo<CrewAssignment[] | null>(PKG, CREW_CTRL, "GetAllAssignments").then((r) => r ?? []);
}

// Envelopes addressed to a session (queued, plus delivered history when asked).
export function getCrewInbox(sessionId: string, includeDelivered: boolean): Promise<CrewEnvelope[]> {
  return callGo<CrewEnvelope[] | null>(PKG, CREW_CTRL, "GetInbox", sessionId, includeDelivered).then(
    (r) => r ?? []
  );
}

// Queued (undelivered) envelope count per supervisor session id — the single
// source of the sidebar/pane unread badges.
export function getCrewQueuedCounts(): Promise<Record<string, number>> {
  return callGo<Record<string, number> | null>(PKG, CREW_CTRL, "GetQueuedCounts").then(
    (r) => r ?? {}
  );
}

// Upsert: assigning an already-assigned worker moves it between crews.
export function assignCrewWorker(workerSessionId: string, supervisorSessionId: string): Promise<void> {
  return callGo(PKG, CREW_CTRL, "AssignWorker", workerSessionId, supervisorSessionId);
}

export function unassignCrewWorker(workerSessionId: string): Promise<void> {
  return callGo(PKG, CREW_CTRL, "UnassignWorker", workerSessionId);
}

// Deliver one queued envelope to the supervisor immediately (bypasses the
// idle gates; still requires a live process).
export function crewDrainNow(sessionId: string): Promise<void> {
  return callGo(PKG, CREW_CTRL, "DrainNow", sessionId);
}

// Turn a supervisor's "always deliver" lock on/off — the continuous form of
// crewDrainNow: while locked the drainer delivers on every tick, bypassing the
// idle gates (still one per tick, still requires a live process).
export function setCrewDeliveryLock(supervisorId: string, locked: boolean): Promise<void> {
  return callGo(PKG, CREW_CTRL, "SetDeliveryLock", supervisorId, locked);
}

// Supervisors whose "always deliver" lock is on, keyed by supervisor session id.
export function getCrewDeliveryLocks(): Promise<Record<string, boolean>> {
  return callGo<Record<string, boolean> | null>(PKG, CREW_CTRL, "GetDeliveryLocks").then(
    (r) => r ?? {}
  );
}

// --- Files (sandboxed to the session workdir) ---
//
// All paths are forward-slash relative to the session root ("" = root). The
// backend emits "files:changed" {sessionId, path: parentDirRel, op} after
// every successful mutation.

const FILE_CTRL = "fileController";

export function listDir(sessionId: string, relPath: string): Promise<FileEntry[]> {
  return callGo(PKG, FILE_CTRL, "ListDir", sessionId, relPath);
}

export function readFile(sessionId: string, relPath: string): Promise<FileReadResult> {
  return callGo(PKG, FILE_CTRL, "ReadFile", sessionId, relPath);
}

export function readFileBase64(sessionId: string, relPath: string): Promise<FileBase64Result> {
  return callGo(PKG, FILE_CTRL, "ReadFileBase64", sessionId, relPath);
}

export function writeFile(sessionId: string, relPath: string, content: string): Promise<void> {
  return callGo(PKG, FILE_CTRL, "WriteFile", sessionId, relPath, content);
}

export function createFile(sessionId: string, relPath: string): Promise<void> {
  return callGo(PKG, FILE_CTRL, "CreateFile", sessionId, relPath);
}

export function createDir(sessionId: string, relPath: string): Promise<void> {
  return callGo(PKG, FILE_CTRL, "CreateDir", sessionId, relPath);
}

export function renamePath(sessionId: string, oldRel: string, newRel: string): Promise<void> {
  return callGo(PKG, FILE_CTRL, "RenamePath", sessionId, oldRel, newRel);
}

export function deletePath(sessionId: string, relPath: string, recursive: boolean): Promise<void> {
  return callGo(PKG, FILE_CTRL, "DeletePath", sessionId, relPath, recursive);
}

// --- Changelog ---

const CHANGELOG_CTRL = "changelogController";

export function getChangelog(): Promise<Changelog> {
  return callGo(PKG, CHANGELOG_CTRL, "GetChangelog");
}

export function getVersion(): Promise<string> {
  return callGo(PKG, CHANGELOG_CTRL, "GetVersion");
}

// --- Updates ---

const UPDATE_CTRL = "updateController";

export function checkForUpdate(): Promise<UpdateInfo> {
  return callGo(PKG, UPDATE_CTRL, "CheckForUpdate");
}

export function performUpdate(): Promise<void> {
  return callGo(PKG, UPDATE_CTRL, "PerformUpdate");
}

export function restartApp(): Promise<void> {
  return callGo(PKG, UPDATE_CTRL, "Restart");
}

// --- Remote Access ---

const REMOTE_CTRL = "remoteController";

export function getRemoteAccessStatus(): Promise<RemoteStatus> {
  return callGo(PKG, REMOTE_CTRL, "GetRemoteAccessStatus");
}

export function enableRemoteAccess(): Promise<RemoteStatus> {
  return callGo(PKG, REMOTE_CTRL, "EnableRemoteAccess");
}

export function disableRemoteAccess(): Promise<RemoteStatus> {
  return callGo(PKG, REMOTE_CTRL, "DisableRemoteAccess");
}

export function regenerateRemotePasscode(): Promise<RemoteStatus> {
  return callGo(PKG, REMOTE_CTRL, "RegenerateRemotePasscode");
}

// --- Voice (STT/TTS proxy) ---
//
// The Go proxy holds the provider API key, so audio never carries credentials
// from the frontend. Audio crosses the bridge base64-encoded (the Wails bridge
// marshals []byte awkwardly over the remote transport).

// The voice controller lives in Go package `voice` (internal/integration/voice),
// NOT the shared `controller` package — so its Wails binding is namespaced under
// window.go.voice.voiceController. Using PKG ("controller") here makes every
// voice call resolve to undefined ("Binding not available").
const VOICE_PKG = "voice";
const VOICE_CTRL = "voiceController";

/**
 * Transcribe base64-encoded audio via the Go STT proxy.
 * @param audioB64 base64-encoded audio bytes (no data: prefix)
 * @param mime audio MIME type, e.g. "audio/webm" or "audio/wav"
 * @returns the transcript text (trimmed)
 */
export function transcribe(audioB64: string, mime: string): Promise<string> {
  return callGo(VOICE_PKG, VOICE_CTRL, "Transcribe", audioB64, mime);
}

/**
 * Synthesize speech for the given text via the Go TTS proxy.
 * Pass an empty `voice` and/or `speed === 0` to use the configured defaults.
 * @returns { audioB64, contentType } — base64-encoded audio + its content type
 */
export function synthesize(
  text: string,
  voice: string,
  speed: number,
): Promise<VoiceSpeechResult> {
  return callGo(VOICE_PKG, VOICE_CTRL, "Synthesize", text, voice, speed);
}

/**
 * Report the result of a voice request back to the Go voice bridge, unblocking
 * the MCP voice tool (voice_listen / voice_speak / voice_converse) that is
 * waiting on it. Called by the frontend voice bridge (voiceBridge.ts) after it
 * has run audioService.listen() or .speak() for an incoming "voice:request".
 *
 * @param requestId correlation id from the "voice:request" event
 * @param transcript the recognized text for a "listen" request ("" for speak)
 * @param errMsg non-empty on failure; "" on success
 */
export function voiceResult(
  requestId: string,
  transcript: string,
  errMsg: string,
): Promise<void> {
  return callGo(VOICE_PKG, VOICE_CTRL, "VoiceResult", requestId, transcript, errMsg);
}

/**
 * Report that an in-flight voice request was abandoned because its voice pane
 * was torn down (voice closed or moved to another session) while the request
 * was still pending. The Go side maps this to a graceful "voice ended" result
 * (NOT an error), so the waiting MCP voice tool returns immediately instead of
 * blocking until its ~120s timeout. Called by the frontend voice bridge
 * (voiceBridge.ts) on unregister when a request is still unsettled.
 *
 * @param requestId correlation id from the "voice:request" event
 */
export function voiceResultClosed(requestId: string): Promise<void> {
  return callGo(VOICE_PKG, VOICE_CTRL, "VoiceResultClosed", requestId);
}

/**
 * Keepalive for a long-form listen: while the user holds the voice pane in
 * recording mode, the frontend bridge pings this (~every 30s) with the
 * in-flight requestId so the Go bridge resets that request's ListenTimeout
 * timer and the recording isn't cut off mid-speech. Unknown/settled requestIds
 * are ignored Go-side, and non-recording listens never call this.
 *
 * @param requestId correlation id from the "voice:request" event
 */
export function voiceListenExtend(requestId: string): Promise<void> {
  return callGo(VOICE_PKG, VOICE_CTRL, "VoiceListenExtend", requestId);
}

/**
 * Kick a running session into voice mode. Injects the voice-mode persona/kickoff
 * message into the session (auto-submitted Go-side), after which the agent drives
 * the spoken conversation loop via the voice_* MCP tools. Called once when the
 * voice pane is opened for a session (see App.tsx handleVoicePaneOpenChange).
 *
 * Rejects if the session has no running agent/process (surface in the pane's
 * error indicator, or ignore — re-opening the pane re-kicks).
 */
export function startVoiceSession(sessionId: string): Promise<void> {
  return callGo(VOICE_PKG, VOICE_CTRL, "StartVoiceSession", sessionId);
}

/**
 * Discover the speaker voices the installed voice runtime offers (the Kokoro
 * model's speaker names, e.g. af_bella / am_onyx). Used by Settings → Voice to
 * populate the voice picker. Soft-fails: resolves to [] when the runtime is not
 * installed / unreachable, so the UI can fall back to curated options.
 */
export function listVoices(): Promise<string[]> {
  return callGo<string[] | null>(VOICE_PKG, VOICE_CTRL, "ListVoices").then(
    (r) => r ?? [],
    () => [],
  );
}

/**
 * Probe whether the local voice runtime is ready. The `op` argument is kept for
 * bridge-signature compatibility but is ignored backend-side — one call drives
 * the single "Voice ready / Not installed" chip in Settings → Voice. Soft-fails:
 * resolves to { ok: false, detail: "probe failed" } on throw/null so the UI
 * never crashes.
 */
export function pingVoiceEndpoint(op: "stt" | "tts"): Promise<VoicePingResult> {
  return callGo<VoicePingResult | null>(VOICE_PKG, VOICE_CTRL, "Ping", op).then(
    (r) => r ?? { ok: false, detail: "probe failed" },
    () => ({ ok: false, detail: "probe failed" }),
  );
}

// --- Voice runtime (one-click managed local voice models) ---
//
// Unlike the voice proxy above (Go package `voice`), the runtime installer lives
// in the shared `controller` package, so it binds under
// window.go.controller.voiceRuntimeController (PKG, not VOICE_PKG).
const VOICE_RUNTIME_CTRL = "voiceRuntimeController";

/** Current install + model snapshot for Settings → Voice. */
export function voiceRuntimeStatus(): Promise<VoiceRuntimeStatus> {
  return callGo(PKG, VOICE_RUNTIME_CTRL, "VoiceRuntimeStatus");
}

/**
 * Download + install the local voice models. Returns immediately with
 * installing=true; progress streams on the "voice:runtime" event (subscribe via
 * onVoiceRuntimeEvent).
 */
export function installVoiceRuntime(): Promise<VoiceRuntimeStatus> {
  return callGo(PKG, VOICE_RUNTIME_CTRL, "InstallVoiceRuntime");
}

/** Remove the installed voice models. */
export function uninstallVoiceRuntime(): Promise<VoiceRuntimeStatus> {
  return callGo(PKG, VOICE_RUNTIME_CTRL, "UninstallVoiceRuntime");
}

/**
 * Subscribe to voice-runtime install/lifecycle events ("voice:runtime"). Returns
 * an unsubscribe function; a no-op when the Wails runtime is absent (SSR/tests).
 */
export function onVoiceRuntimeEvent(
  handler: (ev: VoiceRuntimeEvent) => void,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (!w?.runtime?.EventsOn) return () => {};
  return w.runtime.EventsOn("voice:runtime", handler) as () => void;
}
