import { useState, useCallback, useEffect, useRef } from "react";
import type { Repo, Task, Session, Action } from "../types";
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
  onQuickCreateSession?: (session: Session) => void;
  onError?: (msg: string) => void;
  onOpenSettings?: () => void;
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
  onQuickCreateSession,
  onError,
  onOpenSettings,
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
          iconColor: "#10B981",
          label: "+ task",
          onClick: () => onCreateTask(repo.id),
        },
        {
          type: "item",
          icon: ">",
          iconColor: "#10B981",
          label: "+ session",
          onClick: () => onCreateSession(repo.id),
        },
        { type: "separator" },
        {
          type: "item",
          icon: "$",
          iconColor: "#6B7280",
          label: "open in terminal",
          onClick: () => api.openInTerminal(repo.path),
        },
        {
          type: "item",
          icon: "$",
          iconColor: "#6B7280",
          label: "open in finder",
          onClick: () => api.openInFinder(repo.path),
        },
        { type: "separator" },
        {
          type: "item",
          icon: "$",
          iconColor: "#6B7280",
          label: "rename",
          onClick: () => console.log("TODO: rename repo", repo.id),
        },
        {
          type: "item",
          icon: "x",
          iconColor: "#F59E0B",
          label: "close",
          labelColor: "#F59E0B",
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
        iconColor: "#10B981",
        label: "+ session",
        onClick: () => onCreateSession(task.repoId, task.id),
      });
      items.push({ type: "separator" });
      items.push({
        type: "item",
        icon: "$",
        iconColor: "#6B7280",
        label: "rename",
        onClick: () => onRenameTask?.(task.id, task.tag, task.name),
      });
      items.push({ type: "separator" });
      items.push({
        type: "item",
        icon: "~",
        iconColor: "#F59E0B",
        label: "archive",
        labelColor: "#F59E0B",
        onClick: () => onArchiveTask(task.id),
      });
      items.push({
        type: "item",
        icon: "x",
        iconColor: "#EF4444",
        label: "delete",
        labelColor: "#EF4444",
        onClick: () => onDeleteTask(task.id),
      });
    } else {
      items.push({
        type: "item",
        icon: "~",
        iconColor: "#10B981",
        label: "unarchive",
        labelColor: "#10B981",
        onClick: () => onUnarchiveTask(task.id),
      });
      items.push({ type: "separator" });
      items.push({
        type: "item",
        icon: "x",
        iconColor: "#EF4444",
        label: "delete",
        labelColor: "#EF4444",
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
      // Quick-create opposite session type
      if (onQuickCreateSession) {
        if (session.sessionType === "claude") {
          items.push({
            type: "item",
            icon: ">",
            iconColor: "#A78BFA",
            label: "open in terminal",
            onClick: () => onQuickCreateSession(session),
          });
        } else {
          items.push({
            type: "item",
            icon: ">",
            iconColor: "#8B5CF6",
            label: "open in claude",
            onClick: () => onQuickCreateSession(session),
          });
        }
        items.push({ type: "separator" });
      }

      items.push({
        type: "item",
        icon: "$",
        iconColor: "#6B7280",
        label: "open in system terminal",
        onClick: () => {
          const path = session.worktreePath || session.directory;
          if (path) api.openInTerminal(path);
        },
      });
      items.push({
        type: "item",
        icon: "$",
        iconColor: "#6B7280",
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
        iconColor: "#6B7280",
        label: "rename",
        onClick: () => onRenameSession?.(session.id, session.name),
      });

      // Only show "move to task" if there are >= 2 tasks in the repo
      const repoTasks = tasksByRepo[session.repoId] ?? [];
      if (repoTasks.length >= 2 && onMoveSession) {
        items.push({
          type: "item",
          icon: "$",
          iconColor: "#6B7280",
          label: "move to task",
          onClick: () => onMoveSession(session.id, session.repoId),
        });
      }

      items.push({ type: "separator" });
      items.push({
        type: "item",
        icon: "~",
        iconColor: "#F59E0B",
        label: "archive",
        labelColor: "#F59E0B",
        onClick: () => onArchiveSession(session.id),
      });
      items.push({
        type: "item",
        icon: "x",
        iconColor: "#EF4444",
        label: "delete",
        labelColor: "#EF4444",
        onClick: () => onDeleteSession(session.id),
      });
    } else {
      items.push({
        type: "item",
        icon: "~",
        iconColor: "#10B981",
        label: "unarchive",
        labelColor: "#10B981",
        onClick: () => onUnarchiveSession(session.id),
      });
      items.push({ type: "separator" });
      items.push({
        type: "item",
        icon: "x",
        iconColor: "#EF4444",
        label: "delete",
        labelColor: "#EF4444",
        onClick: () => onDeleteSession(session.id),
      });
    }

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }

  // Filter sessions based on archive state
  function filterSessions(sessions: Session[]): Session[] {
    return sessions.filter((s) => showArchived ? !!s.archivedAt : !s.archivedAt);
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
            backgroundColor: "#0A0A0A",
            borderRight: "1px solid #2a2a2a",
          }}
        >
          {/* header: logo + expand toggle */}
          <div
            className="flex flex-col items-center justify-center gap-1 py-2"
            style={{ borderBottom: "1px solid #2a2a2a", height: 64 }}
          >
            <span
              style={{ color: "#10B981", fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 700 }}
            >
              {">"}
            </span>
            <button
              onClick={() => setCollapsed(false)}
              className="flex items-center justify-center transition-colors"
              style={{ color: "#6B7280" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
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
                  color: "#6B7280",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 14, fontWeight: 700,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#1F1F1F"; e.currentTarget.style.color = "#10B981"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6B7280"; }}
                title={repo.name}
              >
                /
              </button>
            ))}
            <div style={{ width: 24, height: 1, backgroundColor: "#2a2a2a", marginTop: 4, marginBottom: 4 }} />
            <button
              onClick={onOpenRepo}
              className="flex items-center justify-center shrink-0 transition-colors"
              style={{
                width: 32, height: 32, borderRadius: 4,
                color: "#4B5563",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 14,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#10B981"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#4B5563"; }}
              title="add repo"
            >
              +
            </button>
          </div>

          {/* bottom bar */}
          <div
            className="flex flex-col items-center justify-center gap-1.5 py-2"
            style={{ borderTop: "1px solid #2a2a2a" }}
          >
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="flex items-center justify-center transition-colors"
                style={{ color: "#6B7280" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
                title="settings"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            )}
            <button
              onClick={() => {
                if (repos.length > 0) onCreateSession(repos[0].id);
              }}
              className="flex items-center justify-center transition-colors"
              style={{ color: "#10B981", fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#059669")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#10B981")}
              title="new session"
            >
              +
            </button>
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
          backgroundColor: "#0A0A0A",
          borderRight: "1px solid #2a2a2a",
        }}
      >
        {/* header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid #2a2a2a" }}
        >
          <h1
            className="text-sm font-bold lowercase"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <span style={{ color: "#10B981" }}>{">"}_</span>{" "}
            <span style={{ color: "#FAFAFA" }}>quant</span>
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenRepo}
              className="text-xs lowercase transition-colors"
              style={{ color: "#6B7280", fontFamily: "'JetBrains Mono', monospace" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
            >
              + repo
            </button>
            <button
              onClick={() => setCollapsed(true)}
              className="flex items-center justify-center transition-colors"
              style={{ color: "#6B7280" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
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
          style={{ borderBottom: "1px solid #2a2a2a" }}
        >
          <button
            onClick={() => setShowArchived(false)}
            className="flex-1 flex items-center justify-center py-2 text-[10px] lowercase transition-colors"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: showArchived ? "normal" : 500,
              color: showArchived ? "#6B7280" : "#10B981",
              borderBottom: showArchived ? "2px solid transparent" : "2px solid #10B981",
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
              color: showArchived ? "#10B981" : "#6B7280",
              borderBottom: showArchived ? "2px solid #10B981" : "2px solid transparent",
            }}
          >
            archived
          </button>
        </div>

        {/* tree nav */}
        <nav className="flex-1 overflow-y-auto py-1">
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
        </nav>

        {/* bottom bar */}
        <div className="flex items-center gap-2 p-3" style={{ borderTop: "1px solid #2a2a2a" }}>
          <button
            onClick={() => {
              if (repos.length > 0) {
                onCreateSession(repos[0].id);
              }
            }}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm lowercase transition-colors"
            style={{
              backgroundColor: "#10B981",
              color: "#0A0A0A",
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 500,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#059669")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#10B981")}
          >
            $ new_session
          </button>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="flex items-center justify-center shrink-0 transition-colors"
              style={{
                width: 36,
                height: 36,
                color: "#6B7280",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 16,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
              title="settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
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
          if (grip) grip.style.backgroundColor = "#6B7280";
        }}
        onMouseLeave={(e) => {
          const grip = e.currentTarget.querySelector<HTMLElement>("[data-grip]");
          if (grip) grip.style.backgroundColor = "#4B5563";
        }}
      >
        <div
          data-grip
          style={{
            width: 2,
            height: 32,
            borderRadius: 1,
            backgroundColor: "#4B5563",
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
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1F1F1F")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
      >
        <span className="text-[10px] w-3 shrink-0" style={{ color: "#4B5563" }}>
          {expanded ? "v" : ">"}
        </span>
        <span className="shrink-0 font-bold" style={{ color: "#6B7280" }}>
          /
        </span>
        <span
          className="font-bold overflow-hidden whitespace-nowrap flex-1"
          style={{ color: "#FAFAFA" }}
        >
          {repo.name}
        </span>
        <span
          className="text-[9px] overflow-hidden whitespace-nowrap shrink-0 max-w-[100px]"
          style={{
            color: "#4B5563",
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
                color: "#4B5563",
                fontFamily: "'JetBrains Mono', monospace",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#10B981")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#4B5563")}
            >
              + task
            </button>
          )}
        </div>
      )}

      {showSeparator && (
        <div className="mx-3 my-1" style={{ borderBottom: "1px solid #2a2a2a" }} />
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
          backgroundColor: isDragOver ? "#1F1F1F" : undefined,
          borderLeft: isDragOver ? "2px solid #10B981" : "2px solid transparent",
          opacity: isArchived ? 0.6 : 1,
        }}
        onMouseEnter={(e) => { if (!isDragOver) e.currentTarget.style.backgroundColor = "#1F1F1F"; }}
        onMouseLeave={(e) => { if (!isDragOver) e.currentTarget.style.backgroundColor = "transparent"; }}
      >
        <span className="text-[10px] w-3 shrink-0" style={{ color: "#4B5563" }}>
          {expanded ? "v" : ">"}
        </span>
        <span className="shrink-0 font-bold" style={{ color: "#10B981" }}>
          #
        </span>
        <span
          className="overflow-hidden whitespace-nowrap flex-1"
          style={{ color: "#FAFAFA" }}
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
                color: "#4B5563",
                fontFamily: "'JetBrains Mono', monospace",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#6B7280")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#4B5563")}
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

  // Single click: select session + toggle action log expansion.
  // For archived sessions: always open a read-only tab.
  // For active sessions: if the tab is already open OR the session is running/waiting, switch to the tab.
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
          backgroundColor: isActive ? "#1F1F1F" : "transparent",
          fontFamily: "'JetBrains Mono', monospace",
          opacity: isArchived ? 0.6 : 1,
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = "#1F1F1F";
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <StatusDot status={displayStatus} />
        <span
          className="overflow-hidden whitespace-nowrap flex-1"
          style={{
            color: isActive ? "#FAFAFA" : "#6B7280",
            textOverflow: "ellipsis",
          }}
        >
          {session.name}
        </span>
        {hasWorktree && (
          <span
            className="shrink-0 text-[8px] px-1"
            style={{
              color: "#10B981",
              border: "1px solid #10B981",
            }}
          >
            wt
          </span>
        )}
        {session.sessionType === "terminal" ? (
          <span
            className="shrink-0 text-[8px] px-1"
            style={{
              color: "#A855F7",
              border: "1px solid #A855F7",
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
