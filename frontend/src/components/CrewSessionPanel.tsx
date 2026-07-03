import { useState } from "react";
import type { Session, Config } from "../types";
import * as api from "../api";
import { TerminalPane } from "./TerminalPane";
import { StatusDot } from "./StatusDot";
import type { DisplayStatus } from "./StatusBadge";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";

/* ============================================================
   CrewSessionPanel — a crew worker detached into its own dock
   panel (pixel spec: design_source/dock.jsx CrewSessionPanel):
   a task/branch context row, the worker's LIVE terminal, and a
   rounded one-line steer input.

   The terminal REUSES TerminalPane pointed at the worker's
   session — the same component the dock's embedded-terminal
   leaf uses for an arbitrary (non-active) session. It
   subscribes to session:output filtered by session id,
   backfills via getSessionOutput, and auto-starts idle/paused
   sessions through onStart/onResume.

   The steer input mirrors the Go SendMessageAndSubmit
   semantics from the frontend: write the text, wait 120ms,
   then write "\r" as a separate keystroke so the Claude CLI
   registers it as a submit (a trailing \n inside one write is
   swallowed as a soft newline).
   ============================================================ */

export interface CrewSessionPanelProps {
  session: Session;
  termConfig: Config | null;
  onStart: (id: string, rows: number, cols: number) => void;
  onResume: (id: string, rows: number, cols: number) => void;
  onError: (msg: string) => void;
}

export function CrewSessionPanel({
  session,
  termConfig,
  onStart,
  onResume,
  onError,
}: CrewSessionPanelProps) {
  const [text, setText] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  function submit() {
    const msg = text.trim();
    if (!msg) return;
    setText("");
    api
      .sendMessage(session.id, msg)
      .then(() => new Promise((r) => setTimeout(r, 120)))
      .then(() => api.sendMessage(session.id, "\r"))
      .catch((err) => onError(String(err)));
  }

  // Best task-ish label the Session carries (there's no joined task name on
  // the frontend Session shape): the description when set, else the name.
  const taskLabel = session.description || session.name;
  const branch = session.branchName || (session.worktreePath ? "worktree" : "");

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--panel)",
      }}
    >
      {/* task / branch context row */}
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 14px",
          borderBottom: "1px solid var(--border-2)",
          minWidth: 0,
        }}
      >
        <StatusDot status={session.status as DisplayStatus} size={7} glow />
        <span
          className="mono"
          style={{
            fontSize: 11.5,
            color: "var(--fg-2)",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {taskLabel}
        </span>
        <span style={{ flex: 1 }} />
        {branch && (
          <span
            className="mono"
            style={{
              fontSize: 10.5,
              color: "var(--fg-4)",
              flex: "none",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              maxWidth: 160,
            }}
          >
            <Icon
              name="branch"
              size={10}
              style={{ display: "inline", verticalAlign: "-1px", marginRight: 3 }}
            />
            {branch}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex" }}>
        <TerminalPane
          session={session}
          isArchived={!!session.archivedAt}
          onStart={onStart}
          onResume={onResume}
          termConfig={termConfig}
          autoScroll={autoScroll}
          onAutoScrollChange={setAutoScroll}
        />
      </div>

      {/* steer footer */}
      <div style={{ flex: "none", padding: "0 12px 12px", marginTop: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            height: 38,
            padding: "0 12px",
            borderRadius: 10,
            background: "var(--panel-2)",
            border: "1px solid var(--border-2)",
            minWidth: 0,
          }}
        >
          <span className="mono" style={{ color: "var(--accent)", fontSize: 12, flex: "none" }}>
            ❯
          </span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`steer ${session.name}…`}
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              height: 22,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--fg)",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
            }}
          />
          <Kbd>↵</Kbd>
        </div>
      </div>
    </div>
  );
}
