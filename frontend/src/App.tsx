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
import { TabBar } from "./components/TabBar";
import { MoveSessionModal } from "./components/MoveSessionModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { RenameModal } from "./components/RenameModal";
import { RenameTaskModal } from "./components/RenameTaskModal";
import { Settings } from "./components/Settings";

type ModalState =
  | { type: "none" }
  | { type: "openRepo" }
  | { type: "newTask"; repoId: string }
  | { type: "newSession"; repoId: string; taskId?: string }
  | { type: "moveSession"; sessionId: string; repoId: string }
  | { type: "confirm"; message: string; onConfirm: () => void }
  | { type: "renameSession"; sessionId: string; currentName: string }
  | { type: "renameTask"; taskId: string; currentTag: string; currentName: string };

type View = "dashboard" | "settings";

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tasksByRepo, setTasksByRepo] = useState<Record<string, Task[]>>({});
  const [sessionsByRepo, setSessionsByRepo] = useState<Record<string, Session[]>>({});
  const [sessionsByTask, setSessionsByTask] = useState<Record<string, Session[]>>({});
  const [actionsBySession, setActionsBySession] = useState<Record<string, Action[]>>({});

  // Tab model: multiple open tabs, one active
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // selectedSessionId tracks sidebar highlight (may differ from active tab)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [transitionStatus, setTransitionStatus] = useState<Record<string, "starting" | "stopping" | "resuming">>({});
  const [activeOutputIds, setActiveOutputIds] = useState<Set<string>>(new Set());
  const outputTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const toastIdRef = useRef(0);

  // keep refs for polling callbacks
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const openTabIdsRef = useRef(openTabIds);
  openTabIdsRef.current = openTabIds;
  const expandedSessionIdRef = useRef(expandedSessionId);
  expandedSessionIdRef.current = expandedSessionId;
  const reposRef = useRef(repos);
  reposRef.current = repos;
  const tasksByRepoRef = useRef(tasksByRepo);
  tasksByRepoRef.current = tasksByRepo;

  // find active session object (the one shown in the main panel)
  const activeSession = findSession(activeTabId, sessionsByRepo, sessionsByTask);

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

  // poll actions for all open tabs + expanded session every 2s
  useEffect(() => {
    const interval = setInterval(() => {
      const ids = new Set<string>();
      for (const tabId of openTabIdsRef.current) {
        ids.add(tabId);
      }
      if (expandedSessionIdRef.current) ids.add(expandedSessionIdRef.current);
      ids.forEach((id) => fetchActions(id));
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchActions]);

  // fetch actions when active tab or expanded session changes
  useEffect(() => {
    if (activeTabId) fetchActions(activeTabId);
  }, [activeTabId, fetchActions]);

  useEffect(() => {
    if (expandedSessionId) fetchActions(expandedSessionId);
  }, [expandedSessionId, fetchActions]);

  // Track PTY output activity to distinguish "running" vs "waiting"
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (!w?.runtime?.EventsOn) return;

    const cancel = w.runtime.EventsOn("session:output", (data: { sessionId: string; data: string }) => {
      const id = data.sessionId;
      if (!data.data) return;

      // Large chunks (>= 100 bytes) activate "running" status.
      // User typing echoes are small; Claude response chunks are large.
      const isLargeChunk = data.data.length >= 100;

      if (isLargeChunk) {
        setActiveOutputIds((prev) => {
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }

      // Once a session is active, ANY output (including small chunks like
      // "Sketching...", status bar updates, ANSI escape sequences) keeps the
      // quiet timer alive. This prevents false "waiting" status while Claude
      // is still working but outputting small chunks.
      // Only large chunks can start the timer (activate status), but once
      // active, all output resets it.
      setActiveOutputIds((prev) => {
        if (!prev.has(id)) return prev; // not active, ignore small chunks
        // Session is active — reset the quiet timer on any output
        if (outputTimers.current[id]) clearTimeout(outputTimers.current[id]);
        outputTimers.current[id] = setTimeout(() => {
          setActiveOutputIds((p) => {
            if (!p.has(id)) return p;
            const next = new Set(p);
            next.delete(id);
            return next;
          });
        }, 5000);
        return prev;
      });

      // For large chunks, also set the timer (handles initial activation)
      if (isLargeChunk) {
        if (outputTimers.current[id]) clearTimeout(outputTimers.current[id]);
        outputTimers.current[id] = setTimeout(() => {
          setActiveOutputIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, 5000);
      }
    });

    return () => { if (cancel) cancel(); };
  }, []);

  // Send notification when a session finishes responding and user is not viewing it.
  // Only notify once per active→quiet transition by tracking which sessions we already notified.
  const prevActiveOutputIdsRef = useRef<Set<string>>(new Set());
  const notifiedSessionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const prev = prevActiveOutputIdsRef.current;

    // Mark newly active sessions as eligible for notification again
    for (const id of activeOutputIds) {
      if (!prev.has(id)) {
        notifiedSessionsRef.current.delete(id);
      }
    }

    // Notify for sessions that just went from active to quiet
    for (const id of prev) {
      if (!activeOutputIds.has(id) && activeTabIdRef.current !== id && !notifiedSessionsRef.current.has(id)) {
        notifiedSessionsRef.current.add(id);
        (async () => {
          try {
            const cfg = await api.getConfig();
            if (!cfg.notifications) return;

            const session = findSession(id, sessionsByRepo, sessionsByTask);
            const name = session?.name ?? id;

            // In-app toast notification
            const toastId = ++toastIdRef.current;
            setToasts((prev) => [...prev, { id: toastId, message: `session "${name}" has finished` }]);
            setTimeout(() => {
              setToasts((prev) => prev.filter((t) => t.id !== toastId));
            }, 5000);

            // Also try native macOS notification via backend
            api.sendNotification("quant", `session "${name}" has finished`).catch(() => {});
          } catch {
            // notification is best-effort
          }
        })();
      }
    }
    prevActiveOutputIdsRef.current = new Set(activeOutputIds);
  }, [activeOutputIds, sessionsByRepo, sessionsByTask]);

  // Compute display status for a session
  function getDisplayStatus(sessionId: string, baseStatus: Session["status"]): import("./components/StatusBadge").DisplayStatus {
    // Check if session is archived
    const session = findSession(sessionId, sessionsByRepo, sessionsByTask);
    if (session?.archivedAt) return "archived";
    if (transitionStatus[sessionId]) return transitionStatus[sessionId];
    if (baseStatus === "running" && activeOutputIds.has(sessionId)) return "running";
    if (baseStatus === "running" && !activeOutputIds.has(sessionId)) return "waiting";
    return baseStatus;
  }

  // --- tab handlers ---

  function handleOpenTab(id: string) {
    setOpenTabIds((prev) => {
      if (prev.includes(id)) return prev;
      return [...prev, id];
    });
    setActiveTabId(id);
    setSelectedSessionId(id);
  }

  function handleCloseTab(id: string) {
    setOpenTabIds((prev) => {
      const next = prev.filter((t) => t !== id);
      return next;
    });
    setActiveTabId((prev) => {
      if (prev !== id) return prev;
      // Switch to adjacent tab
      const idx = openTabIds.indexOf(id);
      if (openTabIds.length <= 1) return null;
      if (idx === openTabIds.length - 1) return openTabIds[idx - 1];
      return openTabIds[idx + 1];
    });
  }

  function handleSelectTab(id: string) {
    setActiveTabId(id);
    setSelectedSessionId(id);
  }

  function handleCloseAllTabs() {
    setOpenTabIds([]);
    setActiveTabId(null);
  }

  function handleCloseTabsToLeft(id: string) {
    const idx = openTabIds.indexOf(id);
    if (idx <= 0) return;
    const removed = openTabIds.slice(0, idx);
    setOpenTabIds(openTabIds.slice(idx));
    if (activeTabId && removed.includes(activeTabId)) {
      setActiveTabId(id);
    }
  }

  function handleCloseTabsToRight(id: string) {
    const idx = openTabIds.indexOf(id);
    if (idx === -1 || idx === openTabIds.length - 1) return;
    const removed = openTabIds.slice(idx + 1);
    setOpenTabIds(openTabIds.slice(0, idx + 1));
    if (activeTabId && removed.includes(activeTabId)) {
      setActiveTabId(id);
    }
  }

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

  const creatingSessionRef = useRef(false);
  async function handleCreateSession(req: CreateSessionRequest) {
    if (creatingSessionRef.current) return;
    creatingSessionRef.current = true;
    try {
      setError(null);
      const session = await api.createSession(req);
      setModal({ type: "none" });
      await fetchSessionsForRepo(req.repoId);
      if (req.taskId) await fetchSessionsForTask(req.taskId);
      // Open the new session in a tab
      handleOpenTab(session.id);
      // Session is created idle; terminal auto-starts it via onStart
    } catch (err) {
      setError(String(err));
    } finally {
      creatingSessionRef.current = false;
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
      // Remove from tabs if present
      setOpenTabIds((prev) => prev.filter((t) => t !== id));
      setActiveTabId((prev) => {
        if (prev !== id) return prev;
        const remaining = openTabIds.filter((t) => t !== id);
        return remaining.length > 0 ? remaining[remaining.length - 1] : null;
      });
      if (selectedSessionId === id) setSelectedSessionId(null);
      if (expandedSessionId === id) setExpandedSessionId(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleArchiveSession(id: string) {
    try {
      setError(null);
      await api.archiveSession(id);
      // Remove from tabs if present
      setOpenTabIds((prev) => prev.filter((t) => t !== id));
      setActiveTabId((prev) => {
        if (prev !== id) return prev;
        const remaining = openTabIds.filter((t) => t !== id);
        return remaining.length > 0 ? remaining[remaining.length - 1] : null;
      });
      if (selectedSessionId === id) setSelectedSessionId(null);
      if (expandedSessionId === id) setExpandedSessionId(null);
      await loadAll();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUnarchiveSession(id: string) {
    try {
      setError(null);
      await api.unarchiveSession(id);
      await loadAll();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleQuickCreateSession(fromSession: Session) {
    const oppositeType = fromSession.sessionType === "claude" ? "terminal" : "claude";
    const name = `${oppositeType}-${fromSession.name}`;
    const directory = fromSession.worktreePath || fromSession.directory;
    const req: CreateSessionRequest = {
      name,
      description: "",
      repoId: fromSession.repoId,
      taskId: fromSession.taskId || undefined,
      sessionType: oppositeType,
      useWorktree: false,
      skipPermissions: false,
      autoPull: false,
      pullBranch: "",
      branchNamePattern: "",
      model: "",
      extraCliArgs: "",
      directoryOverride: directory,
    };
    try {
      setError(null);
      const session = await api.createSession(req);
      await fetchSessionsForRepo(fromSession.repoId);
      if (fromSession.taskId) await fetchSessionsForTask(fromSession.taskId);
      handleOpenTab(session.id);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleArchiveTask(taskId: string) {
    const sessions = sessionsByTask[taskId] ?? [];
    // Remove open tabs for sessions in this task
    for (const s of sessions) {
      setOpenTabIds((prev) => prev.filter((id) => id !== s.id));
    }
    try {
      setError(null);
      await api.archiveTask(taskId);
      await loadAll();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUnarchiveTask(taskId: string) {
    try {
      setError(null);
      await api.unarchiveTask(taskId);
      await loadAll();
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

  async function executeDeleteTask(taskId: string) {
    // Remove open tabs for sessions in this task.
    const sessions = sessionsByTask[taskId] ?? [];
    for (const s of sessions) {
      setOpenTabIds((prev) => prev.filter((id) => id !== s.id));
    }
    try {
      setError(null);
      await api.deleteTask(taskId);
      await loadAll();
    } catch (err) {
      setError(String(err));
    }
  }

  function handleDeleteTask(taskId: string) {
    const sessions = sessionsByTask[taskId] ?? [];
    if (sessions.length > 0) {
      setModal({
        type: "confirm",
        message: `this task has ${sessions.length} session${sessions.length > 1 ? "s" : ""}.\ndeleting it will remove all sessions within.`,
        onConfirm: () => {
          setModal({ type: "none" });
          executeDeleteTask(taskId);
        },
      });
    } else {
      executeDeleteTask(taskId);
    }
  }

  // Double-click handler: open tab. SessionPanel auto-starts idle and auto-resumes paused sessions.
  function handleDoubleClickSession(id: string) {
    handleOpenTab(id);
  }

  function handleRenameTask(taskId: string, currentTag: string, currentName: string) {
    setModal({ type: "renameTask", taskId, currentTag, currentName });
  }

  async function handleRenameTaskSubmit(taskId: string, newTag: string, newName: string) {
    try {
      setError(null);
      await api.renameTask(taskId, newTag, newName);
      setModal({ type: "none" });
      await loadAll();
    } catch (err) {
      setError(String(err));
    }
  }

  function handleRenameSession(sessionId: string, currentName: string) {
    setModal({ type: "renameSession", sessionId, currentName });
  }

  async function handleRenameSessionSubmit(sessionId: string, newName: string) {
    try {
      setError(null);
      await api.renameSession(sessionId, newName);
      setModal({ type: "none" });
      await loadAll();
    } catch (err) {
      setError(String(err));
    }
  }

  function handleMoveSession(sessionId: string, repoId: string) {
    setModal({ type: "moveSession", sessionId, repoId });
  }

  async function handleMoveSessionSelect(sessionId: string, targetTaskId: string) {
    try {
      setError(null);
      await api.moveSessionToTask(sessionId, targetTaskId);
      setModal({ type: "none" });
      await loadAll();
    } catch (err) {
      setError(String(err));
    }
  }

  // Build tab data for TabBar
  const tabs = openTabIds
    .map((id) => {
      const session = findSession(id, sessionsByRepo, sessionsByTask);
      if (!session) return null;
      return {
        id: session.id,
        name: session.name,
        displayStatus: getDisplayStatus(session.id, session.status),
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  // Find the current task for the move session modal
  const moveSessionTask = modal.type === "moveSession"
    ? findSession(modal.sessionId, sessionsByRepo, sessionsByTask)?.taskId ?? ""
    : "";

  if (view === "settings") {
    return <Settings repos={repos} onBack={() => setView("dashboard")} />;
  }

  return (
    <div className="flex h-screen w-screen" style={{ backgroundColor: "#0A0A0A" }}>
      <Sidebar
        repos={repos}
        tasksByRepo={tasksByRepo}
        sessionsByRepo={sessionsByRepo}
        sessionsByTask={sessionsByTask}
        getDisplayStatus={getDisplayStatus}
        actionsBySession={actionsBySession}
        openTabIds={openTabIds}
        activeSessionId={selectedSessionId}
        expandedSessionId={expandedSessionId}
        onSelectSession={setSelectedSessionId}
        onExpandSession={setExpandedSessionId}
        onOpenTab={handleOpenTab}
        onOpenRepo={() => setModal({ type: "openRepo" })}
        onCreateTask={(repoId) => setModal({ type: "newTask", repoId })}
        onCreateSession={(repoId, taskId) =>
          setModal({ type: "newSession", repoId, taskId })
        }
        onRemoveRepo={handleRemoveRepo}
        onDeleteTask={handleDeleteTask}
        onDeleteSession={handleDelete}
        onArchiveSession={handleArchiveSession}
        onUnarchiveSession={handleUnarchiveSession}
        onArchiveTask={handleArchiveTask}
        onUnarchiveTask={handleUnarchiveTask}
        onMoveSession={handleMoveSession}
        onDoubleClickSession={handleDoubleClickSession}
        onRenameTask={handleRenameTask}
        onRenameSession={handleRenameSession}
        onDropSession={(sessionId, targetTaskId) => handleMoveSessionSelect(sessionId, targetTaskId)}
        onQuickCreateSession={handleQuickCreateSession}
        onError={(msg) => setError(msg)}
        onOpenSettings={() => setView("settings")}
      />

      <main className="flex-1 flex flex-col relative min-w-0 overflow-hidden" style={{ backgroundColor: "#0A0A0A" }}>
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

        {/* Tab bar */}
        {tabs.length > 0 && (
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onCloseAllTabs={handleCloseAllTabs}
            onCloseTabsToLeft={handleCloseTabsToLeft}
            onCloseTabsToRight={handleCloseTabsToRight}
          />
        )}

        {activeSession ? (
          <SessionPanel
            session={activeSession}
            task={activeTask}
            onStop={handleStop}
            onDelete={handleDelete}
            onClose={() => handleCloseTab(activeSession.id)}
            onStart={handleStart}
            onResume={handleResume}
            onUnarchive={handleUnarchiveSession}
            displayStatus={getDisplayStatus(activeSession.id, activeSession.status)}
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

      {modal.type === "moveSession" && (
        <MoveSessionModal
          sessionId={modal.sessionId}
          currentTaskId={moveSessionTask}
          tasks={tasksByRepo[modal.repoId] ?? []}
          onSelect={handleMoveSessionSelect}
          onCancel={() => setModal({ type: "none" })}
        />
      )}

      {modal.type === "renameSession" && (
        <RenameModal
          currentName={modal.currentName}
          onSubmit={(newName) => handleRenameSessionSubmit(modal.sessionId, newName)}
          onCancel={() => setModal({ type: "none" })}
        />
      )}

      {modal.type === "renameTask" && (
        <RenameTaskModal
          currentTag={modal.currentTag}
          currentName={modal.currentName}
          onSubmit={(newTag, newName) => handleRenameTaskSubmit(modal.taskId, newTag, newName)}
          onCancel={() => setModal({ type: "none" })}
        />
      )}

      {modal.type === "confirm" && (
        <ConfirmModal
          message={modal.message}
          confirmLabel="delete"
          onConfirm={modal.onConfirm}
          onCancel={() => setModal({ type: "none" })}
        />
      )}

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              style={{
                backgroundColor: "#1F1F1F",
                border: "1px solid #10B981",
                color: "#FAFAFA",
                fontSize: 12,
                padding: "10px 16px",
                borderRadius: 4,
                maxWidth: 320,
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              }}
            >
              <span style={{ color: "#10B981", marginRight: 8 }}>~</span>
              {toast.message}
            </div>
          ))}
        </div>
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
