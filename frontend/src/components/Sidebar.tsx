import React, { useState, useCallback, useEffect, useRef } from "react";
import type { Repo, Task, Session, Action, Shortcut } from "../types";
import { StatusDot } from "./StatusDot";
import type { DisplayStatus } from "./StatusBadge";
import { ActionLog } from "./ActionLog";
import { ContextMenu } from "./ContextMenu";
import type { MenuItem } from "./ContextMenu";
import { RecentReposDropdown } from "./RecentReposDropdown";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { IconButton } from "./IconButton";
import { Segmented } from "./Segmented";
import { Pill } from "./Pill";
import { CountBadge } from "./CountBadge";
import { useMenu } from "./MenuHost";
import type { HostMenuItem } from "./MenuHost";
import * as api from "../api";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 290;
const SIDEBAR_COLLAPSED_WIDTH = 48;

const STATUS_LABEL: Record<string, string> = {
  running: "running",
  waiting: "waiting",
  paused: "paused",
  idle: "idle",
  blocked: "blocked",
  starting: "starting",
  stopping: "stopping",
  resuming: "resuming",
  done: "done",
  error: "error",
  archived: "archived",
};

interface SidebarProps {
  repos: Repo[];
  tasksByRepo: Record<string, Task[]>;
  sessionsByRepo: Record<string, Session[]>;
  sessionsByTask: Record<string, Session[]>;
  actionsBySession: Record<string, Action[]>;
  getDisplayStatus: (sessionId: string, baseStatus: Session["status"]) => import("./StatusBadge").DisplayStatus;
  openTabIds: string[];
  activeSessionId: string | null;
  expandedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onExpandSession: (id: string | null) => void;
  onOpenTab: (id: string) => void;
  onOpenRepo: () => void;
  onReopenRepo: (repo: Repo) => void;
  workspaceId: string;
  onCreateTask: (repoId: string) => void;
  onCreateSession: (repoId: string, taskId?: string) => void;
  onRemoveRepo: (repoId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onStopSession?: (sessionId: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onUnarchiveSession: (sessionId: string) => void;
  onArchiveTask: (taskId: string) => void;
  onUnarchiveTask: (taskId: string) => void;
  onRenameTask?: (taskId: string, currentTag: string, currentName: string) => void;
  onRenameSession?: (sessionId: string, currentName: string) => void;
  onChangeClaudeSession?: (sessionId: string) => void;
  onMoveSession?: (sessionId: string, repoId: string) => void;
  onDoubleClickSession?: (id: string) => void;
  onDropSession?: (sessionId: string, targetTaskId: string) => void;
  boardsBySession?: Record<string, string[]>;
  activeBoardBySession?: Record<string, string>;
  onSelectBoard?: (sessionId: string, board: string) => void;
  onMoveBoard?: (board: string, fromSessionId: string, toSessionId: string) => void;
  onRenameBoard?: (sessionId: string, oldName: string, newName: string) => void;
  /* ---- crew badges (all keyed by session id, fed from App's single
     assignments + QueuedCounts state) ---- */
  supervisorByWorker?: Record<string, { id: string; name: string }>;
  workerCountBySupervisor?: Record<string, number>;
  queuedBySupervisor?: Record<string, number>;
  /** dropping a crew worker row (dataTransfer "crewsource") on the sidebar
   *  root unassigns it */
  onUnassignWorker?: (workerSessionId: string) => void;
  onError?: (msg: string) => void;
  onOpenSettings?: () => void;
  onOpenJobs?: () => void;
  currentView?: string;
  shortcuts: Shortcut[];
  onGitCommit: (sessionId: string, sessionName: string) => void;
  onGitPull: (sessionId: string) => void;
  onGitPush: (sessionId: string) => void;
  appVersion?: string;
  onShowChangelog?: () => void;
  workspaceSwitcher?: React.ReactNode;
}

function SidebarScrollArea({ children }: { children: React.ReactNode }) {
  const navRef = useRef<HTMLElement>(null);
  const [thumb, setThumb] = useState({ height: 0, top: 0, show: false });

  const updateThumb = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const ratio = el.clientHeight / el.scrollHeight;
    setThumb({
      show: ratio < 1,
      height: Math.max(ratio * el.clientHeight, 24),
      top: (el.scrollTop / el.scrollHeight) * el.clientHeight,
    });
  }, []);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateThumb);
    ro.observe(el);
    updateThumb();
    return () => ro.disconnect();
  }, [updateThumb]);

  return (
    <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
      {/* nav is 20px wider than container — native scrollbar clips off-screen */}
      <nav
        ref={navRef}
        onScroll={updateThumb}
        style={{ height: "100%", overflowY: "scroll", width: "calc(100% + 20px)", paddingRight: "20px", paddingBottom: 14 }}
      >
        {children}
      </nav>
      {/* custom scrollbar thumb */}
      {thumb.show && (
        <>
          <div style={{ position: "absolute", right: 0, top: 0, width: 4, height: "100%", backgroundColor: "var(--bg)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", right: 0, top: thumb.top, width: 4, height: thumb.height, backgroundColor: "var(--fg-4)", borderRadius: 2, pointerEvents: "none" }} />
        </>
      )}
    </div>
  );
}

/* ---------- inline rename field ---------- */
function RenameInput({
  initial,
  mono = true,
  onCommit,
  onCancel,
}: {
  initial: string;
  mono?: boolean;
  onCommit: (to: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);
  return (
    <input
      ref={ref}
      value={v}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const t = v.trim();
          if (t) onCommit(t);
          else onCancel();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        const t = v.trim();
        if (t && t !== initial) onCommit(t);
        else onCancel();
      }}
      className={mono ? "mono" : ""}
      style={{
        flex: 1,
        minWidth: 0,
        height: 20,
        padding: "0 6px",
        borderRadius: 5,
        outline: "none",
        background: "var(--panel-3)",
        border: "1px solid var(--accent)",
        color: "var(--fg)",
        fontFamily: mono ? "var(--mono)" : "var(--sans)",
        fontSize: 12,
      }}
    />
  );
}

