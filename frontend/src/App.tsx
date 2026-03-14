import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Repo,
  Task,
  Session,
  Action,
  CreateRepoRequest,
  CreateTaskRequest,
  CreateSessionRequest,
} from "./types";
import * as api from "./api";
import { Sidebar } from "./components/Sidebar";
import { SessionPanel } from "./components/SessionPanel";
import { EmptyState } from "./components/EmptyState";
import { OpenRepoModal } from "./components/OpenRepoModal";
import { NewTaskModal } from "./components/NewTaskModal";
import { NewSessionModal } from "./components/NewSessionModal";

type ModalState =
  | { type: "none" }
  | { type: "openRepo" }
  | { type: "newTask"; repoId: string }
  | { type: "newSession"; repoId: string; taskId?: string };

function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tasksByRepo, setTasksByRepo] = useState<Record<string, Task[]>>({});
  const [sessionsByRepo, setSessionsByRepo] = useState<Record<string, Session[]>>({});
  const [sessionsByTask, setSessionsByTask] = useState<Record<string, Session[]>>({});
  const [actionsBySession, setActionsBySession] = useState<Record<string, Action[]>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [transitionStatus, setTransitionStatus] = useState<Record<string, "starting" | "stopping" | "resuming">>({});
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [error, setError] = useState<string | null>(null);

  // keep refs for polling callbacks
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const expandedSessionIdRef = useRef(expandedSessionId);
  expandedSessionIdRef.current = expandedSessionId;
  const reposRef = useRef(repos);
  reposRef.current = repos;
  const tasksByRepoRef = useRef(tasksByRepo);
  tasksByRepoRef.current = tasksByRepo;

  // find active session object
  const activeSession = findSession(activeSessionId, sessionsByRepo, sessionsByTask);

  // find task for active session
  const activeTask = activeSession?.taskId
    ? findTask(activeSession.taskId, tasksByRepo)
    : null;

  // --- data fetching ---

  const fetchRepos = useCallback(async () => {
    try {
      const list = await api.listRepos();
      setRepos(list ?? []);
      return list ?? [];
    } catch (err) {
      console.error("failed to list repos:", err);
      return [];
    }
  }, []);

  const fetchTasksForRepo = useCallback(async (repoId: string) => {
    try {
      const list = await api.listTasksByRepo(repoId);
      setTasksByRepo((prev) => ({ ...prev, [repoId]: list ?? [] }));
      return list ?? [];
    } catch (err) {
      console.error("failed to list tasks:", err);
      return [];
    }
  }, []);

  const fetchSessionsForRepo = useCallback(async (repoId: string) => {
    try {
      const list = await api.listSessionsByRepo(repoId);
      setSessionsByRepo((prev) => ({ ...prev, [repoId]: list ?? [] }));
      return list ?? [];
    } catch (err) {
      console.error("failed to list sessions for repo:", err);
      return [];
    }
  }, []);

  const fetchSessionsForTask = useCallback(async (taskId: string) => {
    try {
      const list = await api.listSessionsByTask(taskId);
      setSessionsByTask((prev) => ({ ...prev, [taskId]: list ?? [] }));
      return list ?? [];
    } catch (err) {
      console.error("failed to list sessions for task:", err);
      return [];
    }
  }, []);

  const fetchActions = useCallback(async (sessionId: string) => {
    try {
      const list = await api.getActions(sessionId);
      setActionsBySession((prev) => ({ ...prev, [sessionId]: list ?? [] }));
    } catch (err) {
      console.error("failed to get actions:", err);
    }
  }, []);

  // initial load
  const loadAll = useCallback(async () => {
    const repoList = await fetchRepos();
    for (const repo of repoList) {
      const tasks = await fetchTasksForRepo(repo.id);
      await fetchSessionsForRepo(repo.id);
      for (const task of tasks) {
        await fetchSessionsForTask(task.id);
      }
    }
  }, [fetchRepos, fetchTasksForRepo, fetchSessionsForRepo, fetchSessionsForTask]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // poll sessions every 3s
  useEffect(() => {
    const interval = setInterval(async () => {
      const currentRepos = reposRef.current;
      const currentTasks = tasksByRepoRef.current;
      for (const repo of currentRepos) {
        await fetchSessionsForRepo(repo.id);
        const tasks = currentTasks[repo.id] ?? [];
        for (const task of tasks) {
          await fetchSessionsForTask(task.id);
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchSessionsForRepo, fetchSessionsForTask]);

  // poll actions for active/expanded session every 2s
  useEffect(() => {
    const interval = setInterval(() => {
      const ids = new Set<string>();
      if (activeSessionIdRef.current) ids.add(activeSessionIdRef.current);
      if (expandedSessionIdRef.current) ids.add(expandedSessionIdRef.current);
      ids.forEach((id) => fetchActions(id));
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchActions]);

  // fetch actions when active/expanded changes
  useEffect(() => {
    if (activeSessionId) fetchActions(activeSessionId);
  }, [activeSessionId, fetchActions]);

  useEffect(() => {
    if (expandedSessionId) fetchActions(expandedSessionId);
  }, [expandedSessionId, fetchActions]);

  // --- handlers ---

  async function handleOpenRepo(req: CreateRepoRequest) {
    try {
      setError(null);
      await api.openRepo(req);
      setModal({ type: "none" });
      await loadAll();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleCreateTask(req: CreateTaskRequest) {
    try {
      setError(null);
      await api.createTask(req);
      setModal({ type: "none" });
      await fetchTasksForRepo(req.repoId);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleCreateSession(req: CreateSessionRequest) {
    try {
      setError(null);
      const session = await api.createSession(req);
      setModal({ type: "none" });
      await fetchSessionsForRepo(req.repoId);
      if (req.taskId) await fetchSessionsForTask(req.taskId);
      setActiveSessionId(session.id);
      // Session is created idle; terminal auto-starts it via onStart
    } catch (err) {
      setError(String(err));
    }
  }

  function clearTransition(id: string) {
    setTimeout(() => {
      setTransitionStatus((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }, 2000);
  }

  async function handleStart(id: string, rows: number, cols: number) {
    try {
      setError(null);
      setTransitionStatus((prev) => ({ ...prev, [id]: "starting" }));
      await api.startSession(id, rows, cols);
      clearTransition(id);
    } catch (err) {
      setError(String(err));
      setTransitionStatus((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
  }

  async function handleResume(id: string, rows: number, cols: number) {
    try {
      setError(null);
      setTransitionStatus((prev) => ({ ...prev, [id]: "resuming" }));
      await api.resumeSession(id, rows, cols);
      clearTransition(id);
    } catch (err) {
      setError(String(err));
      setTransitionStatus((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
  }

  async function handleStop(id: string) {
    try {
      setError(null);
      setTransitionStatus((prev) => ({ ...prev, [id]: "stopping" }));
      await api.stopSession(id);
      clearTransition(id);
    } catch (err) {
      setError(String(err));
      setTransitionStatus((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
  }

  async function handleDelete(id: string) {
    try {
      setError(null);
      await api.deleteSession(id);
      if (activeSessionId === id) setActiveSessionId(null);
      if (expandedSessionId === id) setExpandedSessionId(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRemoveRepo(repoId: string) {
    try {
      setError(null);
      await api.removeRepo(repoId);
      await loadAll();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDeleteTask(taskId: string) {
    try {
      setError(null);
      await api.deleteTask(taskId);
      await loadAll();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="flex h-screen w-screen" style={{ backgroundColor: "#0A0A0A" }}>
      <Sidebar
        repos={repos}
        tasksByRepo={tasksByRepo}
        sessionsByRepo={sessionsByRepo}
        sessionsByTask={sessionsByTask}
        transitionStatus={transitionStatus}
        actionsBySession={actionsBySession}
        activeSessionId={activeSessionId}
        expandedSessionId={expandedSessionId}
        onSelectSession={setActiveSessionId}
        onExpandSession={setExpandedSessionId}
        onOpenRepo={() => setModal({ type: "openRepo" })}
        onCreateTask={(repoId) => setModal({ type: "newTask", repoId })}
        onCreateSession={(repoId, taskId) =>
          setModal({ type: "newSession", repoId, taskId })
        }
        onRemoveRepo={handleRemoveRepo}
        onDeleteTask={handleDeleteTask}
        onDeleteSession={handleDelete}
      />

      <main className="flex-1 flex flex-col relative" style={{ backgroundColor: "#0A0A0A" }}>
        {error && (
          <div
            className="absolute top-0 left-0 right-0 z-40 text-xs px-4 py-2 flex justify-between"
            style={{
              backgroundColor: "rgba(239,68,68,0.15)",
              color: "#EF4444",
              borderBottom: "1px solid #2a2a2a",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <span>// error: {error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-2 transition-colors"
              style={{ color: "#EF4444" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#EF4444")}
            >
              [x]
            </button>
          </div>
        )}

        {activeSession ? (
          <SessionPanel
            session={activeSession}
            task={activeTask}
            onStop={handleStop}
            onDelete={handleDelete}
            onClose={() => setActiveSessionId(null)}
            onStart={handleStart}
            onResume={handleResume}
            displayStatus={transitionStatus[activeSession.id] ?? activeSession.status}
          />
        ) : (
          <EmptyState />
        )}
      </main>

      {modal.type === "openRepo" && (
        <OpenRepoModal
          onSubmit={handleOpenRepo}
          onCancel={() => setModal({ type: "none" })}
        />
      )}

      {modal.type === "newTask" && (
        <NewTaskModal
          repoId={modal.repoId}
          repoName={repos.find((r) => r.id === modal.repoId)?.name}
          onSubmit={handleCreateTask}
          onCancel={() => setModal({ type: "none" })}
        />
      )}

      {modal.type === "newSession" && (
        <NewSessionModal
          repos={repos}
          tasksByRepo={tasksByRepo}
          defaultRepoId={modal.repoId}
          defaultTaskId={modal.taskId}
          onSubmit={handleCreateSession}
          onCancel={() => setModal({ type: "none" })}
        />
      )}
    </div>
  );
}

// --- helpers ---

function findSession(
  id: string | null,
  sessionsByRepo: Record<string, Session[]>,
  sessionsByTask: Record<string, Session[]>,
): Session | null {
  if (!id) return null;
  for (const sessions of Object.values(sessionsByRepo)) {
    const found = sessions.find((s) => s.id === id);
    if (found) return found;
  }
  for (const sessions of Object.values(sessionsByTask)) {
    const found = sessions.find((s) => s.id === id);
    if (found) return found;
  }
  return null;
}

function findTask(
  taskId: string,
  tasksByRepo: Record<string, Task[]>,
): Task | null {
  for (const tasks of Object.values(tasksByRepo)) {
    const found = tasks.find((t) => t.id === taskId);
    if (found) return found;
  }
  return null;
}

export default App;
