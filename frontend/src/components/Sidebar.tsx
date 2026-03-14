import { useState } from "react";
import type { Repo, Task, Session, Action } from "../types";
import { StatusDot } from "./StatusDot";
import { StatusBadge } from "./StatusBadge";
import { ActionLog } from "./ActionLog";
import { ContextMenu } from "./ContextMenu";
import type { MenuItem } from "./ContextMenu";
import * as api from "../api";

interface SidebarProps {
  repos: Repo[];
  tasksByRepo: Record<string, Task[]>;
  sessionsByRepo: Record<string, Session[]>;
  sessionsByTask: Record<string, Session[]>;
  actionsBySession: Record<string, Action[]>;
  getDisplayStatus: (sessionId: string, baseStatus: Session["status"]) => import("./StatusBadge").DisplayStatus;
  activeSessionId: string | null;
  expandedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onExpandSession: (id: string | null) => void;
  onOpenRepo: () => void;
  onCreateTask: (repoId: string) => void;
  onCreateSession: (repoId: string, taskId?: string) => void;
  onRemoveRepo: (repoId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export function Sidebar({
  repos,
  tasksByRepo,
  sessionsByRepo,
  sessionsByTask,
  actionsBySession,
  getDisplayStatus,
  activeSessionId,
  expandedSessionId,
  onSelectSession,
  onExpandSession,
  onOpenRepo,
  onCreateTask,
  onCreateSession,
  onRemoveRepo,
  onDeleteTask,
  onDeleteSession,
}: SidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);

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
          iconColor: "#EF4444",
          label: "remove",
          labelColor: "#EF4444",
          onClick: () => onRemoveRepo(repo.id),
        },
      ],
    });
  }

  function openTaskContextMenu(e: React.MouseEvent, task: Task) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { type: "label", text: "// task" },
        {
          type: "item",
          icon: ">",
          iconColor: "#10B981",
          label: "+ session",
          onClick: () => onCreateSession(task.repoId, task.id),
        },
        { type: "separator" },
        {
          type: "item",
          icon: "$",
          iconColor: "#6B7280",
          label: "rename",
          onClick: () => console.log("TODO: rename task", task.id),
        },
        { type: "separator" },
        {
          type: "item",
          icon: "x",
          iconColor: "#EF4444",
          label: "delete",
          labelColor: "#EF4444",
          onClick: () => onDeleteTask(task.id),
        },
      ],
    });
  }

  function openSessionContextMenu(e: React.MouseEvent, session: Session) {
    e.preventDefault();
    e.stopPropagation();

    const displaySt = getDisplayStatus(session.id, session.status);
    const items: MenuItem[] = [
      { type: "label", text: `// session [${displaySt}]` },
    ];

    items.push({
      type: "item",
      icon: "$",
      iconColor: "#6B7280",
      label: "open in terminal",
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
      onClick: () => console.log("TODO: rename session", session.id),
    });
    items.push({
      type: "item",
      icon: "$",
      iconColor: "#6B7280",
      label: "move to task",
      onClick: () => console.log("TODO: move session to task", session.id),
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

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }

  return (
    <aside
      className="flex flex-col w-72 min-w-[18rem] h-full"
      style={{
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
          <span style={{ color: "#10B981" }}>{">"}</span>{" "}
          <span style={{ color: "#FAFAFA" }}>quant</span>
        </h1>
        <button
          onClick={onOpenRepo}
          className="text-xs lowercase transition-colors"
          style={{ color: "#6B7280", fontFamily: "'JetBrains Mono', monospace" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
        >
          + repo
        </button>
      </div>

      {/* tree nav */}
      <nav className="flex-1 overflow-y-auto py-1">
        {repos.map((repo, idx) => (
          <RepoNode
            key={repo.id}
            repo={repo}
            tasks={tasksByRepo[repo.id] ?? []}
            sessionsByTask={sessionsByTask}
            actionsBySession={actionsBySession}
            getDisplayStatus={getDisplayStatus}
            activeSessionId={activeSessionId}
            expandedSessionId={expandedSessionId}
            onSelectSession={onSelectSession}
            onExpandSession={onExpandSession}
            onCreateTask={onCreateTask}
            onCreateSession={onCreateSession}
            onRepoContextMenu={openRepoContextMenu}
            onTaskContextMenu={openTaskContextMenu}
            onSessionContextMenu={openSessionContextMenu}
            showSeparator={idx < repos.length - 1}
          />
        ))}
      </nav>

      {/* bottom bar */}
      <div className="p-3" style={{ borderTop: "1px solid #2a2a2a" }}>
        <button
          onClick={() => {
            if (repos.length > 0) {
              onCreateSession(repos[0].id);
            }
          }}
          className="w-full flex items-center justify-center gap-1 px-3 py-2 text-sm lowercase transition-colors"
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
  );
}

function RepoNode({
  repo,
  tasks,
  sessionsByTask,
  actionsBySession,
  getDisplayStatus,
  activeSessionId,
  expandedSessionId,
  onSelectSession,
  onExpandSession,
  onCreateTask,
  onCreateSession,
  onRepoContextMenu,
  onTaskContextMenu,
  onSessionContextMenu,
  showSeparator,
}: {
  repo: Repo;
  tasks: Task[];
  sessionsByTask: Record<string, Session[]>;
  actionsBySession: Record<string, Action[]>;
  getDisplayStatus: (sessionId: string, baseStatus: Session["status"]) => import("./StatusBadge").DisplayStatus;
  activeSessionId: string | null;
  expandedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onExpandSession: (id: string | null) => void;
  onCreateTask: (repoId: string) => void;
  onCreateSession: (repoId: string, taskId?: string) => void;
  onRepoContextMenu: (e: React.MouseEvent, repo: Repo) => void;
  onTaskContextMenu: (e: React.MouseEvent, task: Task) => void;
  onSessionContextMenu: (e: React.MouseEvent, session: Session) => void;
  showSeparator: boolean;
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
              sessions={sessionsByTask[task.id] ?? []}
              actionsBySession={actionsBySession}
              getDisplayStatus={getDisplayStatus}
              activeSessionId={activeSessionId}
              expandedSessionId={expandedSessionId}
              onSelectSession={onSelectSession}
              onExpandSession={onExpandSession}
              onCreateSession={onCreateSession}
              onTaskContextMenu={onTaskContextMenu}
              onSessionContextMenu={onSessionContextMenu}
            />
          ))}

          {/* add task */}
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
  activeSessionId,
  expandedSessionId,
  onSelectSession,
  onExpandSession,
  onCreateSession,
  onTaskContextMenu,
  onSessionContextMenu,
}: {
  task: Task;
  sessions: Session[];
  actionsBySession: Record<string, Action[]>;
  getDisplayStatus: (sessionId: string, baseStatus: Session["status"]) => import("./StatusBadge").DisplayStatus;
  activeSessionId: string | null;
  expandedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onExpandSession: (id: string | null) => void;
  onCreateSession: (repoId: string, taskId?: string) => void;
  onTaskContextMenu: (e: React.MouseEvent, task: Task) => void;
  onSessionContextMenu: (e: React.MouseEvent, session: Session) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        onContextMenu={(e) => onTaskContextMenu(e, task)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs transition-colors"
        style={{
          paddingLeft: "28px",
          fontFamily: "'JetBrains Mono', monospace",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1F1F1F")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
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
          {sessions.map((session) => (
            <SessionNode
              key={session.id}
              session={session}
              actions={actionsBySession[session.id] ?? []}
              displayStatus={getDisplayStatus(session.id, session.status)}
              activeSessionId={activeSessionId}
              expandedSessionId={expandedSessionId}
              onSelectSession={onSelectSession}
              onExpandSession={onExpandSession}
              onSessionContextMenu={onSessionContextMenu}
              depth={2}
            />
          ))}
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
        </div>
      )}
    </div>
  );
}

function SessionNode({
  session,
  actions,
  displayStatus,
  activeSessionId,
  expandedSessionId,
  onSelectSession,
  onExpandSession,
  onSessionContextMenu,
  depth,
}: {
  session: Session;
  actions: Action[];
  displayStatus: import("./StatusBadge").DisplayStatus;
  activeSessionId: string | null;
  expandedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onExpandSession: (id: string | null) => void;
  onSessionContextMenu: (e: React.MouseEvent, session: Session) => void;
  depth: number;
}) {
  const isActive = activeSessionId === session.id;
  const isExpanded = expandedSessionId === session.id;
  const paddingLeft = 16 + depth * 16;
  const hasWorktree = !!session.worktreePath;

  return (
    <div>
      <button
        onClick={() => {
          onSelectSession(session.id);
          onExpandSession(isExpanded ? null : session.id);
        }}
        onContextMenu={(e) => onSessionContextMenu(e, session)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs transition-colors"
        style={{
          paddingLeft: `${paddingLeft}px`,
          backgroundColor: isActive ? "#1F1F1F" : "transparent",
          fontFamily: "'JetBrains Mono', monospace",
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
        <StatusBadge status={displayStatus} />
      </button>

      {isExpanded && actions.length > 0 && (
        <ActionLog actions={actions} maxVisible={8} />
      )}
    </div>
  );
}