/* ---------- generic tree row ---------- */
function TreeRow({
  depth = 0,
  children,
  active,
  py,
  draggable,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  style,
}: {
  depth?: number;
  children: React.ReactNode;
  active?: boolean;
  py?: string;
  draggable?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
  style?: React.CSSProperties;
}) {
  const [h, setH] = useState(false);
  return (
    <div
      draggable={draggable}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: `${py || "var(--row-py)"} 10px ${py || "var(--row-py)"} ${10 + depth * 15}px`,
        margin: "0 8px",
        borderRadius: 8,
        cursor: "pointer",
        minWidth: 0,
        background: active ? "var(--accent-soft)" : h ? "var(--hover)" : "transparent",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Twisty({ open = true }: { open?: boolean }) {
  return <Icon name={open ? "chevronDown" : "chevronRight"} size={12} color="var(--fg-4)" style={{ flex: "none" }} />;
}

/* ---------- ghost add row ---------- */
function AddRow({ children, onClick }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void }) {
  const [h, setH] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 6px",
        borderRadius: 6,
        fontSize: 11,
        color: h ? "var(--fg-2)" : "var(--fg-4)",
        cursor: "pointer",
        background: h ? "var(--hover)" : "transparent",
      }}
    >
      <Icon name="plus" size={11} /> {children}
    </div>
  );
}

