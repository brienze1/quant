import React, { useState, useCallback, useEffect, useRef } from "react";
import type { Repo, Task, Session, Action, Shortcut } from "../types";
import { StatusDot } from "./StatusDot";
import { StatusBadge } from "./StatusBadge";
import { ActionLog } from "./ActionLog";
import { ContextMenu } from "./ContextMenu";
import type { MenuItem } from "./ContextMenu";
import * as api from "../api";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 288;
const SIDEBAR_COLLAPSED_WIDTH = 48;

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
  onCreateTask: (repoId: string) => void;
  onCreateSession: (repoId: string, taskId?: string) => void;
  onRemoveRepo: (repoId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onUnarchiveSession: (sessionId: string) => void;
  onArchiveTask: (taskId: string) => void;
  onUnarchiveTask: (taskId: string) => void;
  onRenameTask?: (taskId: string, currentTag: string, currentName: string) => void;
  onRenameSession?: (sessionId: string, currentName: string) => void;
  onMoveSession?: (sessionId: string, repoId: string) => void;
  onDoubleClickSession?: (id: string) => void;
  onDropSession?: (sessionId: string, targetTaskId: string) => void;
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
        className="py-1"
        style={{ height: "100%", overflowY: "scroll", width: "calc(100% + 20px)", paddingRight: "20px" }}
      >
        {children}
      </nav>
      {/* custom scrollbar: black track + white thumb */}
      {thumb.show && (
        <>
          <div style={{ position: "absolute", right: 0, top: 0, width: 4, height: "100%", backgroundColor: "var(--q-bg)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", right: 0, top: thumb.top, width: 4, height: thumb.height, backgroundColor: "var(--q-scrollbar-thumb)", borderRadius: 2, pointerEvents: "none" }} />
        </>
      )}
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
  onCreateTask,
  onCreateSession,
  onRemoveRepo,
  onDeleteTask,
  onDeleteSession,
  onArchiveSession,
  onUnarchiveSession,
  onArchiveTask,
  onUnarchiveTask,
  onRenameTask,
  onRenameSession,
  onMoveSession,
  onDoubleClickSession,
  onDropSession,
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
}: SidebarProps) {

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);

  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const isResizing = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

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

  function openRepoContextMenu(e: React.MouseEvent, repo: Repo) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { type: "label", text: "// repo" },
        {
          type: "item",
          icon: "#",
          iconColor: "var(--q-accent)",
          label: "+ task",
          onClick: () => onCreateTask(repo.id),
        },
        {
          type: "item",
          icon: ">",
          iconColor: "var(--q-accent)",
          label: "+ session",
          onClick: () => onCreateSession(repo.id),
        },
        { type: "separator" },
        {
          type: "item",
          icon: "$",
          iconColor: "var(--q-fg-secondary)",
          label: "open in terminal",
          onClick: () => api.openInTerminal(repo.path),
        },
        {
          type: "item",
          icon: "$",
          iconColor: "var(--q-fg-secondary)",
          label: "open in finder",
          onClick: () => api.openInFinder(repo.path),
        },
        { type: "separator" },
        {
          type: "item",
          icon: "$",
          iconColor: "var(--q-fg-secondary)",
          label: "rename",
          onClick: () => console.log("TODO: rename repo", repo.id),
        },
        {
          type: "item",
          icon: "x",
          iconColor: "var(--q-error)",
          label: "remove",
          labelColor: "var(--q-error)",
          onClick: () => onRemoveRepo(repo.id),
        },
      ],
    });
  }

  function openTaskContextMenu(e: React.MouseEvent, task: Task) {
    e.preventDefault();
    e.stopPropagation();

    const isArchived = !!task.archivedAt;

    const items: MenuItem[] = [
      { type: "label", text: "// task" },
    ];

    if (!isArchived) {
      items.push({
        type: "item",
        icon: ">",
        iconColor: "var(--q-accent)",
        label: "+ session",
        onClick: () => onCreateSession(task.repoId, task.id),
      });
      items.push({ type: "separator" });
      items.push({
        type: "item",
        icon: "$",
        iconColor: "var(--q-fg-secondary)",
        label: "rename",
        onClick: () => onRenameTask?.(task.id, task.tag, task.name),
      });
      items.push({ type: "separator" });
      items.push({
        type: "item",
        icon: "~",
        iconColor: "var(--q-warning)",
        label: "archive",
        labelColor: "var(--q-warning)",
        onClick: () => onArchiveTask(task.id),
      });
      items.push({
        type: "item",
        icon: "x",
        iconColor: "var(--q-error)",
        label: "delete",
        labelColor: "var(--q-error)",
        onClick: () => onDeleteTask(task.id),
      });
    } else {
      items.push({
        type: "item",
        icon: "~",
        iconColor: "var(--q-accent)",
        label: "unarchive",
        labelColor: "var(--q-accent)",
        onClick: () => onUnarchiveTask(task.id),
      });
      items.push({ type: "separator" });
      items.push({
        type: "item",
        icon: "x",
        iconColor: "var(--q-error)",
        label: "delete",
        labelColor: "var(--q-error)",
        onClick: () => onDeleteTask(task.id),
      });
    }

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }

  function openSessionContextMenu(e: React.MouseEvent, session: Session) {
    e.preventDefault();
    e.stopPropagation();

    const displaySt = getDisplayStatus(session.id, session.status);
    const isArchived = !!session.archivedAt;

    const items: MenuItem[] = [
      { type: "label", text: `// session [${displaySt}]` },
    ];

    if (!isArchived) {
      items.push({
        type: "item",
        icon: "$",
        iconColor: "var(--q-fg-secondary)",
        label: "open in system terminal",
        onClick: () => {
          const path = session.worktreePath || session.directory;
          if (path) api.openInTerminal(path);
        },
      });
      items.push({
        type: "item",
        icon: "$",
        iconColor: "var(--q-fg-secondary)",
        label: "open in finder",
        onClick: () => {
          const path = session.worktreePath || session.directory;
          if (path) api.openInFinder(path);
        },
      });
      items.push({ type: "separator" });
      items.push({
        type: "item",
        icon: "$",
        iconColor: "var(--q-fg-secondary)",
        label: "rename",
        onClick: () => onRenameSession?.(session.id, session.name),
      });

      // Only show "move to task" if there are >= 2 tasks in the repo
      const repoTasks = tasksByRepo[session.repoId] ?? [];
      if (repoTasks.length >= 2 && onMoveSession) {
        items.push({
          type: "item",
          icon: "$",
          iconColor: "var(--q-fg-secondary)",
          label: "move to task",
          onClick: () => onMoveSession(session.id, session.repoId),
        });
      }

      items.push({ type: "separator" });
      items.push({ type: "label", text: "// git" });
      items.push({
        type: "item",
        icon: "$",
        iconColor: "var(--q-fg-secondary)",
        label: "git commit",
        onClick: () => onGitCommit(session.id, session.name),
      });
      items.push({
        type: "item",
        icon: "$",
        iconColor: "var(--q-fg-secondary)",
        label: "git pull",
        onClick: () => onGitPull(session.id),
      });
      items.push({
        type: "item",
        icon: "$",
        iconColor: "var(--q-fg-secondary)",
        label: "git push",
        onClick: () => onGitPush(session.id),
      });

      if (shortcuts.length > 0) {
        items.push({ type: "separator" });
        items.push({ type: "label", text: "// shortcuts" });
        for (const sc of shortcuts) {
          items.push({
            type: "item",
            icon: ">",
            iconColor: "var(--q-accent)",
            label: sc.name,
            onClick: () => api.runShortcut(session.id, sc.command).catch(console.error),
          });
        }
      }

      items.push({ type: "separator" });
      items.push({ type: "label", text: "// danger" });
      items.push({
        type: "item",
        icon: "~",
        iconColor: "var(--q-warning)",
        label: "archive",
        labelColor: "var(--q-warning)",
        onClick: () => onArchiveSession(session.id),
      });
      items.push({
        type: "item",
        icon: "x",
        iconColor: "var(--q-error)",
        label: "delete",
        labelColor: "var(--q-error)",
        onClick: () => onDeleteSession(session.id),
      });
    } else {
      items.push({
        type: "item",
        icon: "~",
        iconColor: "var(--q-accent)",
        label: "unarchive",
        labelColor: "var(--q-accent)",
        onClick: () => onUnarchiveSession(session.id),
      });
      items.push({ type: "separator" });
      items.push({
        type: "item",
        icon: "x",
        iconColor: "var(--q-error)",
        label: "delete",
        labelColor: "var(--q-error)",
        onClick: () => onDeleteSession(session.id),
      });
    }

    setContextMenu({ x: e.clientX, y: e.clientY, items });
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
      // In archived view: show if task is archived, or if it has any archived sessions
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
          className="flex flex-col h-full shrink-0"
          style={{
            width: SIDEBAR_COLLAPSED_WIDTH,
            backgroundColor: "var(--q-bg)",
            borderRight: "1px solid var(--q-border)",
          }}
        >
          {/* header: logo + expand toggle */}
          <div
            className="flex flex-col items-center justify-center gap-1 py-2"
            style={{ borderBottom: "1px solid var(--q-border)", height: 64 }}
          >
            <span
              style={{ color: "var(--q-accent)", fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 700 }}
            >
              {">"}
            </span>
            <button
              onClick={() => setCollapsed(false)}
              className="flex items-center justify-center transition-colors"
              style={{ color: "var(--q-fg-secondary)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-secondary)")}
              title="expand sidebar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
                <path d="m14 9 3 3-3 3" />
              </svg>
            </button>
          </div>

          {/* repo icons */}
          <div className="flex-1 flex flex-col items-center gap-1 py-2 overflow-y-auto">
            {repos.map((repo) => (
              <button
                key={repo.id}
                onClick={() => { setCollapsed(false); }}
                onContextMenu={(e) => openRepoContextMenu(e, repo)}
                className="flex items-center justify-center shrink-0 transition-colors"
                style={{
                  width: 32, height: 32, borderRadius: 4,
                  color: "var(--q-fg-secondary)",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 14, fontWeight: 700,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--q-bg-hover)"; e.currentTarget.style.color = "var(--q-accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--q-fg-secondary)"; }}
                title={repo.name}
              >
                /
              </button>
            ))}
            <div style={{ width: 24, height: 1, backgroundColor: "var(--q-border)", marginTop: 4, marginBottom: 4 }} />
            <button
              onClick={onOpenRepo}
              className="flex items-center justify-center shrink-0 transition-colors"
              style={{
                width: 32, height: 32, borderRadius: 4,
                color: "var(--q-fg-muted)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 14,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--q-accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--q-fg-muted)"; }}
              title="add repo"
            >
              +
            </button>
          </div>

          {/* bottom bar */}
          <div
            className="flex flex-col items-center justify-center gap-1.5 py-2"
            style={{ borderTop: "1px solid var(--q-border)" }}
          >
            <button
              onClick={() => {
                if (repos.length > 0) onCreateSession(repos[0].id);
              }}
              className="flex items-center justify-center transition-colors"
              style={{ color: "var(--q-accent)", fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-accent-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-accent)")}
              title="new session"
            >
              +
            </button>
            {appVersion && (
              <button
                onClick={onShowChangelog}
                className="transition-colors"
                style={{
                  color: "var(--q-fg-muted)",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 8,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-accent)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-muted)")}
                title="changelog"
              >
                {appVersion}
              </button>
            )}
          </div>
        </aside>

        {/* context menu overlay */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
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
        className="flex flex-col h-full shrink-0"
        style={{
          width: sidebarWidth,
          minWidth: SIDEBAR_MIN_WIDTH,
          maxWidth: SIDEBAR_MAX_WIDTH,
          backgroundColor: "var(--q-bg)",
          borderRight: "1px solid var(--q-border)",
        }}
      >
        {/* header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--q-border)" }}
        >
          <h1
            className="text-sm font-bold lowercase"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <span style={{ color: "var(--q-accent)" }}>{">"}</span>{" "}
            <span style={{ color: "var(--q-fg)" }}>quant</span>
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenRepo}
              className="text-xs lowercase transition-colors"
              style={{ color: "var(--q-fg-secondary)", fontFamily: "'JetBrains Mono', monospace" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-secondary)")}
            >
              + repo
            </button>
            <button
              onClick={() => setCollapsed(true)}
              className="flex items-center justify-center transition-colors"
              style={{ color: "var(--q-fg-secondary)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-secondary)")}
              title="collapse sidebar"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
                <path d="m16 15-3-3 3-3" />
              </svg>
            </button>
          </div>
        </div>

        {/* archive toggle */}
        <div
          className="flex"
          style={{ borderBottom: "1px solid var(--q-border)" }}
        >
          <button
            onClick={() => setShowArchived(false)}
            className="flex-1 flex items-center justify-center py-2 text-[10px] lowercase transition-colors"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: showArchived ? "normal" : 500,
              color: showArchived ? "var(--q-fg-secondary)" : "var(--q-accent)",
              borderBottom: showArchived ? "2px solid transparent" : "2px solid var(--q-accent)",
            }}
          >
            active
          </button>
          <button
            onClick={() => setShowArchived(true)}
            className="flex-1 flex items-center justify-center py-2 text-[10px] lowercase transition-colors"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: showArchived ? 500 : "normal",
              color: showArchived ? "var(--q-accent)" : "var(--q-fg-secondary)",
              borderBottom: showArchived ? "2px solid var(--q-accent)" : "2px solid transparent",
            }}
          >
            archived
          </button>
        </div>

        {/* tree nav with custom scrollbar */}
        <SidebarScrollArea>
          {repos.map((repo, idx) => (
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
              onError={onError}
              showSeparator={idx < repos.length - 1}
              filterSessions={filterSessions}
              showArchived={showArchived}
            />
          ))}
        </SidebarScrollArea>

        {/* bottom bar */}
        <div className="flex flex-col gap-0" style={{ borderTop: "1px solid var(--q-border)" }}>
          <div className="flex items-center gap-2 p-3 pb-1.5">
            <button
              onClick={() => {
                if (repos.length > 0) {
                  onCreateSession(repos[0].id);
                }
              }}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm lowercase transition-colors"
              style={{
                backgroundColor: "var(--q-accent)",
                color: "var(--q-bg)",
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 500,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--q-accent-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--q-accent)")}
            >
              $ new_session
            </button>
          </div>
          {appVersion && (
            <div className="flex items-center justify-center pb-2">
              <button
                onClick={onShowChangelog}
                className="text-[9px] lowercase transition-colors px-1.5 py-0.5"
                style={{
                  color: "var(--q-fg-muted)",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-accent)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-muted)")}
                title="view changelog"
              >
                {appVersion}
              </button>
            </div>
          )}
        </div>

        {/* context menu overlay */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        )}
      </aside>

      {/* resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="flex items-center justify-center shrink-0"
        style={{
          width: 6,
          cursor: "col-resize",
          backgroundColor: "transparent",
        }}
        onMouseEnter={(e) => {
          const grip = e.currentTarget.querySelector<HTMLElement>("[data-grip]");
          if (grip) grip.style.backgroundColor = "var(--q-fg-secondary)";
        }}
        onMouseLeave={(e) => {
          const grip = e.currentTarget.querySelector<HTMLElement>("[data-grip]");
          if (grip) grip.style.backgroundColor = "var(--q-fg-muted)";
        }}
      >
        <div
          data-grip
          style={{
            width: 2,
            height: 32,
            borderRadius: 1,
            backgroundColor: "var(--q-fg-muted)",
            transition: "background-color 150ms",
          }}
        />
      </div>
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
  onError,
  showSeparator,
  filterSessions,
  showArchived,
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
  onError?: (msg: string) => void;
  showSeparator: boolean;
  filterSessions: (sessions: Session[]) => Session[];
  showArchived: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      {/* repo header */}
      <button
        onClick={() => setExpanded(!expanded)}
        onContextMenu={(e) => onRepoContextMenu(e, repo)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-xs transition-colors"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--q-bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
      >
        <span className="text-[10px] w-3 shrink-0" style={{ color: "var(--q-fg-muted)" }}>
          {expanded ? "v" : ">"}
        </span>
        <span className="shrink-0 font-bold" style={{ color: "var(--q-fg-secondary)" }}>
          /
        </span>
        <span
          className="font-bold overflow-hidden whitespace-nowrap flex-1"
          style={{ color: "var(--q-fg)" }}
        >
          {repo.name}
        </span>
        <span
          className="text-[9px] overflow-hidden whitespace-nowrap shrink-0 max-w-[100px]"
          style={{
            color: "var(--q-fg-muted)",
            textOverflow: "ellipsis",
          }}
        >
          {repo.path}
        </span>
      </button>

      {expanded && (
        <div>
          {/* tasks */}
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
              onError={onError}
              repoId={repo.id}
              showArchived={showArchived}
            />
          ))}

          {/* add task */}
          {!showArchived && (
            <button
              onClick={() => onCreateTask(repo.id)}
              className="w-full flex items-center gap-1.5 py-1 text-[10px] transition-colors"
              style={{
                paddingLeft: "36px",
                color: "var(--q-fg-muted)",
                fontFamily: "'JetBrains Mono', monospace",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-accent)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-muted)")}
            >
              + task
            </button>
          )}
        </div>
      )}

      {showSeparator && (
        <div className="mx-3 my-1" style={{ borderBottom: "1px solid var(--q-border)" }} />
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
  onError?: (msg: string) => void;
  repoId: string;
  showArchived: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  }

  function handleDragLeave() {
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
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        onContextMenu={(e) => onTaskContextMenu(e, task)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs transition-colors"
        style={{
          paddingLeft: "28px",
          fontFamily: "'JetBrains Mono', monospace",
          backgroundColor: isDragOver ? "var(--q-bg-hover)" : undefined,
          borderLeft: isDragOver ? "2px solid var(--q-accent)" : "2px solid transparent",
          opacity: isArchived ? 0.6 : 1,
        }}
        onMouseEnter={(e) => { if (!isDragOver) e.currentTarget.style.backgroundColor = "var(--q-bg-hover)"; }}
        onMouseLeave={(e) => { if (!isDragOver) e.currentTarget.style.backgroundColor = "transparent"; }}
      >
        <span className="text-[10px] w-3 shrink-0" style={{ color: "var(--q-fg-muted)" }}>
          {expanded ? "v" : ">"}
        </span>
        <span className="shrink-0 font-bold" style={{ color: "var(--q-accent)" }}>
          #
        </span>
        <span
          className="overflow-hidden whitespace-nowrap flex-1"
          style={{ color: "var(--q-fg)" }}
        >
          {task.tag} {task.name}
        </span>
      </button>

      {expanded && (
        <div>
          {[...sessions].sort((a, b) => a.name.localeCompare(b.name)).map((session) => (
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
              depth={2}
            />
          ))}
          {!showArchived && (
            <button
              onClick={() => onCreateSession(task.repoId, task.id)}
              className="w-full flex items-center gap-1.5 py-1 text-[10px] transition-colors"
              style={{
                paddingLeft: "60px",
                color: "var(--q-fg-muted)",
                fontFamily: "'JetBrains Mono', monospace",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg-secondary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-muted)")}
            >
              + session
            </button>
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
  depth: number;
}) {
  const isActive = activeSessionId === session.id;
  const isExpanded = expandedSessionId === session.id;
  const paddingLeft = 16 + depth * 16;
  const hasWorktree = !!session.worktreePath;
  const isArchived = !!session.archivedAt;

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

  return (
    <div>
      <button
        draggable={!isArchived}
        onDragStart={handleDragStart}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => onSessionContextMenu(e, session)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs transition-colors"
        style={{
          paddingLeft: `${paddingLeft}px`,
          backgroundColor: isActive ? "var(--q-bg-hover)" : "transparent",
          fontFamily: "'JetBrains Mono', monospace",
          opacity: isArchived ? 0.6 : 1,
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = "var(--q-bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <StatusDot status={displayStatus} />
        <span
          className="overflow-hidden whitespace-nowrap flex-1"
          style={{
            color: isActive ? "var(--q-fg)" : "var(--q-fg-secondary)",
            textOverflow: "ellipsis",
          }}
        >
          {session.name}
        </span>
        {hasWorktree && (
          <span
            className="shrink-0 text-[8px] px-1"
            style={{
              color: "var(--q-accent)",
              border: "1px solid var(--q-accent)",
            }}
          >
            wt
          </span>
        )}
        {session.sessionType === "terminal" ? (
          <span
            className="shrink-0 text-[8px] px-1"
            style={{
              color: "var(--q-purple-light)",
              border: "1px solid var(--q-purple-light)",
            }}
          >
            sh
          </span>
        ) : (
          <StatusBadge status={displayStatus} />
        )}
      </button>

      {isExpanded && actions.length > 0 && (
        <ActionLog actions={actions} maxVisible={8} />
      )}
    </div>
  );
}
