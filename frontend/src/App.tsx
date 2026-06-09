import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Repo,
  Task,
  Session,
  Action,
  Shortcut,
  Job,
  Agent,
  Workspace,
  JobGroup,
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
import { VoicePane } from "./components/VoicePane";
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
import { QuantAssistant } from "./components/QuantAssistant";
import { ChangelogModal } from "./components/ChangelogModal";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { ThemeQuickPicker } from "./components/ThemeQuickPicker";
import { getActiveKeybindings, findMatchingAction, formatKeyCombo } from "./keybindings";
import type { ChangelogEntry } from "./types";

// localStorage key carrying WHICH session voice is attached to. The Go-backed
// "voice:pane" event/config only sync the open/closed BOOL (we can't change the
// Go shape here), so this companion carries the session id: it persists across
// reloads and, via the cross-tab `storage` event, keeps every tab in the same
// browser agreed on the attached session. Remote clients (a separate browser)
// still converge on open/closed via the event and fall back to the active tab.
const VOICE_SESSION_KEY = "quant:voiceSessionId";

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
  | { type: "editAgent"; agent: Agent }
  | { type: "changelog" };

type View = "dashboard" | "settings" | "diff" | "jobs" | "agents";

// A DETACHED window is pinned to a single workspace (injected Go-side by the
// loopback attach server's serveIndex as window.__quantPinnedWorkspace). When
// set, this window locks to that workspace and hides the workspace switcher.
const PINNED_WORKSPACE: string | null =
  (typeof window !== "undefined" &&
    (window as { __quantPinnedWorkspace?: string }).__quantPinnedWorkspace) || null;