export function Sidebar({
  repos,
  tasksByRepo,
  sessionsByRepo,
  sessionsByTask,
  actionsBySession,
  getDisplayStatus,
  openTabIds,
  activeSessionId,
  expandedSessionId,
  onSelectSession,
  onExpandSession,
  onOpenTab,
  onOpenRepo,
  onReopenRepo,
  workspaceId,
  onCreateTask,
  onCreateSession,
  onRemoveRepo,
  onDeleteTask,
  onDeleteSession,
  onStopSession,
  onArchiveSession,
  onUnarchiveSession,
  onArchiveTask,
  onUnarchiveTask,
  onRenameTask,
  onRenameSession,
  onChangeClaudeSession,
  onMoveSession,
  onDoubleClickSession,
  onDropSession,
  boardsBySession,
  activeBoardBySession,
  onSelectBoard,
  onMoveBoard,
  onRenameBoard,
  supervisorByWorker,
  workerCountBySupervisor,
  queuedBySupervisor,
  onUnassignWorker,
  onError,
  onOpenSettings,
  onOpenJobs,
  currentView,
  shortcuts,
  onGitCommit,
  onGitPull,
  onGitPush,
  appVersion,
  onShowChangelog,
  workspaceSwitcher,
}: SidebarProps) {
  const openMenu = useMenu();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);

  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [recentReposAnchor, setRecentReposAnchor] = useState<DOMRect | null>(null);
  // id of the row currently being inline-renamed (only repo/task/session that
  // don't already own a modal-based rename handler use this).
  const [editing, setEditing] = useState<string | null>(null);
  const isResizing = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // anchor the dropdown to the clicked "+" button, not the whole sidebar
  // (anchoring to the full-height <aside> pushed the panel off-screen).
  const handleOpenRepoButtonClick = useCallback((e: React.MouseEvent) => {
    setRecentReposAnchor(e.currentTarget.getBoundingClientRect());
  }, []);

  const handleReopenRecent = useCallback(
    (repo: Repo) => {
      setRecentReposAnchor(null);
      onReopenRepo(repo);
    },
    [onReopenRepo],
  );

  const handleOpenNewPathFromDropdown = useCallback(() => {
    setRecentReposAnchor(null);
    onOpenRepo();
  }, [onOpenRepo]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isResizing.current) return;
      const newWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, e.clientX));
      setSidebarWidth(newWidth);
    }
    function handleMouseUp() {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  /* ---------- crew: sidebar-root drop = unassign ---------- */
  // A crew worker row dragged out of a crew pane carries the "crewsource"
  // type. Dropping it on the sidebar's blank space unassigns it; drops on a
  // task row still move the session (that inner handler runs first and marks
  // the event defaultPrevented, so we skip the unassign here).
  function handleRootDragOver(e: React.DragEvent) {
    if (!onUnassignWorker) return;
    if (!e.dataTransfer.types.includes("crewsource")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleRootDrop(e: React.DragEvent) {
    if (!onUnassignWorker) return;
    if (e.defaultPrevented) return; // an inner drop target already handled it
    if (!e.dataTransfer.types.includes("crewsource")) return;
    e.preventDefault();
    const sessionId = e.dataTransfer.getData("sessionId");
    if (sessionId) onUnassignWorker(sessionId);
  }

  /* ---------- context menus (Icon-based, design spec) ---------- */
  function openRepoContextMenu(e: React.MouseEvent, repo: Repo) {
    const items: HostMenuItem[] = [
      { header: "// repo" },
      { label: "+ task", icon: "hash", tone: "accent", onClick: () => onCreateTask(repo.id) },
      { label: "+ session", icon: "terminal", tone: "accent", onClick: () => onCreateSession(repo.id) },
      { sep: true },
      { label: "open in terminal", icon: "terminal", onClick: () => api.openInTerminal(repo.path) },
      { label: "open in finder", icon: "folderOpen", onClick: () => api.openInFinder(repo.path) },
      { sep: true },
      { label: "rename", icon: "edit", onClick: () => setEditing("r:" + repo.id) },
      { label: "remove", icon: "trash", tone: "danger", onClick: () => onRemoveRepo(repo.id) },
    ];
    openMenu(e, items);
  }

  function openTaskContextMenu(e: React.MouseEvent, task: Task) {
    const isArchived = !!task.archivedAt;
    const items: HostMenuItem[] = [{ header: "// task" }];
    if (!isArchived) {
      items.push({ label: "+ session", icon: "terminal", tone: "accent", onClick: () => onCreateSession(task.repoId, task.id) });
      items.push({ sep: true });
      items.push({ label: "rename", icon: "edit", onClick: () => onRenameTask?.(task.id, task.tag, task.name) });
      items.push({ sep: true });
      items.push({ label: "archive", icon: "archive", tone: "warn", onClick: () => onArchiveTask(task.id) });
      items.push({ label: "delete", icon: "trash", tone: "danger", onClick: () => onDeleteTask(task.id) });
    } else {
      items.push({ label: "unarchive", icon: "unarchive", tone: "accent", onClick: () => onUnarchiveTask(task.id) });
      items.push({ sep: true });
      items.push({ label: "delete", icon: "trash", tone: "danger", onClick: () => onDeleteTask(task.id) });
    }
    openMenu(e, items);
  }

  function openSessionContextMenu(e: React.MouseEvent, session: Session) {
    const displaySt = getDisplayStatus(session.id, session.status);
    const isArchived = !!session.archivedAt;
    const items: HostMenuItem[] = [{ header: `// session [${STATUS_LABEL[displaySt] || displaySt}]` }];

    if (!isArchived) {
      // Stop (terminate) the running session — the menu equivalent of the
      // Meta+Shift+W shortcut, which a browser intercepts and never delivers.
      if (displaySt === "running" && onStopSession) {
        items.push({ label: "stop session", icon: "stop", tone: "danger", onClick: () => onStopSession(session.id) });
        items.push({ sep: true });
      }
      items.push({
        label: "open in system terminal",
        icon: "terminal",
        onClick: () => {
          const path = session.worktreePath || session.directory;
          if (path) api.openInTerminal(path);
        },
      });
      items.push({
        label: "open in finder",
        icon: "folderOpen",
        onClick: () => {
          const path = session.worktreePath || session.directory;
          if (path) api.openInFinder(path);
        },
      });
      items.push({ sep: true });
      items.push({ label: "rename", icon: "edit", onClick: () => onRenameSession?.(session.id, session.name) });

      // Re-point a stopped claude session at a different claude conversation.
      if (session.sessionType === "claude" && displaySt !== "running" && onChangeClaudeSession) {
        items.push({ label: "change claude session id", icon: "refresh", onClick: () => onChangeClaudeSession(session.id) });
      }

      // Only show "move to task" if there are >= 2 tasks in the repo
      const repoTasks = tasksByRepo[session.repoId] ?? [];
      if (repoTasks.length >= 2 && onMoveSession) {
        items.push({ label: "move to task", icon: "merge", onClick: () => onMoveSession(session.id, session.repoId) });
      }

      items.push({ sep: true });
      items.push({ header: "// git" });
      items.push({ label: "git commit", icon: "branch", onClick: () => onGitCommit(session.id, session.name) });
      items.push({ label: "git pull", icon: "arrowDown", onClick: () => onGitPull(session.id) });
      items.push({ label: "git push", icon: "arrowUp", onClick: () => onGitPush(session.id) });

      if (shortcuts.length > 0) {
        items.push({ sep: true });
        items.push({ header: "// shortcuts" });
        for (const sc of shortcuts) {
          items.push({ label: sc.name, icon: "terminal", tone: "accent", onClick: () => api.runShortcut(session.id, sc.command).catch(console.error) });
        }
      }

      items.push({ sep: true });
      items.push({ header: "// danger" });
      items.push({ label: "archive", icon: "archive", tone: "warn", onClick: () => onArchiveSession(session.id) });
      items.push({ label: "delete", icon: "trash", tone: "danger", onClick: () => onDeleteSession(session.id) });
    } else {
      items.push({ label: "unarchive", icon: "unarchive", tone: "accent", onClick: () => onUnarchiveSession(session.id) });
      items.push({ sep: true });
      items.push({ label: "delete", icon: "trash", tone: "danger", onClick: () => onDeleteSession(session.id) });
    }

    openMenu(e, items);
  }

  // Filter sessions based on archive state; terminal sessions are never shown in the sidebar
  function filterSessions(sessions: Session[]): Session[] {
    return sessions.filter((s) => s.sessionType !== "terminal" && (showArchived ? !!s.archivedAt : !s.archivedAt));
  }

  // Filter tasks: in active view, show non-archived tasks.
  // In archived view, show archived tasks OR tasks that have archived sessions.
  function filterTasks(tasks: Task[]): Task[] {
    return tasks.filter((t) => {
      if (!showArchived) return !t.archivedAt;
      if (t.archivedAt) return true;
      const taskSessions = sessionsByTask[t.id] ?? [];
      return taskSessions.some((s) => !!s.archivedAt);
    });
  }

  // Collapsed sidebar view
  if (collapsed) {
    return (
      <div className="flex h-full">
        <aside
          className="panel flex flex-col h-full shrink-0"
          style={{ width: SIDEBAR_COLLAPSED_WIDTH }}
        >
          {/* header: logo + expand toggle */}
          <div
            className="flex flex-col items-center justify-center gap-1"
            style={{ borderBottom: "1px solid var(--border-2)", height: 64 }}
          >
            <span style={{ color: "var(--accent)", fontFamily: "var(--mono)", fontSize: 18, fontWeight: 700 }}>{">"}</span>
            <IconButton name="panelRight" label="expand sidebar" onClick={() => setCollapsed(false)} />
          </div>

          {/* repo icons */}
          <div className="flex-1 flex flex-col items-center gap-1 py-2 overflow-y-auto">
            {repos.map((repo) => (
              <button
                key={repo.id}
                onClick={() => setCollapsed(false)}
                onContextMenu={(e) => openRepoContextMenu(e, repo)}
                className="flex items-center justify-center shrink-0"
                style={{ width: 32, height: 32, borderRadius: 8, color: "var(--fg-3)", background: "transparent", border: "none", cursor: "pointer" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--hover)";
                  e.currentTarget.style.color = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "var(--fg-3)";
                }}
                title={repo.name}
              >
                <Icon name="folder" size={16} />
              </button>
            ))}
            <div style={{ width: 24, height: 1, backgroundColor: "var(--border-2)", marginTop: 4, marginBottom: 4 }} />
            <IconButton name="plus" label="add repo" onClick={handleOpenRepoButtonClick} />
          </div>

          {/* bottom bar */}
          <div className="flex flex-col items-center justify-center gap-1.5 py-2" style={{ borderTop: "1px solid var(--border-2)" }}>
            <IconButton
              name="plus"
              label="new session"
              tone="var(--accent)"
              active
              onClick={() => {
                if (repos.length > 0) onCreateSession(repos[0].id);
              }}
            />
            {appVersion && (
              <button
                onClick={onShowChangelog}
                style={{ color: "var(--fg-4)", fontFamily: "var(--mono)", fontSize: 8, background: "transparent", border: "none", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--fg-4)")}
                title="changelog"
              >
                {appVersion}
              </button>
            )}
          </div>
        </aside>

        {contextMenu && (
          <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />
        )}

        {recentReposAnchor && (
          <RecentReposDropdown
            workspaceId={workspaceId}
            anchorRect={recentReposAnchor}
            onSelect={handleReopenRecent}
            onOpenNewPath={handleOpenNewPathFromDropdown}
            onClose={() => setRecentReposAnchor(null)}
          />
        )}
      </div>
    );
  }

  // Expanded sidebar view
  return (
    <div className="flex h-full">
      <aside
        ref={sidebarRef}
        className="panel flex flex-col h-full shrink-0"
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
        style={{
          width: sidebarWidth,
          minWidth: SIDEBAR_MIN_WIDTH,
          maxWidth: SIDEBAR_MAX_WIDTH,
        }}
      >
        {/* header */}
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 8px 0 10px",
            height: 46,
            borderBottom: "1px solid var(--border-2)",
          }}
        >
          {workspaceSwitcher ?? (
            <span
              className="mono"
              style={{ flex: 1, fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}
            >
              <span style={{ color: "var(--accent)" }}>{">"}</span> <span style={{ color: "var(--fg)" }}>quant</span>
            </span>
          )}
          <IconButton name="plus" label="New repo" onClick={handleOpenRepoButtonClick} />
          <IconButton name="panelRight" label="collapse sidebar" onClick={() => setCollapsed(true)} />
        </div>

        {/* active / archived */}
        <div style={{ flex: "none", padding: "12px 12px 10px" }}>
          <Segmented<"active" | "archived">
            value={showArchived ? "archived" : "active"}
            onChange={(v) => setShowArchived(v === "archived")}
            options={[
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ]}
          />
        </div>

        {/* tree nav with custom scrollbar */}
        <SidebarScrollArea>
          {showArchived ? (
            <ArchivedList
              repos={repos}
              tasksByRepo={tasksByRepo}
              sessionsByTask={sessionsByTask}
              onUnarchiveTask={onUnarchiveTask}
              onUnarchiveSession={onUnarchiveSession}
            />
          ) : (
            <>
          {repos.map((repo) => (
            <RepoNode
              key={repo.id}
              repo={repo}
              tasks={filterTasks(tasksByRepo[repo.id] ?? [])}
              sessionsByTask={sessionsByTask}
              actionsBySession={actionsBySession}
              getDisplayStatus={getDisplayStatus}
              openTabIds={openTabIds}
              activeSessionId={activeSessionId}
              expandedSessionId={expandedSessionId}
              onSelectSession={onSelectSession}
              onExpandSession={onExpandSession}
              onOpenTab={onOpenTab}
              onCreateTask={onCreateTask}
              onCreateSession={onCreateSession}
              onRepoContextMenu={openRepoContextMenu}
              onTaskContextMenu={openTaskContextMenu}
              onSessionContextMenu={openSessionContextMenu}
              onDoubleClickSession={onDoubleClickSession}
              onDropSession={onDropSession}
              boardsBySession={boardsBySession}
              activeBoardBySession={activeBoardBySession}
              onSelectBoard={onSelectBoard}
              onMoveBoard={onMoveBoard}
              onRenameBoard={onRenameBoard}
              supervisorByWorker={supervisorByWorker}
              workerCountBySupervisor={workerCountBySupervisor}
              queuedBySupervisor={queuedBySupervisor}
              onError={onError}
              filterSessions={filterSessions}
              showArchived={showArchived}
              editing={editing}
              setEditing={setEditing}
              onRemoveRepo={onRemoveRepo}
            />
          ))}
          <div style={{ padding: "2px 8px", margin: "4px 8px 0" }}>
            <AddRow onClick={handleOpenRepoButtonClick}>repo</AddRow>
          </div>
            </>
          )}
        </SidebarScrollArea>

        {/* bottom bar */}
        <div className="flex flex-col gap-0" style={{ borderTop: "1px solid var(--border-2)" }}>
          <div className="flex items-center gap-2 p-3 pb-1.5">
            <button
              onClick={() => {
                if (repos.length > 0) onCreateSession(repos[0].id);
              }}
              className="flex-1 flex items-center justify-center gap-2"
              style={{
                padding: "8px 12px",
                borderRadius: 9,
                background: "var(--accent)",
                color: "var(--on-accent)",
                fontFamily: "var(--sans)",
                fontSize: 12.5,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}
            >
              <Icon name="plus" size={14} /> new session
            </button>
          </div>
          {appVersion && (
            <div className="flex items-center justify-center pb-2">
              <button
                onClick={onShowChangelog}
                style={{ color: "var(--fg-4)", fontFamily: "var(--mono)", fontSize: 9, background: "transparent", border: "none", cursor: "pointer", padding: "2px 6px" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--fg-4)")}
                title="view changelog"
              >
                {appVersion}
              </button>
            </div>
          )}
        </div>

        {contextMenu && (
          <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />
        )}

        {recentReposAnchor && (
          <RecentReposDropdown
            workspaceId={workspaceId}
            anchorRect={recentReposAnchor}
            onSelect={handleReopenRecent}
            onOpenNewPath={handleOpenNewPathFromDropdown}
            onClose={() => setRecentReposAnchor(null)}
          />
        )}
      </aside>

      {/* resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="flex items-center justify-center shrink-0"
        style={{ width: 6, cursor: "col-resize", backgroundColor: "transparent" }}
        onMouseEnter={(e) => {
          const grip = e.currentTarget.querySelector<HTMLElement>("[data-grip]");
          if (grip) grip.style.backgroundColor = "var(--fg-3)";
        }}
        onMouseLeave={(e) => {
          const grip = e.currentTarget.querySelector<HTMLElement>("[data-grip]");
          if (grip) grip.style.backgroundColor = "var(--fg-4)";
        }}
      >
        <div
          data-grip
          style={{ width: 2, height: 32, borderRadius: 1, backgroundColor: "var(--fg-4)", transition: "background-color 150ms" }}
        />
      </div>
    </div>
  );
}

interface ArchItem {
  kind: "task" | "session";
  id: string;
  icon: IconName;
  label: string;
  sub: string;
  onRestore: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

function ArchRow({ icon, label, sub, onRestore, onContextMenu }: ArchItem) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onContextMenu={onContextMenu}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 12px",
        margin: "0 8px",
        borderRadius: 8,
        background: hover ? "var(--hover)" : "transparent",
        cursor: "default",
        opacity: 0.92,
      }}
    >
      <Icon name={icon} size={13} color="var(--fg-4)" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, color: "var(--fg-2)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</div>
        <div className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{sub}</div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onRestore(); }}
        title="Restore"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          borderRadius: 6,
          cursor: "pointer",
          border: "1px solid var(--border)",
          background: "transparent",
          color: "var(--fg-3)",
          fontFamily: "var(--sans)",
          fontSize: 11,
          opacity: hover ? 1 : 0.55,
        }}
      >
        <Icon name="archive" size={12} /> restore
      </button>
    </div>
  );
}

function ArchivedList({
  repos,
  tasksByRepo,
  sessionsByTask,
  onUnarchiveTask,
  onUnarchiveSession,
}: {
  repos: Repo[];
  tasksByRepo: Record<string, Task[]>;
  sessionsByTask: Record<string, Session[]>;
  onUnarchiveTask: (taskId: string) => void;
  onUnarchiveSession: (sessionId: string) => void;
}) {
  const items: ArchItem[] = [];
  for (const repo of repos) {
    const tasks = tasksByRepo[repo.id] ?? [];
    for (const task of tasks) {
      if (task.archivedAt) {
        const labelTag = task.name ? `${task.tag} ${task.name}` : task.tag;
        items.push({
          kind: "task",
          id: `t:${task.id}`,
          icon: "hash",
          label: labelTag,
          sub: repo.name,
          onRestore: () => onUnarchiveTask(task.id),
        });
      }
      const sessions = sessionsByTask[task.id] ?? [];
      for (const session of sessions) {
        if (session.archivedAt && session.sessionType !== "terminal") {
          items.push({
            kind: "session",
            id: `s:${session.id}`,
            icon: "terminal",
            label: session.name,
            sub: `${repo.name} · ${task.tag}`,
            onRestore: () => onUnarchiveSession(session.id),
          });
        }
      }
    }
  }

  if (items.length === 0) {
    return (
      <div
        className="mono"
        style={{ padding: "26px 18px", fontSize: 11.5, color: "var(--fg-4)", textAlign: "center", lineHeight: 1.6 }}
      >
        no archived items.<br />archive a session or task to stash it here.
      </div>
    );
  }

  return (
    <div style={{ padding: "4px 0" }}>
      {items.map((it) => (
        <ArchRow key={it.id} {...it} />
      ))}
    </div>
  );
}

function RepoNode({
  repo,
  tasks,
  sessionsByTask,
  actionsBySession,
  getDisplayStatus,
  openTabIds,
  activeSessionId,
  expandedSessionId,
  onSelectSession,
  onExpandSession,
  onOpenTab,
  onCreateTask,
  onCreateSession,
  onRepoContextMenu,
  onTaskContextMenu,
  onSessionContextMenu,
  onDoubleClickSession,
  onDropSession,
  boardsBySession,
  activeBoardBySession,
  onSelectBoard,
  onMoveBoard,
  onRenameBoard,
  supervisorByWorker,
  workerCountBySupervisor,
  queuedBySupervisor,
  onError,
  filterSessions,
  showArchived,
  editing,
  setEditing,
  onRemoveRepo,
}: {
  repo: Repo;
  tasks: Task[];
  sessionsByTask: Record<string, Session[]>;
  actionsBySession: Record<string, Action[]>;
  getDisplayStatus: (sessionId: string, baseStatus: Session["status"]) => import("./StatusBadge").DisplayStatus;
  openTabIds: string[];
  activeSessionId: string | null;
  expandedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onExpandSession: (id: string | null) => void;
  onOpenTab: (id: string) => void;
  onCreateTask: (repoId: string) => void;
  onCreateSession: (repoId: string, taskId?: string) => void;
  onRepoContextMenu: (e: React.MouseEvent, repo: Repo) => void;
  onTaskContextMenu: (e: React.MouseEvent, task: Task) => void;
  onSessionContextMenu: (e: React.MouseEvent, session: Session) => void;
  onDoubleClickSession?: (id: string) => void;
  onDropSession?: (sessionId: string, targetTaskId: string) => void;
  boardsBySession?: Record<string, string[]>;
  activeBoardBySession?: Record<string, string>;
  onSelectBoard?: (sessionId: string, board: string) => void;
  onMoveBoard?: (board: string, fromSessionId: string, toSessionId: string) => void;
  onRenameBoard?: (sessionId: string, oldName: string, newName: string) => void;
  supervisorByWorker?: Record<string, { id: string; name: string }>;
  workerCountBySupervisor?: Record<string, number>;
  queuedBySupervisor?: Record<string, number>;
  onError?: (msg: string) => void;
  filterSessions: (sessions: Session[]) => Session[];
  showArchived: boolean;
  editing: string | null;
  setEditing: (id: string | null) => void;
  onRemoveRepo: (repoId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const id = "r:" + repo.id;

  return (
    <div style={{ marginBottom: 4 }}>
      {/* repo header */}
      <TreeRow onClick={() => setExpanded(!expanded)} onContextMenu={(e) => onRepoContextMenu(e, repo)}>
        <Twisty open={expanded} />
        <Icon name="folder" size={14} color="var(--fg-3)" />
        {editing === id ? (
          <RenameInput
            initial={repo.name}
            mono={false}
            onCommit={() => {
              // No repo-rename handler is wired in props; close the editor.
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--fg)", letterSpacing: "-0.01em", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            {repo.name}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span
          className="mono"
          style={{ fontSize: 9.5, color: "var(--fg-4)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: 96 }}
        >
          {repo.path}
        </span>
      </TreeRow>

      {expanded && (
        <div>
          {tasks.map((task) => (
            <TaskNode
              key={task.id}
              task={task}
              sessions={filterSessions(sessionsByTask[task.id] ?? [])}
              actionsBySession={actionsBySession}
              getDisplayStatus={getDisplayStatus}
              openTabIds={openTabIds}
              activeSessionId={activeSessionId}
              expandedSessionId={expandedSessionId}
              onSelectSession={onSelectSession}
              onExpandSession={onExpandSession}
              onOpenTab={onOpenTab}
              onCreateSession={onCreateSession}
              onTaskContextMenu={onTaskContextMenu}
              onSessionContextMenu={onSessionContextMenu}
              onDoubleClickSession={onDoubleClickSession}
              onDropSession={onDropSession}
              boardsBySession={boardsBySession}
              activeBoardBySession={activeBoardBySession}
              onSelectBoard={onSelectBoard}
              onMoveBoard={onMoveBoard}
              onRenameBoard={onRenameBoard}
              supervisorByWorker={supervisorByWorker}
              workerCountBySupervisor={workerCountBySupervisor}
              queuedBySupervisor={queuedBySupervisor}
              onError={onError}
              repoId={repo.id}
              showArchived={showArchived}
            />
          ))}

          {!showArchived && (
            <div style={{ paddingLeft: 35, margin: "1px 8px 2px" }}>
              <AddRow onClick={() => onCreateTask(repo.id)}>task</AddRow>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskNode({
  task,
  sessions,
  actionsBySession,
  getDisplayStatus,
  openTabIds,
  activeSessionId,
  expandedSessionId,
  onSelectSession,
  onExpandSession,
  onOpenTab,
  onCreateSession,
  onTaskContextMenu,
  onSessionContextMenu,
  onDoubleClickSession,
  onDropSession,
  boardsBySession,
  activeBoardBySession,
  onSelectBoard,
  onMoveBoard,
  onRenameBoard,
  supervisorByWorker,
  workerCountBySupervisor,
  queuedBySupervisor,
  onError,
  repoId,
  showArchived,
}: {
  task: Task;
  sessions: Session[];
  actionsBySession: Record<string, Action[]>;
  getDisplayStatus: (sessionId: string, baseStatus: Session["status"]) => import("./StatusBadge").DisplayStatus;
  openTabIds: string[];
  activeSessionId: string | null;
  expandedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onExpandSession: (id: string | null) => void;
  onOpenTab: (id: string) => void;
  onCreateSession: (repoId: string, taskId?: string) => void;
  onTaskContextMenu: (e: React.MouseEvent, task: Task) => void;
  onSessionContextMenu: (e: React.MouseEvent, session: Session) => void;
  onDoubleClickSession?: (id: string) => void;
  onDropSession?: (sessionId: string, targetTaskId: string) => void;
  boardsBySession?: Record<string, string[]>;
  activeBoardBySession?: Record<string, string>;
  onSelectBoard?: (sessionId: string, board: string) => void;
  onMoveBoard?: (board: string, fromSessionId: string, toSessionId: string) => void;
  onRenameBoard?: (sessionId: string, oldName: string, newName: string) => void;
  supervisorByWorker?: Record<string, { id: string; name: string }>;
  workerCountBySupervisor?: Record<string, number>;
  queuedBySupervisor?: Record<string, number>;
  onError?: (msg: string) => void;
  repoId: string;
  showArchived: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);

  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("sessionid")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const sessionId = e.dataTransfer.getData("sessionId");
    const sourceRepoId = e.dataTransfer.getData("repoId");
    const sourceTaskId = e.dataTransfer.getData("taskId");
    if (!sessionId) return;

    if (sourceRepoId !== repoId) {
      if (onError) onError("cannot move sessions across repos");
      return;
    }
    if (sourceTaskId === task.id) return; // same task, no-op

    if (onDropSession) onDropSession(sessionId, task.id);
  }

  const isArchived = !!task.archivedAt;

  return (
    <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <TreeRow
        depth={1}
        py="4px"
        onClick={() => setExpanded(!expanded)}
        onContextMenu={(e) => onTaskContextMenu(e, task)}
        style={{
          background: isDragOver ? "var(--hover)" : undefined,
          borderLeft: isDragOver ? "2px solid var(--accent)" : "2px solid transparent",
          opacity: isArchived ? 0.6 : 1,
        }}
      >
        <Twisty open={expanded} />
        <Icon name="hash" size={12} color="var(--accent)" />
        <span
          className="mono"
          style={{ flex: 1, fontSize: 11.5, color: "var(--fg-2)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}
        >
          {task.tag}
          {task.name ? <span style={{ color: "var(--fg-4)" }}> {task.name}</span> : null}
        </span>
      </TreeRow>

      {expanded && (
        <div>
          {[...sessions]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((session) => (
              <SessionNode
                key={session.id}
                session={session}
                actions={actionsBySession[session.id] ?? []}
                displayStatus={getDisplayStatus(session.id, session.status)}
                isTabOpen={openTabIds.includes(session.id)}
                activeSessionId={activeSessionId}
                expandedSessionId={expandedSessionId}
                onSelectSession={onSelectSession}
                onExpandSession={onExpandSession}
                onOpenTab={onOpenTab}
                onSessionContextMenu={onSessionContextMenu}
                onDoubleClickSession={onDoubleClickSession}
                boards={boardsBySession?.[session.id] ?? []}
                activeBoard={activeBoardBySession?.[session.id]}
                onSelectBoard={onSelectBoard}
                onMoveBoard={onMoveBoard}
                onRenameBoard={onRenameBoard}
                supervisor={supervisorByWorker?.[session.id]}
                workerCount={workerCountBySupervisor?.[session.id] ?? 0}
                queuedCount={queuedBySupervisor?.[session.id] ?? 0}
                depth={2}
              />
            ))}
          {!showArchived && (
            <div style={{ paddingLeft: 50, margin: "0 8px 2px" }}>
              <AddRow onClick={() => onCreateSession(task.repoId, task.id)}>session</AddRow>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionNode({
  session,
  actions,
  displayStatus,
  isTabOpen,
  activeSessionId,
  expandedSessionId,
  onSelectSession,
  onExpandSession,
  onOpenTab,
  onSessionContextMenu,
  onDoubleClickSession,
  boards,
  activeBoard,
  onSelectBoard,
  onMoveBoard,
  onRenameBoard,
  supervisor,
  workerCount,
  queuedCount,
  depth,
}: {
  session: Session;
  actions: Action[];
  displayStatus: import("./StatusBadge").DisplayStatus;
  isTabOpen: boolean;
  activeSessionId: string | null;
  expandedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onExpandSession: (id: string | null) => void;
  onOpenTab: (id: string) => void;
  onSessionContextMenu: (e: React.MouseEvent, session: Session) => void;
  onDoubleClickSession?: (id: string) => void;
  boards: string[];
  activeBoard?: string;
  onSelectBoard?: (sessionId: string, board: string) => void;
  onMoveBoard?: (board: string, fromSessionId: string, toSessionId: string) => void;
  onRenameBoard?: (sessionId: string, oldName: string, newName: string) => void;
  /** this session's supervisor (set when it is a crew worker) */
  supervisor?: { id: string; name: string };
  /** workers under this session (set when it is a crew supervisor) */
  workerCount?: number;
  /** queued (undelivered) crew reports addressed to this session */
  queuedCount?: number;
  depth: number;
}) {
  const isActive = activeSessionId === session.id;
  const isExpanded = expandedSessionId === session.id;
  const hasWorktree = !!session.worktreePath;
  const isArchived = !!session.archivedAt;
  const [isBoardDragOver, setIsBoardDragOver] = useState(false);

  function handleBoardDragOver(e: React.DragEvent) {
    if (isArchived || session.sessionType === "terminal") return;
    if (!e.dataTransfer.types.includes("boardname")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setIsBoardDragOver(true);
  }

  function handleBoardDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsBoardDragOver(false);
  }

  function handleBoardDrop(e: React.DragEvent) {
    if (isArchived || session.sessionType === "terminal") return;
    if (!e.dataTransfer.types.includes("boardname")) return;
    e.preventDefault();
    e.stopPropagation();
    setIsBoardDragOver(false);
    const boardName = e.dataTransfer.getData("boardName");
    const boardSessionId = e.dataTransfer.getData("boardSessionId");
    if (!boardName || !boardSessionId) return;
    if (boardSessionId === session.id) return; // same session, no-op
    if (onMoveBoard) onMoveBoard(boardName, boardSessionId, session.id);
  }

  function handleClick() {
    onSelectSession(session.id);
    onExpandSession(isExpanded ? null : session.id);

    if (isArchived) {
      onOpenTab(session.id);
      return;
    }

    if (isTabOpen) {
      onOpenTab(session.id);
      return;
    }

    const isRunningOrWaiting =
      displayStatus === "running" ||
      displayStatus === "waiting" ||
      displayStatus === "starting" ||
      displayStatus === "resuming";

    if (isRunningOrWaiting) {
      onOpenTab(session.id);
    }
  }

  // Double click: always open tab. If idle, also triggers start. If paused, triggers resume.
  function handleDoubleClick() {
    if (isArchived) return; // Archived sessions are opened via single click
    onOpenTab(session.id);
    if (onDoubleClickSession) {
      onDoubleClickSession(session.id);
    }
  }

  function handleDragStart(e: React.DragEvent) {
    if (isArchived) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("sessionId", session.id);
    e.dataTransfer.setData("repoId", session.repoId);
    e.dataTransfer.setData("taskId", session.taskId);
    e.dataTransfer.effectAllowed = "move";
  }

  const hot = isActive;
  const statusPill = sessionStatusPill(displayStatus);

  return (
    <div onDragOver={handleBoardDragOver} onDragLeave={handleBoardDragLeave} onDrop={handleBoardDrop}>
      <TreeRow
        depth={depth}
        active={hot || isBoardDragOver}
        draggable={!isArchived}
        onDragStart={handleDragStart}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => onSessionContextMenu(e, session)}
        style={{
          opacity: isArchived ? 0.6 : displayStatus === "paused" ? 0.55 : 1,
          borderLeft: isBoardDragOver ? "2px solid var(--accent)" : "2px solid transparent",
        }}
      >
        <StatusDot status={displayStatus} size={8} glow={hot} />
        <span
          style={{
            flex: 1,
            fontSize: 12.5,
            fontWeight: hot ? 600 : 500,
            letterSpacing: "-0.01em",
            color: hot ? "var(--fg)" : "var(--fg-2)",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {session.name}
        </span>
        {(workerCount ?? 0) > 0 && (
          <Pill tone="accent" soft>
            crew {workerCount}
          </Pill>
        )}
        {(queuedCount ?? 0) > 0 && <CountBadge n={queuedCount} />}
        {supervisor && <Pill soft>↳ {supervisor.name}</Pill>}
        {hasWorktree && <Pill tone="muted">wt</Pill>}
        {session.sessionType === "terminal" ? (
          <Pill tone="accent" soft style={{ color: "var(--purple)" }}>
            sh
          </Pill>
        ) : statusPill ? (
          <Pill tone={statusPill.tone}>{statusPill.label}</Pill>
        ) : null}
      </TreeRow>

      {isExpanded && actions.length > 0 && <ActionLog actions={actions} maxVisible={8} />}

      {isExpanded && boards.length > 0 && (
        <div>
          {[...boards]
            .sort((a, b) => a.localeCompare(b))
            .map((board) => (
              <BoardNode
                key={board}
                board={board}
                sessionId={session.id}
                activeBoard={activeBoard}
                depth={depth + 1}
                onSelectBoard={onSelectBoard}
                onRenameBoard={onRenameBoard}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function sessionStatusPill(status: DisplayStatus): { tone: "muted" | "accent" | "info" | "warn" | "danger"; label: string } | null {
  if (status === "idle" || status === "archived") return null;
  if (status === "waiting") return { tone: "info", label: STATUS_LABEL.waiting };
  if (status === "paused" || status === "stopping") return { tone: "warn", label: STATUS_LABEL[status] };
  if (status === "error") return { tone: "danger", label: STATUS_LABEL.error };
  return { tone: "accent", label: STATUS_LABEL[status] || status };
}

function BoardNode({
  board,
  sessionId,
  activeBoard,
  depth,
  onSelectBoard,
  onRenameBoard,
}: {
  board: string;
  sessionId: string;
  activeBoard?: string;
  depth: number;
  onSelectBoard?: (sessionId: string, board: string) => void;
  onRenameBoard?: (sessionId: string, oldName: string, newName: string) => void;
}) {
  const effectiveActiveBoard =
    activeBoard ?? localStorage.getItem("quant.mindmapBoard." + sessionId) ?? "default";
  const isActive = effectiveActiveBoard === board;

  const openMenu = useMenu();
  const [renaming, setRenaming] = useState(false);

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData("boardName", board);
    e.dataTransfer.setData("boardSessionId", sessionId);
    e.dataTransfer.effectAllowed = "move";
  }

  function startRename() {
    setRenaming(true);
  }

  function commitRename(next: string) {
    setRenaming(false);
    if (!next || next === board) return;
    if (onRenameBoard) onRenameBoard(sessionId, board, next);
  }

  if (renaming) {
    return (
      <TreeRow depth={depth} py="3px">
        <Icon name="waypoints" size={12} color="var(--accent)" />
        <RenameInput initial={board} onCommit={commitRename} onCancel={() => setRenaming(false)} />
      </TreeRow>
    );
  }

  return (
    <>
      <TreeRow
        depth={depth}
        py="3px"
        active={isActive}
        draggable
        onDragStart={handleDragStart}
        onClick={() => onSelectBoard && onSelectBoard(sessionId, board)}
        onContextMenu={(e) => {
          const items: HostMenuItem[] = [
            { header: "// board" },
            { label: "rename", icon: "edit", onClick: startRename },
          ];
          openMenu(e, items);
        }}
      >
        <Icon name="waypoints" size={12} color={isActive ? "var(--accent)" : "var(--fg-4)"} />
        <span
          style={{
            flex: 1,
            fontSize: 11.5,
            color: isActive ? "var(--fg)" : "var(--fg-3)",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {board}
        </span>
      </TreeRow>
    </>
  );
}
