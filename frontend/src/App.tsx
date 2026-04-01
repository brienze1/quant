import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Repo,
  Task,
  Session,
  Action,
  Shortcut,
  Job,
  Agent,
  CreateRepoRequest,
  CreateTaskRequest,
  CreateSessionRequest,
  CreateJobRequest,
  UpdateJobRequest,
  CreateAgentRequest,
  UpdateAgentRequest,
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
import { DiffView } from "./components/DiffView";
import { GitCommitModal } from "./components/GitCommitModal";
import { GitPullModal } from "./components/GitPullModal";
import { GitPushModal } from "./components/GitPushModal";
import { JobsView } from "./components/JobsView";
import { CreateJobModal } from "./components/CreateJobModal";
import AgentsView from "./components/AgentsView";
import { CreateAgentModal } from "./components/CreateAgentModal";

type ModalState =
  | { type: "none" }
  | { type: "openRepo" }
  | { type: "newTask"; repoId: string }
  | { type: "newSession"; repoId: string; taskId?: string }
  | { type: "moveSession"; sessionId: string; repoId: string }
  | { type: "confirm"; message: string; onConfirm: () => void }
  | { type: "renameSession"; sessionId: string; currentName: string }
  | { type: "renameTask"; taskId: string; currentTag: string; currentName: string }
  | { type: "gitCommit"; sessionId: string; sessionName: string }
  | { type: "gitPull"; sessionId: string; currentBranch: string }
  | { type: "gitPush"; sessionId: string; currentBranch: string }
  | { type: "createJob" }
  | { type: "editJob"; job: Job }
  | { type: "createAgent" }
  | { type: "editAgent"; agent: Agent };

