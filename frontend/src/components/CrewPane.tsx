import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session, CrewEnvelope, CrewEnvelopeType } from "../types";
import * as api from "../api";
import { StatusDot } from "./StatusDot";
import type { DisplayStatus } from "./StatusBadge";
import { Pill } from "./Pill";
import { IconButton } from "./IconButton";
import { Icon } from "./Icon";

/* ============================================================
   CrewPane — the supervisor's crew dock pane.

   Shows the workers assigned to the supervisor session, the
   inbox of report envelopes (queued first, delivered history
   dimmed below), a drag-assign footer, and an empty state that
   explains the first-assignment flow. Assignment data (workers,
   queued count) is joined in App from the 3s sessions poll and
   passed down; envelope bodies are fetched HERE (mount + 5s
   poll + crew:updated refetch — the MindmapPane pattern).
   ============================================================ */

/** Envelope-type → accent token (header text + left border). */
export const ENV_TONE: Record<CrewEnvelopeType, string> = {
  done: "var(--ok)",
  progress: "var(--info)",
  question: "var(--warn)",
  blocked: "var(--danger)",
  nudge: "var(--purple)",
};

export interface CrewPaneProps {
  supervisor: Session;
  /** Workers of `supervisor`, joined frontend-side from the sessions store. */
  workers: Session[];
  /** Queued envelope count from the shared QueuedCounts map/event. */
  queuedCount: number;
  /** Focus a session tab (worker row "focus" action). */
  onSelectSession: (id: string) => void;
  /** Detach a worker into its own dock panel (CrewSessionPanel). */
  onDetachWorker: (id: string) => void;
  onError: (msg: string) => void;
}

/** Compact "how long ago" note for envelope cards. */
function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const SECTION_LABEL: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 9.5,
  letterSpacing: "0.13em",
  textTransform: "uppercase",
  color: "var(--fg-3)",
  fontWeight: 600,
};

function WorkerRow({
  session,
  supervisorId,
  onSelectSession,
  onDetachWorker,
  onUnassign,
}: {
  session: Session;
  supervisorId: string;
  onSelectSession: (id: string) => void;
  onDetachWorker: (id: string) => void;
  onUnassign: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);

  // Same keys the sidebar sets (so task rows still accept the drop) plus a
  // crewsource marker carrying the CURRENT supervisor: dropping on another
  // crew pane moves (upsert), dropping on the sidebar root unassigns.
  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData("sessionId", session.id);
    e.dataTransfer.setData("repoId", session.repoId);
    e.dataTransfer.setData("taskId", session.taskId);
    e.dataTransfer.setData("crewsource", supervisorId);
    e.dataTransfer.effectAllowed = "move";
  }

  const status = session.status as DisplayStatus;
  const meta = session.branchName || (session.worktreePath ? "wt" : "");

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px 6px 10px",
        borderRadius: 8,
        background: "var(--panel-2)",
        border: "1px solid var(--border-2)",
        cursor: "grab",
        minWidth: 0,
      }}
    >
      <StatusDot status={status} size={7} />
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--fg)",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        {session.name}
      </span>
      <Pill tone={status === "error" ? "danger" : status === "running" ? "accent" : "muted"}>
        {status}
      </Pill>
      <span style={{ flex: 1 }} />
      {hover ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 2, flex: "none" }}>
          <IconButton
            name="panelRight"
            size={13}
            label="Detach into a panel"
            onClick={() => onDetachWorker(session.id)}
          />
          <IconButton
            name="terminal"
            size={13}
            label="Focus session tab"
            onClick={() => onSelectSession(session.id)}
          />
          <IconButton name="x" size={13} label="Unassign" onClick={() => onUnassign(session.id)} />
        </span>
      ) : (
        meta && (
          <span
            className="mono"
            style={{
              fontSize: 9.5,
              color: "var(--fg-4)",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              maxWidth: 110,
              flex: "none",
            }}
          >
            {meta}
          </span>
        )
      )}
    </div>
  );
}

function EnvelopeCard({
  envelope,
  fromName,
}: {
  envelope: CrewEnvelope;
  fromName: string;
}) {
  const tone = ENV_TONE[envelope.type] ?? "var(--fg-3)";
  const delivered = envelope.status === "delivered";
  const state = delivered
    ? `✓ delivered · ${timeAgo(envelope.deliveredAt || envelope.createdAt)}`
    : `queued · ${timeAgo(envelope.createdAt)}`;
  return (
    <div
      style={{
        borderRadius: 8,
        background: "var(--panel-2)",
        border: "1px solid var(--border-2)",
        borderLeft: `2px solid ${tone}`,
        padding: "6px 9px 7px",
        opacity: delivered ? 0.55 : 1,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        <span
          className="mono"
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: tone,
            flex: "none",
          }}
        >
          [{envelope.type}]
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--fg-2)",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {fromName}
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)", flex: "none" }}>
          {state}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--fg-2)", marginTop: 3, lineHeight: 1.45 }}>
        {envelope.summary}
      </div>
    </div>
  );
}

