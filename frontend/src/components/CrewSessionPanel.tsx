import { useState } from "react";
import type { Session, Config } from "../types";
import * as api from "../api";
import { TerminalPane } from "./TerminalPane";

/* ============================================================
   CrewSessionPanel — a crew worker detached into its own dock
   panel: the worker's LIVE terminal plus a one-line steer input.

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

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
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
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          borderTop: "1px solid var(--border-2)",
          background: "var(--panel-2)",
        }}
      >
        <span
          className="mono"
          style={{ color: "var(--accent)", fontSize: 12, fontWeight: 700, flex: "none" }}
        >
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
        <span className="mono" style={{ color: "var(--fg-4)", fontSize: 10, flex: "none" }}>
          ↵
        </span>
      </div>
    </div>
  );
}