// The "detach workspace to new window" action only works from the PRIMARY native
// window: the windowController binding is not exposed over the remote tunnel or
// to detached windows (both run through the shim, which sets __quantRemote).
const IS_PRIMARY_NATIVE =
  typeof window !== "undefined" &&
  (window as { __quantRemote?: boolean }).__quantRemote !== true;

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tasksByRepo, setTasksByRepo] = useState<Record<string, Task[]>>({});
  const [sessionsByRepo, setSessionsByRepo] = useState<Record<string, Session[]>>({});
  const [sessionsByTask, setSessionsByTask] = useState<Record<string, Session[]>>({});
  const [actionsBySession, setActionsBySession] = useState<Record<string, Action[]>>({});

  // Tab model: multiple open tabs, one active (per workspace)
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // selectedSessionId tracks sidebar highlight (may differ from active tab)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  // Store tabs per workspace so they're preserved when switching
  const tabsByWorkspace = useRef<Record<string, { openTabIds: string[]; activeTabId: string | null; selectedSessionId: string | null }>>({});

  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  // Mindmap boards per session (backend, non-empty boards) for the sidebar tree.
  const [boardsBySession, setBoardsBySession] = useState<Record<string, string[]>>({});
  // Active mindmap board per session, kept reactive so the sidebar highlight updates.
  const [activeBoardBySession, setActiveBoardBySession] = useState<Record<string, string>>({});
  const [transitionStatus, setTransitionStatus] = useState<Record<string, "starting" | "stopping" | "resuming">>({});
  const [activeOutputIds, setActiveOutputIds] = useState<Set<string>>(new Set());
  const outputTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Embedded terminal tracking: parentSessionId -> terminalSessionId
  const [embeddedTerminalMap, setEmbeddedTerminalMap] = useState<Record<string, string>>({});
  // Track which sessions have the terminal pane open: parentSessionId -> boolean
  const [terminalPaneOpenMap, setTerminalPaneOpenMap] = useState<Record<string, boolean>>({});
  // Mindmap pane open/closed is PER-SESSION (like the terminal pane above):
  // sessionId -> boolean, kept in local state only. Opening it for one session
  // must not open it for the others. Ephemeral — resets to closed on restart.
  const [mindmapPaneOpenMap, setMindmapPaneOpenMap] = useState<Record<string, boolean>>({});
  // Voice is PINNED to the session it was opened on. The single source of truth
  // is the session id voice is attached to (null = voice closed). The pane stays
  // bound to this session even when the user switches the active tab, so it must
  // be mounted at App scope keyed by this id (not inside the active SessionPanel,
  // which would unmount on tab switch). Synced across tabs/remote clients via the
  // global "voice:pane" open/closed event plus a localStorage companion carrying
  // WHICH session is attached (see VOICE_SESSION_KEY).
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null);
  // Derived boolean for the (still bool) global open/closed sync + pane toggles.
  const voicePaneOpen = voiceSessionId !== null;

  const [jobs, setJobs] = useState<Job[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(
    () => PINNED_WORKSPACE || localStorage.getItem("quant:activeWorkspaceId") || "default"
  );
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false);
  const [quantiConvID, setQuantiConvID] = useState<string>("");
  const [quantiModel, setQuantiModel] = useState<string>("claude-sonnet-4-6");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [jobGroups, setJobGroups] = useState<JobGroup[]>([]);
  const [appVersion, setAppVersion] = useState<string>("");
  const [changelogEntries, setChangelogEntries] = useState<ChangelogEntry[]>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newClaudeConfigPath, setNewClaudeConfigPath] = useState("");
  const [newMcpConfigPath, setNewMcpConfigPath] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editWorkspaceForm, setEditWorkspaceForm] = useState({ name: "", claudeConfigPath: "", mcpConfigPath: "" });
  const [pathErrors, setPathErrors] = useState({ claude: "", mcp: "" });
  const [diffSession, setDiffSession] = useState<{ id: string; name: string } | null>(null);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [commitMessagePrefix, setCommitMessagePrefix] = useState("");
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string; sessionId?: string }[]>([]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
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

  // The session voice is pinned to (if any). Resolved from the same store the
  // rest of the UI uses, so the voice dock header can show the session's name.
  const voiceSession = findSession(voiceSessionId, sessionsByRepo, sessionsByTask);

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

  // whether the mindmap pane is open for the active session (per-session, like
  // the terminal pane above)
  const activeMindmapPaneOpen = activeSession ? (mindmapPaneOpenMap[activeSession.id] ?? false) : false;

  function handleMindmapPaneOpenChange(open: boolean) {
    if (!activeSession) return;
    setMindmapPaneOpenMap(prev => ({ ...prev, [activeSession.id]: open }));
  }

  // Tracks which session currently holds a LIVE voice attachment (kicked off),
  // so we inject the persona exactly once per attachment and never re-kick just
  // because the active tab changed. Holds at most one session at a time (voice
  // is pinned to a single session). Cleared when voice closes or moves away.
  const voiceStartedRef = useRef<string | null>(null);
  // Live mirror of voiceSessionId for handlers/effects that must read the
  // current attachment without re-subscribing.
  const voiceSessionIdRef = useRef(voiceSessionId);
  voiceSessionIdRef.current = voiceSessionId;

  // Persist the attached session id to localStorage so reloads + other tabs in
  // the SAME browser converge on which session voice is pinned to. The Go-backed
  // open/closed bool is synced separately (setVoicePaneOpen below).
  function persistVoiceSession(sessionId: string | null) {
    try {
      if (sessionId) localStorage.setItem(VOICE_SESSION_KEY, sessionId);
      else localStorage.removeItem(VOICE_SESSION_KEY);
    } catch {
      /* localStorage may be unavailable; non-fatal */
    }
  }

  // Fire the one-time persona kickoff for a freshly-attached (or moved) voice
  // session. Idempotent per attachment via voiceStartedRef. Surfaces a non-fatal
  // error (and clears the guard so re-opening retries) if the session has no
  // live agent process.
  function kickoffVoice(sessionId: string) {
    if (voiceStartedRef.current === sessionId) return;
    voiceStartedRef.current = sessionId;
    // Pass the pinned session's workspace so the kickoff resolves that
    // workspace's voice override (empty = backend falls back to current).
    const wsId =
      findSession(sessionId, sessionsByRepo, sessionsByTask)?.workspaceId ?? "";
    api.startVoiceSession(sessionId, wsId).catch((err) => {
      if (voiceStartedRef.current === sessionId) voiceStartedRef.current = null;
      console.error("failed to start voice session:", err);
      const msg = String((err && err.message) || err || "");
      setError(
        msg.includes("no process running")
          ? "Start the session's agent before enabling voice."
          : `Couldn't start voice mode: ${msg || "unknown error"}`
      );
    });
  }

  // PIN voice to `sessionId`: attach (open), or MOVE from another session
  // (winding the old one down happens automatically — the VoicePane is keyed by
  // voiceSessionId, so changing it remounts the pane onto the new session and
  // tears the old bridge down, gracefully closing any in-flight request). Kicks
  // off the persona exactly once for this attachment. Broadcasts open=true so
  // other tabs/remote clients show the pane (which session is carried via the
  // localStorage companion + the active-tab fallback).
  function attachVoice(sessionId: string) {
    if (voiceSessionId === sessionId) return;
    // Moving to a different session — drop the old attachment's kickoff guard so
    // the new session gets its own kickoff.
    if (voiceSessionId && voiceSessionId !== sessionId) {
      voiceStartedRef.current = null;
    }
    setVoiceSessionId(sessionId);
    persistVoiceSession(sessionId);
    api.setVoicePaneOpen(true).catch((err) =>
      console.error("failed to persist voice pane state:", err)
    );
    kickoffVoice(sessionId);
  }

  // Close voice entirely (detach from whatever session holds it). Remounts the
  // pane away (null) which tears the bridge down and gracefully closes any
  // in-flight request. Broadcasts open=false so all clients close.
  function detachVoice() {
    if (voiceSessionId === null) return;
    setVoiceSessionId(null);
    voiceStartedRef.current = null;
    persistVoiceSession(null);
    api.setVoicePaneOpen(false).catch((err) =>
      console.error("failed to persist voice pane state:", err)
    );
  }

  // Self-heal a "zombie" voice pane: if voice is pinned to a session that no
  // longer exists in the current store (a remote client archived/deleted it, it
  // dropped on a loadAll() refresh, or a stale restored id), detach so we don't
  // leave a VoicePane bound to a dead session. Gated on the store being
  // non-empty so a transient empty list during initial hydration / refresh does
  // NOT wrongly detach a just-restored attachment.
  useEffect(() => {
    if (voiceSessionId === null) return;
    const sessionsLoaded =
      Object.values(sessionsByRepo).some((list) => list.length > 0) ||
      Object.values(sessionsByTask).some((list) => list.length > 0);
    if (!sessionsLoaded) return;
    if (!findSession(voiceSessionId, sessionsByRepo, sessionsByTask)) {
      detachVoice();
    }
  }, [voiceSessionId, sessionsByRepo, sessionsByTask]); // eslint-disable-line react-hooks/exhaustive-deps

  // The SessionPanel voice toggle reports the desired open/closed for the ACTIVE
  // session. Opening (or re-targeting from another session) pins voice to the
  // active session; closing detaches. This is the only user-initiated path.
  function handleVoicePaneOpenChange(open: boolean) {
    const sessionId = activeSession?.id;
    if (open) {
      if (sessionId) attachVoice(sessionId);
    } else {
      detachVoice();
    }
  }

  // --- data fetching ---

  const fetchRepos = useCallback(async (wsId?: string) => {
    try {
      const list = await api.listReposByWorkspace(wsId ?? activeWorkspaceId);
      setRepos(list ?? []);
      return list ?? [];
    } catch (err) {
      console.error("failed to list repos:", err);
      return [];
    }
  }, [activeWorkspaceId]);

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

  const fetchWorkspaces = useCallback(async () => {
    try {
      const list = await api.listWorkspaces();
      setWorkspaces(list ?? []);
    } catch (err) {
      console.error("failed to list workspaces:", err);
    }
  }, []);

  const fetchJobGroups = useCallback(async () => {
    try {
      const list = await api.listJobGroupsByWorkspace(activeWorkspaceId);
      setJobGroups(list ?? []);
    } catch (err) {
      console.error("failed to list job groups:", err);
    }
  }, [activeWorkspaceId]);

  // initial load
  const loadAll = useCallback(async () => {
    fetchShortcuts();
    fetchJobs();
    fetchAgents();
    fetchWorkspaces();
    fetchJobGroups();
    const repoList = await fetchRepos();
    for (const repo of repoList) {
      const tasks = await fetchTasksForRepo(repo.id);
      await fetchSessionsForRepo(repo.id);
      for (const task of tasks) {
        await fetchSessionsForTask(task.id);
      }
    }
  }, [fetchShortcuts, fetchJobs, fetchAgents, fetchWorkspaces, fetchJobGroups, fetchRepos, fetchTasksForRepo, fetchSessionsForRepo, fetchSessionsForTask]);

  useEffect(() => {
    loadAll().then(async () => {
      // Restore all open session tabs from persisted config
      try {
        const cfg = await api.getConfig();
        const ids = cfg.openSessionIds ?? [];
        for (const id of ids) {
          setOpenTabIds((prev) => prev.includes(id) ? prev : [...prev, id]);
        }
        if (cfg.activeSessionId && ids.includes(cfg.activeSessionId)) {
          setActiveTabId(cfg.activeSessionId);
          setSelectedSessionId(cfg.activeSessionId);
        } else if (ids.length > 0) {
          setActiveTabId(ids[0]);
          setSelectedSessionId(ids[0]);
        }
        // Mindmap pane open state is per-session and ephemeral now — nothing to
        // hydrate from config.
        // Hydrate the voice attachment. The Go config only persists the
        // open/closed BOOL; WHICH session is restored from the localStorage
        // companion (this browser), falling back to the persisted active session
        // for a fresh/remote client. We do NOT kick off here — a persisted-open
        // pane must not spuriously re-inject the persona on launch.
        if (cfg.voicePaneOpen) {
          let restored: string | null = null;
          try {
            restored = localStorage.getItem(VOICE_SESSION_KEY);
          } catch {
            restored = null;
          }
          if (!restored || !ids.includes(restored)) {
            restored = cfg.activeSessionId && ids.includes(cfg.activeSessionId)
              ? cfg.activeSessionId
              : ids[0] ?? null;
          }
          if (restored) {
            setVoiceSessionId(restored);
            persistVoiceSession(restored);
            // Treat the restored attachment as already-kicked so the first user
            // interaction doesn't re-inject; the agent loop survives reloads.
            voiceStartedRef.current = restored;
          }
        }
        voicePaneHydratedRef.current = true;
      } catch (err) {
        console.error("failed to restore active session:", err);
      }
    });
    // Load app version and changelog
    api.getVersion().then(setAppVersion).catch(() => setAppVersion(""));
    api.getChangelog().then((cl) => setChangelogEntries(cl.entries ?? [])).catch(() => {});
    // Set up Quanti directory (writes CLAUDE.md, memory files, runs background consolidation)
    // convID starts empty — first message creates a new Claude conversation,
    // then the quanti:session event gives us the real conversation ID for --resume
    api.getConfig()
      .then((cfg) => {
        const model = cfg.assistantModel || "claude-sonnet-4-6";
        setQuantiModel(model);
        return api.startAssistantSession(model);
      })
      .catch((err) => console.error("failed to start quanti:", err));
  }, [loadAll]); // eslint-disable-line react-hooks/exhaustive-deps


  // Persist active workspace to localStorage and reload data
  const prevWorkspaceId = useRef(activeWorkspaceId);
  useEffect(() => {
    // A pinned (detached) window must not hijack the shared backend's current
    // workspace — it locks to PINNED_WORKSPACE locally and leaves the global
    // CurrentWorkspaceID (which the primary owns) untouched.
    if (!PINNED_WORKSPACE) {
      localStorage.setItem("quant:activeWorkspaceId", activeWorkspaceId);
      api.setCurrentWorkspace(activeWorkspaceId).catch((err) =>
        console.error("failed to sync active workspace to backend:", err)
      );
    }

    // Save current tabs for the previous workspace
    if (prevWorkspaceId.current !== activeWorkspaceId) {
      tabsByWorkspace.current[prevWorkspaceId.current] = {
        openTabIds,
        activeTabId,
        selectedSessionId,
      };
      // Restore tabs for the new workspace (or clear)
      const saved = tabsByWorkspace.current[activeWorkspaceId];
      if (saved) {
        setOpenTabIds(saved.openTabIds);
        setActiveTabId(saved.activeTabId);
        setSelectedSessionId(saved.selectedSessionId);
      } else {
        setOpenTabIds([]);
        setActiveTabId(null);
        setSelectedSessionId(null);
      }
      prevWorkspaceId.current = activeWorkspaceId;
    }

    // Reload workspace-scoped data after letting React paint the tab swap
    // first. Doing this synchronously after setOpenTabIds caused a long
    // render storm (every fetch resolved with a setState) on top of the
    // TerminalPane remount, freezing the UI when a session was actively
    // streaming output. We yield one task, then fan out in parallel.
    const handle = setTimeout(() => {
      (async () => {
        const repoList = await fetchRepos(activeWorkspaceId);
        await Promise.all(
          repoList.map(async (repo) => {
            const [tasks] = await Promise.all([
              fetchTasksForRepo(repo.id),
              fetchSessionsForRepo(repo.id),
            ]);
            await Promise.all(tasks.map((task) => fetchSessionsForTask(task.id)));
          })
        );
      })().catch((err) => console.error("failed to reload workspace data:", err));
      fetchJobs();
      fetchAgents();
      fetchJobGroups();
    }, 0);
    return () => clearTimeout(handle);
  }, [activeWorkspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guards the initial hydration of the global voice pane flag from config.
  const voicePaneHydratedRef = useRef(false);

  // Persist open tabs and active tab to config whenever they change
  const tabsRestoredRef = useRef(false);
  useEffect(() => {
    // Skip until initial restore from config has completed
    if (!tabsRestoredRef.current) {
      if (openTabIds.length > 0 || activeTabId) {
        tabsRestoredRef.current = true;
      }
      return;
    }
    api.getConfig()
      .then((cfg) => {
        cfg.openSessionIds = openTabIds;
        cfg.activeSessionId = activeTabId ?? "";
        return api.saveConfig(cfg);
      })
      .catch((err) => console.error("failed to persist open tabs:", err));
  }, [openTabIds, activeTabId]);

  // Close workspace dropdown when clicking outside
  useEffect(() => {
    if (!workspaceDropdownOpen) {
      setCreatingWorkspace(false);
      setNewWorkspaceName("");
      setDeletingWorkspaceId(null);
      return;
    }
    const handleClick = () => setWorkspaceDropdownOpen(false);
    const timer = setTimeout(() => document.addEventListener("click", handleClick), 0);
    return () => { clearTimeout(timer); document.removeEventListener("click", handleClick); };
  }, [workspaceDropdownOpen]);


  // --- Global keyboard shortcuts ---
  // Keep refs current for the keyboard handler
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const viewRef = useRef(view);
  viewRef.current = view;
  const commandPaletteOpenRef = useRef(commandPaletteOpen);
  commandPaletteOpenRef.current = commandPaletteOpen;
  const themePickerOpenRef = useRef(themePickerOpen);
  themePickerOpenRef.current = themePickerOpen;

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      // Skip when an overlay (command palette, theme picker) is open — they handle their own keys
      if (commandPaletteOpenRef.current || themePickerOpenRef.current) return;

      // Skip when settings view is active and user is recording keybindings
      if (viewRef.current === "settings") return;

      const bindings = getActiveKeybindings();
      const matched = findMatchingAction(e, bindings);
      if (!matched) return;

      // When terminal (xterm) has focus, only allow navigation/palette shortcuts through
      const active = document.activeElement;
      if (active && active.closest(".xterm")) {
        const allowedInTerminal = new Set([
          "nextTab", "prevTab", "closeTab", "stopSession",
          "tab1", "tab2", "tab3", "tab4", "tab5", "tab6", "tab7", "tab8", "tab9",
          "workspace1", "workspace2", "workspace3", "workspace4", "workspace5",
          "workspace6", "workspace7", "workspace8", "workspace9",
          "commandPalette", "themePicker",
        ]);
        if (!allowedInTerminal.has(matched.id)) return;
      }

      e.preventDefault();
      e.stopPropagation();

      const tabs = openTabIdsRef.current;
      const currentTab = activeTabIdRef.current;

      // Focus the terminal in the newly active session after React re-renders
      function focusTerminalAfterSwitch() {
        requestAnimationFrame(() => {
          const textarea = document.querySelector(".xterm textarea") as HTMLElement | null;
          textarea?.focus();
        });
      }

      switch (matched.id) {
        case "nextTab": {
          if (tabs.length === 0) return;
          const idx = currentTab ? tabs.indexOf(currentTab) : -1;
          const nextIdx = (idx + 1) % tabs.length;
          setActiveTabId(tabs[nextIdx]);
          setSelectedSessionId(tabs[nextIdx]);
          focusTerminalAfterSwitch();
          break;
        }
        case "prevTab": {
          if (tabs.length === 0) return;
          const idx = currentTab ? tabs.indexOf(currentTab) : 0;
          const prevIdx = (idx - 1 + tabs.length) % tabs.length;
          setActiveTabId(tabs[prevIdx]);
          setSelectedSessionId(tabs[prevIdx]);
          focusTerminalAfterSwitch();
          break;
        }
        case "tab1": case "tab2": case "tab3": case "tab4": case "tab5":
        case "tab6": case "tab7": case "tab8": case "tab9": {
          const n = parseInt(matched.id.replace("tab", ""), 10) - 1;
          if (n < tabs.length) {
            setActiveTabId(tabs[n]);
            setSelectedSessionId(tabs[n]);
            focusTerminalAfterSwitch();
          }
          break;
        }
        case "closeTab": {
          if (currentTab) {
            handleCloseTab(currentTab);
          }
          break;
        }
        case "stopSession": {
          if (currentTab) {
            handleStop(currentTab);
          }
          break;
        }
        case "workspace1": case "workspace2": case "workspace3": case "workspace4":
        case "workspace5": case "workspace6": case "workspace7": case "workspace8":
        case "workspace9": {
          const n = parseInt(matched.id.replace("workspace", ""), 10) - 1;
          const ws = workspacesRef.current;
          if (n < ws.length) {
            setActiveWorkspaceId(ws[n].id);
          }
          break;
        }
        case "themePicker": {
          setThemePickerOpen(true);
          break;
        }
        case "commandPalette": {
          setCommandPaletteOpen(true);
          break;
        }
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Fetch a session's mindmap boards when it is expanded in the sidebar tree.
  useEffect(() => {
    if (!expandedSessionId) return;
    const id = expandedSessionId;
    api
      .listBoards(id)
      .then((boards) => {
        setBoardsBySession((prev) => ({ ...prev, [id]: Array.isArray(boards) ? boards : [] }));
      })
      .catch(() => {});
  }, [expandedSessionId]);

  // Keep a session's board list fresh when mindmap nodes change. A board only
  // appears in listBoards once it has >=1 node, so we union the event's board.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (!w?.runtime?.EventsOn) return;
    const cancel = w.runtime.EventsOn(
      "mindmap:updated",
      (d: { sessionId?: string; board?: string; nodes?: unknown }) => {
        if (!d?.sessionId || !d.board) return;
        const { sessionId, board, nodes } = d;
        const isEmpty = Array.isArray(nodes) && nodes.length === 0;
        setBoardsBySession((prev) => {
          const existing = prev[sessionId];
          // Only track sessions we already know about (i.e. expanded at least once).
          if (!existing) return prev;
          // An empty board (e.g. the old name after a rename) should be pruned
          // from the sidebar, but never the "default" board.
          if (isEmpty && board !== "default") {
            if (!existing.includes(board)) return prev;
            return { ...prev, [sessionId]: existing.filter((b) => b !== board) };
          }
          if (existing.includes(board)) return prev;
          return { ...prev, [sessionId]: [...existing, board] };
        });
      }
    );
    return () => cancel && cancel();
  }, []);

  // Keep the voice attachment in sync across every tab and remote client. The
  // Go event carries only the open/closed BOOL, so on open we resolve WHICH
  // session from the localStorage companion (same-browser tabs), falling back to
  // the active tab (remote clients). Idempotent: SETS state, never toggles. This
  // is a remote/cross-tab convergence path — it never re-kicks the persona (the
  // originating client already did), so we mark the attachment as already-kicked.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (!w?.runtime?.EventsOn) return;
    const cancel = w.runtime.EventsOn("voice:pane", (d: { open?: boolean }) => {
      const open = !!(d && d.open);
      if (!open) {
        setVoiceSessionId(null);
        voiceStartedRef.current = null;
        persistVoiceSession(null);
        return;
      }
      // Already attached locally → nothing to converge.
      if (voiceSessionIdRef.current !== null) return;
      let target: string | null = null;
      try {
        target = localStorage.getItem(VOICE_SESSION_KEY);
      } catch {
        target = null;
      }
      const tabs = openTabIdsRef.current;
      if (!target || !tabs.includes(target)) {
        target = activeTabIdRef.current && tabs.includes(activeTabIdRef.current)
          ? activeTabIdRef.current
          : tabs[0] ?? null;
      }
      if (target) {
        setVoiceSessionId(target);
        persistVoiceSession(target);
        voiceStartedRef.current = target;
      }
    });
    return () => cancel && cancel();
  }, []);

  // Cross-tab (same browser) convergence on WHICH session voice is attached to.
  // attachVoice/detachVoice write the companion key; sibling tabs pick the change
  // up via the `storage` event. The Go "voice:pane" event handles open/closed; we
  // additionally re-point an already-open pane when a sibling MOVES voice.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== VOICE_SESSION_KEY) return;
      const next = e.newValue;
      if (next === voiceSessionIdRef.current) return;
      if (next) {
        // Converge onto the sibling's attachment without re-kicking.
        setVoiceSessionId(next);
        voiceStartedRef.current = next;
      } else {
        setVoiceSessionId(null);
        voiceStartedRef.current = null;
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
            // Skip notifications for the assistant session
            if (session?.name === "__quanti__") return;
            const name = session?.name ?? id;

            // In-app toast notification
            const toastId = ++toastIdRef.current;
            setToasts((prev) => [...prev, { id: toastId, message: `session "${name}" has finished`, sessionId: id }]);
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

    const tabs = openTabIdsRef.current;
    const wasActive = activeTabIdRef.current === id;

    setOpenTabIds((prev) => prev.filter((t) => t !== id));

    if (wasActive) {
      const idx = tabs.indexOf(id);
      let nextActive: string | null = null;
      if (tabs.length > 1) {
        nextActive = idx === tabs.length - 1 ? tabs[idx - 1] : tabs[idx + 1];
      }
      setActiveTabId(nextActive);
      setSelectedSessionId(nextActive);
    }
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
      req.workspaceId = activeWorkspaceId;
      await api.openRepo(req);
      setModal({ type: "none" });
      await loadAll();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleReopenRecentRepo(repo: { name: string; path: string }) {
    try {
      setError(null);
      await api.openRepo({
        name: repo.name,
        path: repo.path,
        workspaceId: activeWorkspaceId,
      });
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
      req.workspaceId = activeWorkspaceId;
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

  async function handleRestart(id: string, rows: number, cols: number) {
    try {
      setError(null);
      setTransitionStatus((prev) => ({ ...prev, [id]: "stopping" }));
      await api.stopSession(id);
      // Small delay to let the process fully exit before respawning
      await new Promise((r) => setTimeout(r, 500));
      setTransitionStatus((prev) => ({ ...prev, [id]: "resuming" }));
      await api.resumeSession(id, rows, cols);
      clearTransition(id);
      // Signal terminal panes to refit after restart
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("terminal:refit"));
      }, 500);
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
      // If voice was pinned to the deleted session, detach it (close the pane).
      if (voiceSessionIdRef.current === id) detachVoice();
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
      // If voice was pinned to the archived session, detach it (close the pane).
      if (voiceSessionIdRef.current === id) detachVoice();
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
      workspaceId: activeWorkspaceId,
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

  // Open a session and switch its mindmap pane to the chosen board.
  function handleSelectBoard(sessionId: string, board: string) {
    handleOpenTab(sessionId);
    localStorage.setItem("quant.mindmapBoard." + sessionId, board);
    setActiveBoardBySession((prev) => ({ ...prev, [sessionId]: board }));
    // Open the mindmap pane for THIS session specifically. We can't go through
    // handleMindmapPaneOpenChange (which targets the active session) because the
    // tab we just opened isn't the active session synchronously yet.
    setMindmapPaneOpenMap((prev) => ({ ...prev, [sessionId]: true }));
  }

  // Move a board from one session to another (mirrors session-onto-task move).
  async function handleMoveBoard(board: string, fromSessionId: string, toSessionId: string) {
    if (fromSessionId === toSessionId) return;
    try {
      setError(null);
      await api.moveMindmapBoard(fromSessionId, board, toSessionId);
      const [fromBoards, toBoards] = await Promise.all([
        api.listBoards(fromSessionId),
        api.listBoards(toSessionId),
      ]);
      setBoardsBySession((prev) => ({
        ...prev,
        [fromSessionId]: Array.isArray(fromBoards) ? fromBoards : [],
        [toSessionId]: Array.isArray(toBoards) ? toBoards : [],
      }));
    } catch (err) {
      setError(String(err));
    }
  }

  // Rename a board for a session (mirrors handleMoveBoard's refresh pattern).
  async function handleRenameBoard(sessionId: string, oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    try {
      setError(null);
      const final = await api.renameBoard(sessionId, oldName, trimmed);
      const boards = await api.listBoards(sessionId);
      setBoardsBySession((prev) => ({
        ...prev,
        [sessionId]: Array.isArray(boards) ? boards : [],
      }));
      // If the renamed board was the active one, keep the selection in sync.
      const active = localStorage.getItem("quant.mindmapBoard." + sessionId);
      if (active === oldName) {
        localStorage.setItem("quant.mindmapBoard." + sessionId, final);
        setActiveBoardBySession((prev) => ({ ...prev, [sessionId]: final }));
        window.dispatchEvent(
          new CustomEvent("quant:mindmap-select-board", { detail: { sessionId, board: final } })
        );
      }
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

  // Filter out embedded terminal sessions and filter by active workspace
  const embeddedIds = new Set(Object.values(embeddedTerminalMap));
  const filterSessions = (sessions: Session[]) =>
    sessions.filter(s => !embeddedIds.has(s.id) && s.workspaceId === activeWorkspaceId && s.name !== "__quanti__");

  const filteredSessionsByRepo: Record<string, Session[]> = {};
  for (const [repoId, sessions] of Object.entries(sessionsByRepo)) {
    filteredSessionsByRepo[repoId] = filterSessions(sessions);
  }
  const filteredSessionsByTask: Record<string, Session[]> = {};
  for (const [taskId, sessions] of Object.entries(sessionsByTask)) {
    filteredSessionsByTask[taskId] = filterSessions(sessions);
  }

  // Filter jobs and agents by active workspace
  const filteredJobs = jobs.filter(j => j.workspaceId === activeWorkspaceId);
  const filteredAgents = agents.filter(a => a.workspaceId === activeWorkspaceId);

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

  // Build command palette commands
  const paletteCommands: PaletteCommand[] = (() => {
    const bindings = getActiveKeybindings();
    const shortcutFor = (id: string) => bindings.find((b) => b.id === id)?.keys;
    const cmds: PaletteCommand[] = [];

    // Tab commands
    cmds.push({ id: "nextTab", label: "Next tab", category: "tabs", shortcut: shortcutFor("nextTab"), onExecute: () => {
      if (openTabIds.length === 0) return;
      const idx = activeTabId ? openTabIds.indexOf(activeTabId) : -1;
      const next = openTabIds[(idx + 1) % openTabIds.length];
      setActiveTabId(next); setSelectedSessionId(next);
    }});
    cmds.push({ id: "prevTab", label: "Previous tab", category: "tabs", shortcut: shortcutFor("prevTab"), onExecute: () => {
      if (openTabIds.length === 0) return;
      const idx = activeTabId ? openTabIds.indexOf(activeTabId) : 0;
      const prev = openTabIds[(idx - 1 + openTabIds.length) % openTabIds.length];
      setActiveTabId(prev); setSelectedSessionId(prev);
    }});
    cmds.push({ id: "closeTab", label: "Close current tab", category: "tabs", shortcut: shortcutFor("closeTab"), onExecute: () => { if (activeTabId) handleCloseTab(activeTabId); } });
    cmds.push({ id: "closeAllTabs", label: "Close all tabs", category: "tabs", onExecute: handleCloseAllTabs });

    // Jump to specific tabs
    tabs.forEach((t, i) => {
      cmds.push({ id: `gotoTab-${t.id}`, label: `Go to tab: ${t.name}`, category: "tabs", shortcut: i < 9 ? shortcutFor(`tab${i + 1}`) : undefined, onExecute: () => { setActiveTabId(t.id); setSelectedSessionId(t.id); } });
    });

    // Session
    if (activeTabId) {
      cmds.push({ id: "stopSession", label: "Stop active session", category: "session", shortcut: shortcutFor("stopSession"), onExecute: () => handleStop(activeTabId) });
    }

    // Workspace
    workspaces.forEach((ws, i) => {
      cmds.push({ id: `workspace-${ws.id}`, label: `Switch to workspace: ${ws.name}`, category: "workspace", shortcut: i < 9 ? shortcutFor(`workspace${i + 1}`) : undefined, onExecute: () => setActiveWorkspaceId(ws.id) });
    });

    // Theme
    cmds.push({ id: "themePicker", label: "Open theme picker", category: "theme", shortcut: shortcutFor("themePicker"), onExecute: () => setThemePickerOpen(true) });

    // Views
    cmds.push({ id: "viewSettings", label: "Open settings", category: "view", onExecute: () => setView("settings") });
    cmds.push({ id: "viewDashboard", label: "Go to sessions", category: "view", onExecute: () => setView("dashboard") });
    cmds.push({ id: "viewJobs", label: "Go to jobs", category: "view", onExecute: () => { fetchJobs(); setView("jobs"); } });
    cmds.push({ id: "viewAgents", label: "Go to agents", category: "view", onExecute: () => { fetchAgents(); setView("agents"); } });

    return cmds;
  })();

  // Find the current task for the move session modal
  const moveSessionTask = modal.type === "moveSession"
    ? findSession(modal.sessionId, sessionsByRepo, sessionsByTask)?.taskId ?? ""
    : "";

  const currentView: View = view;

  const renderQuantiOverlay = () => (
    <div style={{
      position: "fixed",
      bottom: 24,
      right: 60,
      zIndex: 100,
      display: assistantOpen ? "block" : "none",
    }}>
      <QuantAssistant
        convID={quantiConvID}
        model={quantiModel}
        onMinimize={() => setAssistantOpen(false)}
      />
    </div>
  );

  const renderIconStrip = () => {
    const items: { view: string; label: string; onClick: () => void; icon: React.ReactNode }[] = [
      {
        view: "settings", label: "Settings", onClick: () => setView("settings"),
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        ),
      },
      {
        view: "dashboard", label: "Sessions", onClick: () => setView("dashboard"),
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        ),
      },
      {
        view: "jobs", label: "Jobs", onClick: () => { fetchJobs(); setView("jobs"); },
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        ),
      },
      {
        view: "agents", label: "Agents", onClick: () => { fetchAgents(); setView("agents"); },
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
          </svg>
        ),
      },
    ];

    return (
      <div
        style={{
          width: 40,
          backgroundColor: "var(--q-bg)",
          borderLeft: "1px solid var(--q-border)",
          display: "flex",
          flexDirection: "column",
          padding: "8px 0",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          {items.map((item) => (
            <div key={item.view} style={{ position: "relative" }}>
              <button
                onClick={item.onClick}
                style={{
                  width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
                  background: "none", border: "none", cursor: "pointer",
                  color: currentView === item.view ? "var(--q-fg)" : "var(--q-fg-secondary)",
                  borderRight: currentView === item.view ? "2px solid var(--q-accent)" : "2px solid transparent",
                }}
                onMouseEnter={(e) => {
                  if (currentView !== item.view) e.currentTarget.style.color = "var(--q-fg)";
                  const tooltip = e.currentTarget.parentElement?.querySelector("[data-tooltip]") as HTMLElement;
                  if (tooltip) tooltip.style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  if (currentView !== item.view) e.currentTarget.style.color = "var(--q-fg-secondary)";
                  const tooltip = e.currentTarget.parentElement?.querySelector("[data-tooltip]") as HTMLElement;
                  if (tooltip) tooltip.style.opacity = "0";
                }}
              >
                {item.icon}
              </button>
              <span
                data-tooltip
                style={{
                  position: "absolute",
                  right: 44,
                  top: "50%",
                  transform: "translateY(-50%)",
                  backgroundColor: "var(--q-bg-surface)",
                  color: "var(--q-fg)",
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--q-border)",
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                  opacity: 0,
                  transition: "opacity 0.15s ease",
                }}
              >
                {item.label}
              </span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {/* Assistant toggle */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <button
            onClick={() => setAssistantOpen((v) => !v)}
            style={{
              width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
              background: "none", border: "none", cursor: "pointer",
              color: assistantOpen ? "var(--q-fg)" : "var(--q-fg-secondary)",
              borderRight: assistantOpen ? "2px solid var(--q-accent)" : "2px solid transparent",
            }}
            onMouseEnter={(e) => { if (!assistantOpen) e.currentTarget.style.color = "var(--q-fg)"; }}
            onMouseLeave={(e) => { if (!assistantOpen) e.currentTarget.style.color = "var(--q-fg-secondary)"; }}
            title="Quant Assistant"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </div>
        {/* Workspace selector */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
          <button
            onClick={() => { if (!PINNED_WORKSPACE) setWorkspaceDropdownOpen((v) => !v); }}
            style={{
              width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
              background: "none", border: "none", cursor: PINNED_WORKSPACE ? "default" : "pointer",
              color: workspaceDropdownOpen ? "var(--q-fg)" : "var(--q-fg-secondary)",
              borderRight: workspaceDropdownOpen ? "2px solid var(--q-accent)" : "2px solid transparent",
            }}
            onMouseEnter={(e) => { if (!workspaceDropdownOpen) e.currentTarget.style.color = "var(--q-fg)"; }}
            onMouseLeave={(e) => { if (!workspaceDropdownOpen) e.currentTarget.style.color = "var(--q-fg-secondary)"; }}
            title={PINNED_WORKSPACE
              ? `This window is pinned to workspace: ${workspaces.find(w => w.id === activeWorkspaceId)?.name ?? activeWorkspaceId}`
              : `Workspace: ${workspaces.find(w => w.id === activeWorkspaceId)?.name ?? "Default"}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
            </svg>
          </button>
          {workspaceDropdownOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                right: 44,
                bottom: 0,
                backgroundColor: "var(--q-bg-surface)",
                border: "1px solid var(--q-border)",
                borderRadius: 6,
                padding: "4px 0",
                minWidth: 180,
                zIndex: 9999,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              }}
            >
              <div style={{ padding: "4px 12px", color: "var(--q-fg-secondary)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                Workspaces
              </div>
              {workspaces.map((ws) => {
                const isActive = ws.id === activeWorkspaceId;
                const isDeletable = !isActive && ws.id !== "default";
                const isConfirmingDelete = deletingWorkspaceId === ws.id;

                if (isConfirmingDelete) {
                  return (
                    <div key={ws.id} style={{ padding: "6px 12px", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ color: "var(--q-fg)", marginBottom: 6 }}>
                        Delete "{ws.name}"?
                        <br /><span style={{ color: "var(--q-fg-secondary)" }}>All items will be deleted.</span>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await api.deleteWorkspace(ws.id);
                              await fetchWorkspaces();
                              setDeletingWorkspaceId(null);
                            } catch (err) {
                              console.error("failed to delete workspace:", err);
                            }
                          }}
                          style={{
                            padding: "3px 10px", borderRadius: 4, border: "1px solid var(--q-error)",
                            backgroundColor: "var(--q-error)", color: "var(--q-fg)", cursor: "pointer",
                            fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >Delete</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeletingWorkspaceId(null); }}
                          style={{
                            padding: "3px 10px", borderRadius: 4, border: "1px solid var(--q-border-light)",
                            backgroundColor: "transparent", color: "var(--q-fg-secondary)", cursor: "pointer",
                            fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >Cancel</button>
                      </div>
                    </div>
                  );
                }

                if (editingWorkspaceId === ws.id) {
                  const inputStyle = {
                    width: "100%", padding: "4px 8px", marginTop: 4,
                    backgroundColor: "var(--q-bg-elevated)", border: "1px solid var(--q-border-light)", borderRadius: 4,
                    color: "var(--q-fg)", fontSize: 11, outline: "none",
                    fontFamily: "'JetBrains Mono', monospace",
                  } as const;
                  return (
                    <form
                      key={ws.id}
                      onSubmit={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!editWorkspaceForm.name.trim()) return;
                        const v = await api.validateWorkspacePaths(editWorkspaceForm.claudeConfigPath.trim(), editWorkspaceForm.mcpConfigPath.trim());
                        setPathErrors({ claude: v.claudeConfigError || "", mcp: v.mcpConfigError || "" });
                        if (!v.claudeConfigValid || !v.mcpConfigValid) return;
                        try {
                          await api.updateWorkspace({
                            id: ws.id,
                            name: editWorkspaceForm.name.trim(),
                            claudeConfigPath: editWorkspaceForm.claudeConfigPath.trim() || undefined,
                            mcpConfigPath: editWorkspaceForm.mcpConfigPath.trim() || undefined,
                          });
                          await fetchWorkspaces();
                          setEditingWorkspaceId(null);
                          setPathErrors({ claude: "", mcp: "" });
                        } catch (err) {
                          console.error("failed to update workspace:", err);
                        }
                      }}
                      style={{ padding: "6px 12px" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ color: "var(--q-fg-secondary)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Edit workspace</div>
                      <input
                        autoFocus
                        value={editWorkspaceForm.name}
                        onChange={(e) => setEditWorkspaceForm((f) => ({ ...f, name: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Escape") setEditingWorkspaceId(null); }}
                        placeholder="Name"
                        style={{ ...inputStyle, marginTop: 0 }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--q-accent)"; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = "var(--q-border-light)"; }}
                      />
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        <input
                          value={editWorkspaceForm.claudeConfigPath}
                          onChange={(e) => setEditWorkspaceForm((f) => ({ ...f, claudeConfigPath: e.target.value }))}
                          placeholder=".claude root"
                          title="Project root containing .claude/skills/"
                          style={{ ...inputStyle, marginTop: 0, flex: 1 }}
                          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--q-accent)"; }}
                          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--q-border-light)"; }}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const path = await api.browseClaudeConfigDir();
                            if (path) setEditWorkspaceForm((f) => ({ ...f, claudeConfigPath: path }));
                          }}
                          style={{ padding: "4px 8px", backgroundColor: "var(--q-bg-inset)", border: "1px solid var(--q-border-light)", borderRadius: 4, color: "var(--q-fg-secondary)", cursor: "pointer", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--q-fg)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--q-fg-secondary)"; }}
                          title="Browse project root for .claude"
                        >...</button>
                      </div>
                      {pathErrors.claude && <div style={{ color: "var(--q-error)", fontSize: 10, marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>{pathErrors.claude}</div>}
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        <input
                          value={editWorkspaceForm.mcpConfigPath}
                          onChange={(e) => setEditWorkspaceForm((f) => ({ ...f, mcpConfigPath: e.target.value }))}
                          placeholder=".mcp.json root"
                          title="Project root containing .mcp.json"
                          style={{ ...inputStyle, marginTop: 0, flex: 1 }}
                          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--q-accent)"; }}
                          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--q-border-light)"; }}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const path = await api.browseMcpConfigFile();
                            if (path) setEditWorkspaceForm((f) => ({ ...f, mcpConfigPath: path }));
                          }}
                          style={{ padding: "4px 8px", backgroundColor: "var(--q-bg-inset)", border: "1px solid var(--q-border-light)", borderRadius: 4, color: "var(--q-fg-secondary)", cursor: "pointer", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--q-fg)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--q-fg-secondary)"; }}
                          title="Browse project root for .mcp.json"
                        >...</button>
                      </div>
                      {pathErrors.mcp && <div style={{ color: "var(--q-error)", fontSize: 10, marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>{pathErrors.mcp}</div>}
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button
                          type="submit"
                          style={{
                            padding: "3px 10px", borderRadius: 4, border: "1px solid var(--q-accent)",
                            backgroundColor: "var(--q-accent)", color: "var(--q-bg)", cursor: "pointer",
                            fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >Save</button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setEditingWorkspaceId(null); }}
                          style={{
                            padding: "3px 10px", borderRadius: 4, border: "1px solid var(--q-border-light)",
                            backgroundColor: "transparent", color: "var(--q-fg-secondary)", cursor: "pointer",
                            fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >Cancel</button>
                      </div>
                    </form>
                  );
                }

                return (
                  <div
                    key={ws.id}
                    style={{
                      display: "flex", alignItems: "center",
                      background: isActive ? "var(--q-border)" : "none",
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "var(--q-bg-inset)"; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <button
                      onClick={() => {
                        setActiveWorkspaceId(ws.id);
                        setWorkspaceDropdownOpen(false);
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        flex: 1, padding: "6px 12px",
                        background: "none", border: "none", cursor: "pointer",
                        color: isActive ? "var(--q-accent)" : "var(--q-fg)",
                        textAlign: "left", fontSize: 12,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: isActive ? "var(--q-accent)" : "var(--q-border-light)", flexShrink: 0 }} />
                      {ws.name}
                      {isActive && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--q-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "auto" }}>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingWorkspaceId(ws.id);
                        setEditWorkspaceForm({
                          name: ws.name,
                          claudeConfigPath: ws.claudeConfigPath ?? "",
                          mcpConfigPath: ws.mcpConfigPath ?? "",
                        });
                      }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 28, height: 28, flexShrink: 0,
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--q-fg-secondary)",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--q-fg)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--q-fg-secondary)"; }}
                      title={`Settings for ${ws.name}`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                    </button>
                    {IS_PRIMARY_NATIVE && !PINNED_WORKSPACE && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          api.openWorkspaceWindow(ws.id).catch((err) =>
                            console.error("failed to open workspace window:", err)
                          );
                          setWorkspaceDropdownOpen(false);
                        }}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: 28, height: 28, flexShrink: 0,
                          background: "none", border: "none", cursor: "pointer",
                          color: "var(--q-fg-secondary)",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--q-fg)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--q-fg-secondary)"; }}
                        title={`Open "${ws.name}" in a new window`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 3h6v6" /><path d="M10 14L21 3" />
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        </svg>
                      </button>
                    )}
                    {isDeletable && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeletingWorkspaceId(ws.id); }}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: 28, height: 28, flexShrink: 0,
                          background: "none", border: "none", cursor: "pointer",
                          color: "var(--q-fg-secondary)", marginRight: 4,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--q-error)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--q-fg-secondary)"; }}
                        title={`Delete ${ws.name}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
              <div style={{ borderTop: "1px solid var(--q-border)", margin: "4px 0" }} />
              {creatingWorkspace ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!newWorkspaceName.trim()) return;
                    const v = await api.validateWorkspacePaths(newClaudeConfigPath.trim(), newMcpConfigPath.trim());
                    setPathErrors({ claude: v.claudeConfigError || "", mcp: v.mcpConfigError || "" });
                    if (!v.claudeConfigValid || !v.mcpConfigValid) return;
                    try {
                      const ws = await api.createWorkspace({
                        name: newWorkspaceName.trim(),
                        claudeConfigPath: newClaudeConfigPath.trim() || undefined,
                        mcpConfigPath: newMcpConfigPath.trim() || undefined,
                      });
                      await fetchWorkspaces();
                      setActiveWorkspaceId(ws.id);
                      setCreatingWorkspace(false);
                      setNewWorkspaceName("");
                      setNewClaudeConfigPath("");
                      setNewMcpConfigPath("");
                      setPathErrors({ claude: "", mcp: "" });
                      setWorkspaceDropdownOpen(false);
                    } catch (err) {
                      console.error("failed to create workspace:", err);
                    }
                  }}
                  style={{ padding: "4px 8px" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    autoFocus
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { setCreatingWorkspace(false); setNewWorkspaceName(""); setNewClaudeConfigPath(""); setNewMcpConfigPath(""); }
                    }}
                    placeholder="Workspace name..."
                    style={{
                      width: "100%", padding: "4px 8px",
                      backgroundColor: "var(--q-bg-elevated)", border: "1px solid var(--q-border-light)", borderRadius: 4,
                      color: "var(--q-fg)", fontSize: 12, outline: "none",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--q-accent)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--q-border-light)"; }}
                  />
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <input
                      value={newClaudeConfigPath}
                      onChange={(e) => setNewClaudeConfigPath(e.target.value)}
                      placeholder=".claude root (optional)"
                      title="Project root containing .claude/skills/ (e.g. /path/to/project)"
                      style={{
                        flex: 1, padding: "4px 8px",
                        backgroundColor: "var(--q-bg-elevated)", border: "1px solid var(--q-border-light)", borderRadius: 4,
                        color: "var(--q-fg)", fontSize: 11, outline: "none",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--q-accent)"; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--q-border-light)"; }}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const path = await api.browseClaudeConfigDir();
                        if (path) setNewClaudeConfigPath(path);
                      }}
                      style={{ padding: "4px 8px", backgroundColor: "var(--q-bg-inset)", border: "1px solid var(--q-border-light)", borderRadius: 4, color: "var(--q-fg-secondary)", cursor: "pointer", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--q-fg)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--q-fg-secondary)"; }}
                      title="Browse project root for .claude"
                    >...</button>
                  </div>
                  {pathErrors.claude && <div style={{ color: "var(--q-error)", fontSize: 10, marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>{pathErrors.claude}</div>}
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <input
                      value={newMcpConfigPath}
                      onChange={(e) => setNewMcpConfigPath(e.target.value)}
                      placeholder=".mcp.json root (optional)"
                      title="Project root containing .mcp.json (e.g. /path/to/project)"
                      style={{
                        flex: 1, padding: "4px 8px",
                        backgroundColor: "var(--q-bg-elevated)", border: "1px solid var(--q-border-light)", borderRadius: 4,
                        color: "var(--q-fg)", fontSize: 11, outline: "none",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--q-accent)"; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--q-border-light)"; }}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const path = await api.browseMcpConfigFile();
                        if (path) setNewMcpConfigPath(path);
                      }}
                      style={{ padding: "4px 8px", backgroundColor: "var(--q-bg-inset)", border: "1px solid var(--q-border-light)", borderRadius: 4, color: "var(--q-fg-secondary)", cursor: "pointer", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--q-fg)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--q-fg-secondary)"; }}
                      title="Browse project root for .mcp.json"
                    >...</button>
                  </div>
                  {pathErrors.mcp && <div style={{ color: "var(--q-error)", fontSize: 10, marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>{pathErrors.mcp}</div>}
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button
                      type="submit"
                      style={{
                        padding: "3px 10px", borderRadius: 4, border: "1px solid var(--q-accent)",
                        backgroundColor: "var(--q-accent)", color: "var(--q-bg)", cursor: "pointer",
                        fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >Save</button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCreatingWorkspace(false); setNewWorkspaceName(""); setNewClaudeConfigPath(""); setNewMcpConfigPath(""); }}
                      style={{
                        padding: "3px 10px", borderRadius: 4, border: "1px solid var(--q-border-light)",
                        backgroundColor: "transparent", color: "var(--q-fg-secondary)", cursor: "pointer",
                        fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >Cancel</button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreatingWorkspace(true);
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", padding: "6px 12px",
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--q-fg-secondary)", textAlign: "left", fontSize: 12,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--q-fg)"; e.currentTarget.style.backgroundColor = "var(--q-bg-inset)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--q-fg-secondary)"; e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  New workspace
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderModals = () => (
    <>
      {modal.type === "createJob" && (
        <CreateJobModal
          jobs={filteredJobs}
          agents={filteredAgents}
          onSubmit={async (req) => {
            try {
              const jobReq = req as CreateJobRequest;
              jobReq.workspaceId = activeWorkspaceId;
              await api.createJob(jobReq);
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
          jobs={filteredJobs}
          agents={filteredAgents}
          editJob={modal.job}
          onSubmit={async (req) => {
            try {
              const jobReq = req as UpdateJobRequest;
              jobReq.workspaceId = modal.job.workspaceId;
              await api.updateJob(jobReq);
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
          workspaceId={activeWorkspaceId}
          onSubmit={async (req) => {
            const agentReq = req as CreateAgentRequest;
            agentReq.workspaceId = activeWorkspaceId;
            await api.createAgent(agentReq);
            setModal({ type: "none" });
            fetchAgents();
          }}
          onCancel={() => setModal({ type: "none" })}
        />
      )}
      {modal.type === "editAgent" && (
        <CreateAgentModal
          agent={modal.agent}
          workspaceId={modal.agent.workspaceId}
          onSubmit={async (req) => {
            const agentReq = req as UpdateAgentRequest;
            agentReq.workspaceId = modal.agent.workspaceId;
            await api.updateAgent(agentReq);
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

  // Settings and diff wrap QuantAssistant so it stays mounted across all views
  if (view === "settings") {
    return (
      <>
        {renderQuantiOverlay()}
        <Settings repos={repos} onBack={() => { fetchShortcuts(); setView("dashboard"); }} />
        {commandPaletteOpen && <CommandPalette commands={paletteCommands} onClose={() => setCommandPaletteOpen(false)} />}
        {themePickerOpen && <ThemeQuickPicker onClose={() => setThemePickerOpen(false)} />}
      </>
    );
  }

  if (view === "diff" && diffSession) {
    return (
      <>
        {renderQuantiOverlay()}
        <DiffView
          sessionId={diffSession.id}
          sessionName={diffSession.name}
          commitMessagePrefix={commitMessagePrefix}
          onBack={() => setView("dashboard")}
        />
        {commandPaletteOpen && <CommandPalette commands={paletteCommands} onClose={() => setCommandPaletteOpen(false)} />}
        {themePickerOpen && <ThemeQuickPicker onClose={() => setThemePickerOpen(false)} />}
      </>
    );
  }

  // Jobs and agents are rendered as overlays so the dashboard stays mounted
  // (sessions/terminals keep running in the background)
  return (
    <>
      {renderQuantiOverlay()}

      {view === "jobs" && (
        <div className="flex h-screen w-screen" style={{ backgroundColor: "var(--q-bg)", position: "absolute", top: 0, left: 0, zIndex: 20 }}>
          <JobsView
            jobs={filteredJobs}
            agents={filteredAgents}
            jobGroups={jobGroups}
            activeWorkspaceId={activeWorkspaceId}
            onCreateJob={() => setModal({ type: "createJob" })}
            onEditJob={(job) => setModal({ type: "editJob", job })}
            onRefreshJobs={fetchJobs}
            onRefreshJobGroups={fetchJobGroups}
          />
          {renderIconStrip()}
        </div>
      )}

      {view === "agents" && (
        <div className="flex h-screen w-screen" style={{ backgroundColor: "var(--q-bg)", position: "absolute", top: 0, left: 0, zIndex: 20 }}>
          <AgentsView
            agents={filteredAgents}
            onCreateAgent={() => setModal({ type: "createAgent" })}
            onEditAgent={(agent: Agent) => setModal({ type: "editAgent", agent })}
            onDeleteAgent={async (id: string) => {
              await api.deleteAgent(id);
              fetchAgents();
            }}
            onRefreshAgents={fetchAgents}
          />
          {renderIconStrip()}
        </div>
      )}

    <div className="flex h-screen w-screen" style={{ backgroundColor: "var(--q-bg)" }}>
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
        onReopenRepo={handleReopenRecentRepo}
        workspaceId={activeWorkspaceId}
        onCreateTask={(repoId) => setModal({ type: "newTask", repoId })}
        onCreateSession={(repoId, taskId) =>
          setModal({ type: "newSession", repoId, taskId })
        }
        onRemoveRepo={handleRemoveRepo}
        onDeleteTask={handleDeleteTask}
        onDeleteSession={handleDelete}
        onStopSession={handleStop}
        onArchiveSession={handleArchiveSession}
        onUnarchiveSession={handleUnarchiveSession}
        onArchiveTask={handleArchiveTask}
        onUnarchiveTask={handleUnarchiveTask}
        onMoveSession={handleMoveSession}
        onDoubleClickSession={handleDoubleClickSession}
        onRenameTask={handleRenameTask}
        onRenameSession={handleRenameSession}
        onDropSession={(sessionId, targetTaskId) => handleMoveSessionSelect(sessionId, targetTaskId)}
        boardsBySession={boardsBySession}
        activeBoardBySession={activeBoardBySession}
        onSelectBoard={handleSelectBoard}
        onMoveBoard={handleMoveBoard}
        onRenameBoard={handleRenameBoard}
        onError={(msg) => setError(msg)}
        onOpenSettings={() => setView("settings")}
        onOpenJobs={() => { fetchJobs(); setView("jobs"); }}
        currentView={view}
        shortcuts={shortcuts}
        onGitCommit={openGitCommitModal}
        onGitPull={openGitPullModal}
        onGitPush={openGitPushModal}
        appVersion={appVersion}
        onShowChangelog={() => setModal({ type: "changelog" })}
      />

      <main className="flex-1 flex flex-col relative" style={{ backgroundColor: "var(--q-bg)" }}>
        {error && (
          <div
            className="absolute top-0 left-0 right-0 z-40 text-xs px-4 py-2 flex justify-between"
            style={{
              backgroundColor: "var(--q-error-bg)",
              color: "var(--q-error)",
              borderBottom: "1px solid var(--q-border)",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <span>// error: {error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-2 transition-colors"
              style={{ color: "var(--q-error)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-error)")}
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

        {/* Session area + persistent voice dock, side by side. The voice dock is
            mounted HERE (App scope) — NOT inside SessionPanel — so it survives
            active-tab switches: the SessionPanel below remounts/swaps with the
            active tab, but the VoiceDock stays mounted, keyed by voiceSessionId,
            and only remounts when voice is closed or moved to another session. */}
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            {activeSession ? (
              <SessionPanel
                session={activeSession}
                task={activeTask}
                onStart={handleStart}
                onResume={handleResume}
                onRestart={handleRestart}
                onUnarchive={handleUnarchiveSession}
                displayStatus={getDisplayStatus(activeSession.id, activeSession.status)}
                embeddedTerminalSession={activeEmbeddedTerminalSession}
                terminalPaneOpen={activeTerminalPaneOpen}
                onTerminalPaneOpenChange={handleTerminalPaneOpenChange}
                mindmapPaneOpen={activeMindmapPaneOpen}
                onMindmapPaneOpenChange={handleMindmapPaneOpenChange}
                voicePaneOpen={voiceSessionId === activeSession.id}
                onVoicePaneOpenChange={handleVoicePaneOpenChange}
                onCreateEmbeddedTerminal={handleCreateEmbeddedTerminal}
              />
            ) : (
              <EmptyState />
            )}
          </div>

          {voiceSessionId && (
            <VoiceDock
              // Keyed by the attached session so it remounts ONLY when voice is
              // closed (key changes to null → unmounts) or moved (key changes to
              // the new session → remounts onto it). A plain active-tab switch
              // leaves voiceSessionId untouched, so this stays mounted + alive.
              key={voiceSessionId}
              sessionId={voiceSessionId}
              sessionName={voiceSession?.name ?? voiceSessionId}
              isActiveTab={voiceSessionId === activeTabId}
              onClose={detachVoice}
            />
          )}
        </div>
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

      {modal.type === "changelog" && (
        <ChangelogModal
          entries={changelogEntries}
          currentVersion={appVersion}
          onClose={() => setModal({ type: "none" })}
        />
      )}

      {/* Modals rendered once at the top level with high z-index so they appear above all views */}
      <div style={{ position: "fixed", zIndex: 50 }}>
        {renderModals()}
      </div>

      {/* Command Palette */}
      {commandPaletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}

      {/* Theme Quick Picker */}
      {themePickerOpen && (
        <ThemeQuickPicker onClose={() => setThemePickerOpen(false)} />
      )}

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: assistantOpen ? 608 : 20,
            right: 20,
            zIndex: 9999,
            transition: "bottom 0.2s ease",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              onClick={() => {
                if (toast.sessionId) {
                  handleOpenTab(toast.sessionId);
                  setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                }
              }}
              style={{
                backgroundColor: "var(--q-bg-hover)",
                border: "1px solid var(--q-accent)",
                color: "var(--q-fg)",
                fontSize: 12,
                padding: "10px 16px",
                borderRadius: 4,
                maxWidth: 320,
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                cursor: toast.sessionId ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span style={{ flex: 1 }}>
                <span style={{ color: "var(--q-accent)", marginRight: 8 }}>~</span>
                {toast.message}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                }}
                style={{
                  cursor: "pointer",
                  color: "var(--q-fg-muted)",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: "0 2px",
                  flexShrink: 0,
                }}
              >
                ×
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  );
}

// VoiceDock is the persistent, App-scoped wrapper around VoicePane. It is mounted
// once at App level (keyed by voiceSessionId) so it survives active-tab switches —
// unlike the per-active-tab SessionPanel. The header names the session voice is
// pinned to and makes it visually obvious when that session is NOT the active tab
// (the case that previously produced a silently-dead pane). Closing detaches voice.
function VoiceDock({
  sessionId,
  sessionName,
  isActiveTab,
  onClose,
}: {
  sessionId: string;
  sessionName: string;
  isActiveTab: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="flex flex-col min-h-0 shrink-0"
      style={{
        width: 340,
        borderLeft: "1px solid var(--q-border)",
        backgroundColor: "var(--q-bg)",
      }}
    >
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{
          height: 24,
          backgroundColor: "var(--q-bg-input)",
          borderBottom: "1px solid var(--q-border)",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div className="flex items-center gap-1.5 overflow-hidden">
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: "var(--q-term-green)",
              flexShrink: 0,
            }}
          />
          <span
            className="overflow-hidden whitespace-nowrap"
            style={{ fontSize: 10, color: "var(--q-fg-secondary)", textOverflow: "ellipsis" }}
            title={`voice attached to session "${sessionName}"`}
          >
            voice · {sessionName}
          </span>
          {/* Make it visually clear voice is pinned to a session that is NOT the
              currently-active tab (so the user isn't confused by a pane whose
              transcript/agent belongs to a different session than they're viewing). */}
          {!isActiveTab && (
            <span
              className="shrink-0"
              style={{
                fontSize: 8.5,
                color: "var(--q-warning)",
                border: "1px solid var(--q-warning)",
                borderRadius: 3,
                padding: "0 3px",
                lineHeight: "13px",
              }}
              title="voice is pinned to this session, which is not the active tab"
            >
              background
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-[9px] transition-colors shrink-0"
          style={{ color: "var(--q-fg-muted)", fontFamily: "'JetBrains Mono', monospace" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-muted)")}
          title="close voice"
        >
          [x]
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <VoicePane sessionId={sessionId} />
      </div>
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