/** Dashed drop target accepting sidebar sessions / other panes' worker rows. */
function AssignDropZone({
  supervisor,
  workers,
  onError,
  compact,
}: {
  supervisor: Session;
  workers: Session[];
  onError: (msg: string) => void;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);

  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("sessionid")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("sessionid")) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const sessionId = e.dataTransfer.getData("sessionId");
    if (!sessionId) return;
    if (sessionId === supervisor.id) return; // can't supervise itself
    if (workers.some((w) => w.id === sessionId)) return; // already assigned here
    // Backend validates (claude-only, non-archived, cycle check) — surface its
    // error as a toast. Moving between crews is the same upsert call.
    api.assignCrewWorker(sessionId, supervisor.id).catch((err) => onError(String(err)));
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: compact ? "9px 10px" : "16px 10px",
        borderRadius: 8,
        border: `1.5px dashed ${over ? "var(--accent)" : "var(--border-2)"}`,
        background: over ? "var(--accent-soft)" : "transparent",
        color: over ? "var(--accent)" : "var(--fg-4)",
        fontSize: 11,
        fontFamily: "var(--sans)",
        minWidth: 0,
      }}
    >
      <Icon name="plus" size={12} />
      drag a session here to assign
    </div>
  );
}

export function CrewPane({
  supervisor,
  workers,
  queuedCount,
  onSelectSession,
  onDetachWorker,
  onError,
}: CrewPaneProps) {
  const [envelopes, setEnvelopes] = useState<CrewEnvelope[]>([]);

  const load = useCallback(() => {
    api
      .getCrewInbox(supervisor.id, true)
      .then((list) => setEnvelopes(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [supervisor.id]);

  // Fetch on mount + 5s fallback poll while mounted (MindmapPane pattern).
  useEffect(() => {
    setEnvelopes([]);
    load();
    const poll = setInterval(load, 5000);
    return () => clearInterval(poll);
  }, [load]);

  // Live refetch on the tiny crew:updated event (payload carries no bodies).
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (!w?.runtime?.EventsOn) return;
    const cancel = w.runtime.EventsOn("crew:updated", () => load());
    return () => cancel && cancel();
  }, [load]);

  const nameByWorker = useMemo(() => {
    const out: Record<string, string> = {};
    for (const w of workers) out[w.id] = w.name;
    return out;
  }, [workers]);

  const queued = useMemo(
    () =>
      envelopes
        .filter((e) => e.status === "queued")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [envelopes]
  );
  const delivered = useMemo(
    () =>
      envelopes
        .filter((e) => e.status === "delivered")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20),
    [envelopes]
  );

  const fromName = (e: CrewEnvelope) =>
    nameByWorker[e.fromSessionId] ?? e.fromSessionId.slice(0, 8);

  // ---- empty state: no workers yet -----------------------------------------
  if (workers.length === 0 && envelopes.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 12,
          padding: "18px 16px",
          overflowY: "auto",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg)", marginBottom: 6 }}>
            no crew yet
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.55 }}>
            assign worker sessions to <span style={{ color: "var(--fg)" }}>{supervisor.name}</span>{" "}
            and their reports queue here, injecting into its terminal when idle.
          </div>
        </div>
        <AssignDropZone supervisor={supervisor} workers={workers} onError={onError} />
        <div
          className="mono"
          style={{ fontSize: 10, color: "var(--fg-4)", textAlign: "center", lineHeight: 1.6 }}
        >
          or ask the agent to spawn one:
          <br />
          <span style={{ color: "var(--fg-3)" }}>crew_dispatch(prompt, name, repoId)</span>
        </div>
      </div>
    );
  }

  // ---- normal layout: workers / inbox / drag-assign footer ------------------
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--sans)",
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "10px 10px 4px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {/* workers */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px 2px" }}>
          <span style={SECTION_LABEL}>workers</span>
          <span className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)" }}>
            {workers.length} assigned
          </span>
        </div>
        {workers.map((w) => (
          <WorkerRow
            key={w.id}
            session={w}
            supervisorId={supervisor.id}
            onSelectSession={onSelectSession}
            onDetachWorker={onDetachWorker}
            onUnassign={(id) => api.unassignCrewWorker(id).catch((err) => onError(String(err)))}
          />
        ))}

        {/* inbox */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 2px 2px",
            minWidth: 0,
          }}
        >
          <span style={SECTION_LABEL}>inbox</span>
          <span
            className="mono"
            style={{
              fontSize: 9.5,
              color: "var(--fg-4)",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {queued.length > 0
              ? `${queued.length} queued · injects when idle`
              : "empty · injects when idle"}
          </span>
          <span style={{ flex: 1 }} />
          {queued.length > 0 && (
            <button
              type="button"
              onClick={() => api.crewDrainNow(supervisor.id).catch((err) => onError(String(err)))}
              title="Deliver the next queued report now (bypasses the idle gates)"
              style={{
                flex: "none",
                padding: "2px 8px",
                borderRadius: 6,
                border: "1px solid var(--accent-line)",
                background: "var(--accent-soft)",
                color: "var(--accent)",
                fontFamily: "var(--sans)",
                fontSize: 10.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              deliver now
            </button>
          )}
        </div>
        {queued.map((e) => (
          <EnvelopeCard key={e.id} envelope={e} fromName={fromName(e)} />
        ))}
        {delivered.map((e) => (
          <EnvelopeCard key={e.id} envelope={e} fromName={fromName(e)} />
        ))}
        {queuedCount === 0 && queued.length === 0 && delivered.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--fg-4)", padding: "2px 2px 4px" }}>
            no reports yet — workers push them with report_to_supervisor.
          </div>
        )}
      </div>

      {/* drag-assign footer */}
      <div style={{ flex: "none", padding: "6px 10px 10px" }}>
        <AssignDropZone supervisor={supervisor} workers={workers} onError={onError} compact />
      </div>
    </div>
  );
}
