import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Session, Task } from "../types";
import { StatusDot } from "./StatusDot";
import * as api from "../api";

interface Props {
  session: Session;
  task: Task | null;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onStart: (id: string, rows: number, cols: number) => void;
  onResume: (id: string, rows: number, cols: number) => void;
  onUnarchive?: (id: string) => void;
  displayStatus: import("./StatusBadge").DisplayStatus;
}

export function SessionPanel({
  session,
  task,
  onStop,
  onDelete,
  onClose,
  onStart,
  onResume,
  onUnarchive,
  displayStatus,
}: Props) {
  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);
  const sessionIdRef = useRef(session.id);

  // Track session ID changes to know when we need a fresh terminal.
  sessionIdRef.current = session.id;

  const isArchived = displayStatus === "archived";

  const initTerminal = useCallback(() => {
    if (!termContainerRef.current) return;

    // Clean up existing terminal.
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;

    const term = new Terminal({
      cursorBlink: !isArchived,
      disableStdin: isArchived,
      fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: "#0A0A0A",
        foreground: "#FAFAFA",
        cursor: isArchived ? "#0A0A0A" : "#10B981",
        selectionBackground: "rgba(16, 185, 129, 0.3)",
        black: "#0A0A0A",
        red: "#EF4444",
        green: "#10B981",
        yellow: "#F59E0B",
        blue: "#3B82F6",
        magenta: "#8B5CF6",
        cyan: "#06B6D4",
        white: "#FAFAFA",
        brightBlack: "#4B5563",
        brightRed: "#F87171",
        brightGreen: "#34D399",
        brightYellow: "#FBBF24",
        brightBlue: "#60A5FA",
        brightMagenta: "#A78BFA",
        brightCyan: "#22D3EE",
        brightWhite: "#FFFFFF",
      },
      allowProposedApi: true,
    });

    term.loadAddon(fitAddon);
    term.open(termContainerRef.current);
    fitAddon.fit();
    termRef.current = term;

    if (!isArchived) {
      // Send keystrokes to PTY via backend.
      term.onData((data) => {
        api.sendMessage(sessionIdRef.current, data).catch(() => {});
      });

      // Notify backend of terminal resize.
      term.onResize(({ rows, cols }) => {
        api.resizeTerminal(sessionIdRef.current, rows, cols).catch(() => {});
      });
    }

    return term;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArchived]);

  // Initialize terminal and set up event listeners.
  useEffect(() => {
    const term = initTerminal();
    if (!term) return;

    startedRef.current = false;

    // Archived sessions: just replay saved output, no live events or auto-start.
    if (isArchived) {
      api
        .getSessionOutput(session.id)
        .then((output) => {
          if (output && termRef.current) {
            termRef.current.write(output);
            termRef.current.write("\r\n\x1b[33m// archived session (read-only)\x1b[0m\r\n");
          }
        })
        .catch(() => {});

      return () => {
        if (termRef.current) {
          termRef.current.dispose();
          termRef.current = null;
        }
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (!w?.runtime?.EventsOn) return;

    // Listen for PTY output.
    const cancelOutput = w.runtime.EventsOn(
      "session:output",
      (data: { sessionId: string; data: string }) => {
        if (data.sessionId === session.id && termRef.current) {
          termRef.current.write(data.data);
        }
      }
    );

    // Listen for process exit.
    const cancelExited = w.runtime.EventsOn(
      "session:exited",
      (data: { sessionId: string }) => {
        if (data.sessionId === session.id && termRef.current) {
          termRef.current.write("\r\n\x1b[90m// session exited\x1b[0m\r\n");
        }
      }
    );

    // Replay saved output for paused/running sessions.
    if (session.status === "paused" || session.status === "running") {
      api
        .getSessionOutput(session.id)
        .then((output) => {
          if (output && termRef.current) {
            termRef.current.write(output);
          }
        })
        .catch(() => {});
    }

    // Auto-start idle sessions after terminal is mounted (so we have real rows/cols).
    if (session.status === "idle") {
      // Small delay to let fit complete.
      const timer = setTimeout(() => {
        if (!startedRef.current && termRef.current && fitAddonRef.current) {
          startedRef.current = true;
          fitAddonRef.current.fit();
          const { rows, cols } = termRef.current;
          onStart(session.id, rows, cols);
        }
      }, 100);
      return () => {
        clearTimeout(timer);
        if (cancelOutput) cancelOutput();
        if (cancelExited) cancelExited();
        if (termRef.current) {
          termRef.current.dispose();
          termRef.current = null;
        }
      };
    }

    return () => {
      if (cancelOutput) cancelOutput();
      if (cancelExited) cancelExited();
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, isArchived]);

  // Handle container resize via ResizeObserver.
  useEffect(() => {
    const container = termContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && termRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // Ignore fit errors during disposal.
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [session.id]);

  const isRunning = displayStatus === "running";
  const isPaused = displayStatus === "paused";

  function handleResume() {
    if (termRef.current && fitAddonRef.current) {
      fitAddonRef.current.fit();
      const { rows, cols } = termRef.current;
      onResume(session.id, rows, cols);
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#0A0A0A" }}>
      {/* tab bar */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{
          backgroundColor: "#0A0A0A",
          borderBottom: "1px solid #2a2a2a",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <StatusDot status={displayStatus} />
          <span
            className="text-xs font-bold overflow-hidden whitespace-nowrap"
            style={{ color: "#FAFAFA", textOverflow: "ellipsis" }}
          >
            {session.name}
          </span>
          {task && (
            <span
              className="shrink-0 text-[9px] px-1.5 py-0.5"
              style={{
                color: "#10B981",
                border: "1px solid #2a2a2a",
                backgroundColor: "#0A0A0A",
              }}
            >
              # {task.tag}
            </span>
          )}
          {session.worktreePath && (
            <span
              className="shrink-0 text-[9px] px-1.5 py-0.5"
              style={{
                color: "#10B981",
                border: "1px solid #10B981",
              }}
            >
              wt {session.branchName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isArchived ? (
            <>
              {onUnarchive && (
                <ActionBtn label="$ unarchive" onClick={() => onUnarchive(session.id)} color="#10B981" />
              )}
            </>
          ) : (
            <>
              {isPaused && (
                <ActionBtn label="$ resume" onClick={handleResume} color="#10B981" />
              )}
              {isRunning && (
                <ActionBtn label="$ stop" onClick={() => onStop(session.id)} color="#F59E0B" />
              )}
              <ActionBtn label="$ delete" onClick={() => onDelete(session.id)} color="#EF4444" />
            </>
          )}
          <button
            onClick={onClose}
            className="ml-1 text-xs transition-colors"
            style={{ color: "#6B7280" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
            title="close tab"
          >
            [x]
          </button>
        </div>
      </div>

      {/* terminal area */}
      <div
        ref={termContainerRef}
        className="flex-1 min-h-0"
        style={{ padding: "4px 0 0 4px" }}
      />
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  color,
}: {
  label: string;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 text-[10px] lowercase transition-colors"
      style={{
        color,
        fontFamily: "'JetBrains Mono', monospace",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1F1F1F")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      {label}
    </button>
  );
}
