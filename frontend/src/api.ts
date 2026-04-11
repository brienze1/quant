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

// --- Changelog ---

const CHANGELOG_CTRL = "changelogController";

export function getChangelog(): Promise<Changelog> {
  return callGo(PKG, CHANGELOG_CTRL, "GetChangelog");
}

export function getVersion(): Promise<string> {
  return callGo(PKG, CHANGELOG_CTRL, "GetVersion");
}