type View = "dashboard" | "settings" | "diff" | "jobs" | "agents";

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
  // Embedded terminal tracking: parentSessionId -> terminalSessionId
  const [embeddedTerminalMap, setEmbeddedTerminalMap] = useState<Record<string, string>>({});
  // Track which sessions have the terminal pane open: parentSessionId -> boolean
  const [terminalPaneOpenMap, setTerminalPaneOpenMap] = useState<Record<string, boolean>>({});

  const [jobs, setJobs] = useState<Job[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [diffSession, setDiffSession] = useState<{ id: string; name: string } | null>(null);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [commitMessagePrefix, setCommitMessagePrefix] = useState("");
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

  // find embedded terminal session for the active session (if any)
  const activeEmbeddedTerminalSession = activeSession
    ? (findSession(embeddedTerminalMap[activeSession.id], sessionsByRepo, sessionsByTask) ?? null)
    : null;

  // whether the terminal pane is open for the active session
  const activeTerminalPaneOpen = activeSession ? (terminalPaneOpenMap[activeSession.id] ?? false) : false;

  function handleTerminalPaneOpenChange(open: boolean) {
    if (!activeSession) return;
    setTerminalPaneOpenMap(prev => ({ ...prev, [activeSession.id]: open }));
  }

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

  const fetchShortcuts = useCallback(async () => {
    try {
      const cfg = await api.getConfig();
      setShortcuts(cfg.shortcuts ?? []);
      setCommitMessagePrefix(cfg.commitMessagePrefix ?? "");
    } catch (err) {
      console.error("failed to load shortcuts:", err);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const list = await api.listJobs();
      setJobs(list ?? []);
    } catch (err) {
      console.error("failed to list jobs:", err);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const list = await api.listAgents();
      setAgents(list ?? []);
    } catch (err) {
      console.error("failed to list agents:", err);
    }
  }, []);

  // initial load
  const loadAll = useCallback(async () => {
    fetchShortcuts();
    fetchJobs();
    fetchAgents();
    const repoList = await fetchRepos();
    for (const repo of repoList) {
      const tasks = await fetchTasksForRepo(repo.id);
      await fetchSessionsForRepo(repo.id);
      for (const task of tasks) {
        await fetchSessionsForTask(task.id);
      }
    }
  }, [fetchShortcuts, fetchJobs, fetchAgents, fetchRepos, fetchTasksForRepo, fetchSessionsForRepo, fetchSessionsForTask]);

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
    // Clean up embedded terminal if any
    const embeddedTermId = embeddedTerminalMap[id];
    if (embeddedTermId) {
      handleDeleteEmbeddedTerminal(embeddedTermId);
    }

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

  function handleCloseAllTabs() {
    for (const id of openTabIds) {
      const embeddedTermId = embeddedTerminalMap[id];
      if (embeddedTermId) handleDeleteEmbeddedTerminal(embeddedTermId);
    }
    setOpenTabIds([]);
    setActiveTabId(null);
  }

  function handleCloseTabsToLeft(id: string) {
    const idx = openTabIds.indexOf(id);
    if (idx <= 0) return;
    const toClose = openTabIds.slice(0, idx);
    for (const cid of toClose) {
      const embeddedTermId = embeddedTerminalMap[cid];
      if (embeddedTermId) handleDeleteEmbeddedTerminal(embeddedTermId);
    }
    setOpenTabIds((prev) => prev.slice(idx));
    setActiveTabId((prev) => (toClose.includes(prev!) ? id : prev));
  }

  function handleCloseTabsToRight(id: string) {
    const idx = openTabIds.indexOf(id);
    if (idx < 0 || idx >= openTabIds.length - 1) return;
    const toClose = openTabIds.slice(idx + 1);
    for (const cid of toClose) {
      const embeddedTermId = embeddedTerminalMap[cid];
      if (embeddedTermId) handleDeleteEmbeddedTerminal(embeddedTermId);
    }
    setOpenTabIds((prev) => prev.slice(0, idx + 1));
    setActiveTabId((prev) => (toClose.includes(prev!) ? id : prev));
  }

  function handleSelectTab(id: string) {
    setActiveTabId(id);
    setSelectedSessionId(id);
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

  async function handleCreateEmbeddedTerminal(parentSession: Session): Promise<Session> {
    const directory = parentSession.worktreePath || parentSession.directory;
    const req: CreateSessionRequest = {
      name: `term-${parentSession.name}`,
      description: "",
      repoId: parentSession.repoId,
      taskId: parentSession.taskId || undefined,
      sessionType: "terminal",
      useWorktree: false,
      skipPermissions: false,
      autoPull: false,
      pullBranch: "",
      branchNamePattern: "",
      model: "",
      extraCliArgs: "",
      directoryOverride: directory,
    };
    const termSession = await api.createSession(req);
    setEmbeddedTerminalMap(prev => ({ ...prev, [parentSession.id]: termSession.id }));
    await fetchSessionsForRepo(parentSession.repoId);
    if (parentSession.taskId) await fetchSessionsForTask(parentSession.taskId);
    return termSession;
  }

  async function handleDeleteEmbeddedTerminal(terminalSessionId: string) {
    try {
      await api.stopSession(terminalSessionId).catch(() => {});
      await api.deleteSession(terminalSessionId);
    } catch { /* best effort */ }
    setEmbeddedTerminalMap(prev => {
      const next = { ...prev };
      for (const [parentId, termId] of Object.entries(next)) {
        if (termId === terminalSessionId) delete next[parentId];
      }
      return next;
    });
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

  function openGitCommitModal(sessionId: string, sessionName: string) {
    setDiffSession({ id: sessionId, name: sessionName });
    setView("diff");
  }

  async function openGitPullModal(sessionId: string) {
    try {
      const branch = await api.getCurrentBranch(sessionId);
      setModal({ type: "gitPull", sessionId, currentBranch: branch || "main" });
    } catch {
      setModal({ type: "gitPull", sessionId, currentBranch: "main" });
    }
  }

  async function openGitPushModal(sessionId: string) {
    try {
      const branch = await api.getCurrentBranch(sessionId);
      setModal({ type: "gitPush", sessionId, currentBranch: branch || "main" });
    } catch {
      setModal({ type: "gitPush", sessionId, currentBranch: "main" });
    }
  }

  async function handleGitCommit(sessionId: string, message: string, pushAfter: boolean) {
    await api.gitCommit(sessionId, message);
    if (pushAfter) await api.gitPush(sessionId);
  }

  async function handleGitPull(sessionId: string, branch: string) {
    try {
      setError(null);
      await api.gitPull(sessionId, branch);
      setModal({ type: "none" });
    } catch (err) {
      setError(String(err));
      setModal({ type: "none" });
    }
  }

  async function handleGitPush(sessionId: string) {
    try {
      setError(null);
      await api.gitPush(sessionId);
      setModal({ type: "none" });
    } catch (err) {
      setError(String(err));
      setModal({ type: "none" });
    }
  }

  // Filter out embedded terminal sessions from sidebar
  const embeddedIds = new Set(Object.values(embeddedTerminalMap));
  const filterEmbedded = (sessions: Session[]) =>
    sessions.filter(s => !embeddedIds.has(s.id));

  const filteredSessionsByRepo: Record<string, Session[]> = {};
  for (const [repoId, sessions] of Object.entries(sessionsByRepo)) {
    filteredSessionsByRepo[repoId] = filterEmbedded(sessions);
  }
  const filteredSessionsByTask: Record<string, Session[]> = {};
  for (const [taskId, sessions] of Object.entries(sessionsByTask)) {
    filteredSessionsByTask[taskId] = filterEmbedded(sessions);
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

  const currentView: View = view;

  const renderIconStrip = () => (
    <div
      style={{
        width: 40,
        backgroundColor: "#0A0A0A",
        borderLeft: "1px solid #2a2a2a",
        display: "flex",
        flexDirection: "column",
        padding: "8px 0",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <button
          onClick={() => setView("settings")}
          style={{
            width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
            background: "none", border: "none", cursor: "pointer",
            color: currentView === "settings" ? "#FAFAFA" : "#6B7280",
            borderRight: currentView === "settings" ? "2px solid #10B981" : "2px solid transparent",
          }}
          onMouseEnter={(e) => { if (currentView !== "settings") e.currentTarget.style.color = "#FAFAFA"; }}
          onMouseLeave={(e) => { if (currentView !== "settings") e.currentTarget.style.color = "#6B7280"; }}
          title="settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button
          onClick={() => setView("dashboard")}
          style={{
            width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
            background: "none", border: "none", cursor: "pointer",
            color: currentView === "dashboard" ? "#FAFAFA" : "#6B7280",
            borderRight: currentView === "dashboard" ? "2px solid #10B981" : "2px solid transparent",
          }}
          onMouseEnter={(e) => { if (currentView !== "dashboard") e.currentTarget.style.color = "#FAFAFA"; }}
          onMouseLeave={(e) => { if (currentView !== "dashboard") e.currentTarget.style.color = "#6B7280"; }}
          title="sessions"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </button>
        <button
          onClick={() => { fetchJobs(); setView("jobs"); }}
          style={{
            width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
            background: "none", border: "none", cursor: "pointer",
            color: currentView === "jobs" ? "#FAFAFA" : "#6B7280",
            borderRight: currentView === "jobs" ? "2px solid #10B981" : "2px solid transparent",
          }}
          onMouseEnter={(e) => { if (currentView !== "jobs") e.currentTarget.style.color = "#FAFAFA"; }}
          onMouseLeave={(e) => { if (currentView !== "jobs") e.currentTarget.style.color = "#6B7280"; }}
          title="jobs"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </button>
        <button
          onClick={() => { fetchAgents(); setView("agents"); }}
          style={{
            width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
            background: "none", border: "none", cursor: "pointer",
            color: currentView === "agents" ? "#FAFAFA" : "#6B7280",
            borderRight: currentView === "agents" ? "2px solid #10B981" : "2px solid transparent",
          }}
          onMouseEnter={(e) => { if (currentView !== "agents") e.currentTarget.style.color = "#FAFAFA"; }}
          onMouseLeave={(e) => { if (currentView !== "agents") e.currentTarget.style.color = "#6B7280"; }}
          title="agents"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
          </svg>
        </button>
      </div>
    </div>
  );

  const renderModals = () => (
    <>
      {modal.type === "createJob" && (
        <CreateJobModal
          jobs={jobs}
          onSubmit={async (req) => {
            try {
              await api.createJob(req as CreateJobRequest);
              setModal({ type: "none" });
              fetchJobs();
            } catch (err) {
              console.error("failed to create job:", err);
            }
          }}
          onCancel={() => setModal({ type: "none" })}
        />
      )}
      {modal.type === "editJob" && (
        <CreateJobModal
          jobs={jobs}
          editJob={modal.job}
          onSubmit={async (req) => {
            try {
              await api.updateJob(req as UpdateJobRequest);
              setModal({ type: "none" });
              fetchJobs();
            } catch (err) {
              console.error("failed to update job:", err);
            }
          }}
          onCancel={() => setModal({ type: "none" })}
        />
      )}
      {modal.type === "createAgent" && (
        <CreateAgentModal
          onSubmit={async (req) => {
            await api.createAgent(req as CreateAgentRequest);
            setModal({ type: "none" });
            fetchAgents();
          }}
          onCancel={() => setModal({ type: "none" })}
        />
      )}
      {modal.type === "editAgent" && (
        <CreateAgentModal
          agent={modal.agent}
          onSubmit={async (req) => {
            await api.updateAgent(req as UpdateAgentRequest);
            setModal({ type: "none" });
            fetchAgents();
          }}
          onDelete={async (id) => {
            await api.deleteAgent(id);
            setModal({ type: "none" });
            fetchAgents();
          }}
          onCancel={() => setModal({ type: "none" })}
        />
      )}
    </>
  );

  if (view === "settings") {
    return <Settings repos={repos} onBack={() => { fetchShortcuts(); setView("dashboard"); }} />;
  }

  if (view === "jobs") {
    return (
      <div className="flex h-screen w-screen" style={{ backgroundColor: "#0A0A0A" }}>
        <JobsView
          jobs={jobs}
          onCreateJob={() => setModal({ type: "createJob" })}
          onEditJob={(job) => setModal({ type: "editJob", job })}
          onRefreshJobs={fetchJobs}
        />
        {renderIconStrip()}
        {renderModals()}
      </div>
    );
  }

  if (view === "agents") {
    return (
      <div className="flex h-screen w-screen" style={{ backgroundColor: "#0A0A0A" }}>
        <AgentsView
          agents={agents}
          onCreateAgent={() => setModal({ type: "createAgent" })}
          onEditAgent={(agent: Agent) => setModal({ type: "editAgent", agent })}
          onDeleteAgent={async (id: string) => {
            await api.deleteAgent(id);
            fetchAgents();
          }}
          onRefreshAgents={fetchAgents}
        />
        {renderIconStrip()}
        {renderModals()}
      </div>
    );
  }

  if (view === "diff" && diffSession) {
    return (
      <DiffView
        sessionId={diffSession.id}
        sessionName={diffSession.name}
        commitMessagePrefix={commitMessagePrefix}
        onBack={() => setView("dashboard")}
      />
    );
  }

  return (
    <div className="flex h-screen w-screen" style={{ backgroundColor: "#0A0A0A" }}>
      <Sidebar
        repos={repos}
        tasksByRepo={tasksByRepo}
        sessionsByRepo={filteredSessionsByRepo}
        sessionsByTask={filteredSessionsByTask}
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
        onError={(msg) => setError(msg)}
        onOpenSettings={() => setView("settings")}
        onOpenJobs={() => { fetchJobs(); setView("jobs"); }}
        currentView={view}
        shortcuts={shortcuts}
        onGitCommit={openGitCommitModal}
        onGitPull={openGitPullModal}
        onGitPush={openGitPushModal}
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
            onStart={handleStart}
            onResume={handleResume}
            onUnarchive={handleUnarchiveSession}
            displayStatus={getDisplayStatus(activeSession.id, activeSession.status)}
            embeddedTerminalSession={activeEmbeddedTerminalSession}
            terminalPaneOpen={activeTerminalPaneOpen}
            onTerminalPaneOpenChange={handleTerminalPaneOpenChange}
            onCreateEmbeddedTerminal={handleCreateEmbeddedTerminal}
          />
        ) : (
          <EmptyState />
        )}
      </main>

      {renderIconStrip()}

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

      {modal.type === "gitCommit" && (
        <GitCommitModal
          sessionName={modal.sessionName}
          commitMessagePrefix={commitMessagePrefix}
          onSubmit={(message, pushAfter) => handleGitCommit(modal.sessionId, message, pushAfter)}
          onCancel={() => setModal({ type: "none" })}
        />
      )}

      {modal.type === "gitPull" && (
        <GitPullModal
          sessionId={modal.sessionId}
          currentBranch={modal.currentBranch}
          onSubmit={(branch) => handleGitPull(modal.sessionId, branch)}
          onCancel={() => setModal({ type: "none" })}
        />
      )}

      {modal.type === "gitPush" && (
        <GitPushModal
          sessionId={modal.sessionId}
          currentBranch={modal.currentBranch}
          onSubmit={() => handleGitPush(modal.sessionId)}
          onCancel={() => setModal({ type: "none" })}
        />
      )}

      {renderModals()}

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
