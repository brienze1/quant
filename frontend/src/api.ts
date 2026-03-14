import type {
  Repo,
  Task,
  Session,
  Action,
  CreateRepoRequest,
  CreateTaskRequest,
  CreateSessionRequest,
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

export function listRepos(): Promise<Repo[]> {
  return callGo(PKG, REPO_CTRL, "ListRepos");
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

// --- Sessions ---

const SESSION_CTRL = "sessionController";

export function createSession(req: CreateSessionRequest): Promise<Session> {
  return callGo(PKG, SESSION_CTRL, "CreateSession", req);
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

// --- Actions ---

const ACTION_CTRL = "actionController";

export function getActions(sessionId: string): Promise<Action[]> {
  return callGo(PKG, ACTION_CTRL, "GetActions", sessionId);
}
