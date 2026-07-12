import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session, CrewEnvelope, CrewEnvelopeType } from "../types";
import * as api from "../api";
import { StatusDot } from "./StatusDot";
import type { DisplayStatus } from "./StatusBadge";
import { IconButton } from "./IconButton";
import { Icon } from "./Icon";
import { useIsMobile } from "../mobile/useIsMobile";

/* ============================================================
   CrewPane — the supervisor's crew dock pane.

   Pixel spec: design_source/dock.jsx (CrewDock / CrewWorkerRow /
   InboxEnvelope). Shows the workers assigned to the supervisor
   session, the inbox of report envelopes (queued first,
   delivered history dimmed below), a drag-assign footer, and an
   empty state that explains the first-assignment flow.
   Assignment data (workers, queued count) is joined in App from
   the 3s sessions poll and passed down; envelope bodies are
   fetched HERE (mount + 5s poll + crew:updated refetch — the
   MindmapPane pattern).
   ============================================================ */

/** Envelope-type → [accent token, leading icon] (spec's ENV_TONE). done stays
 *  var(--ok) per the locked plan (the spec's var(--accent) is the same green
 *  in the base theme, but --ok is theme-stable). */
export const ENV_TONE: Record<CrewEnvelopeType, [string, string]> = {
  done: ["var(--ok)", "check"],
  progress: ["var(--info)", "arrowDown"],
  question: ["var(--warn)", "question"],
  blocked: ["var(--danger)", "alert"],
  nudge: ["var(--purple)", "sparkles"],
};

export interface CrewPaneProps {
  supervisor: Session;
  /** Workers of `supervisor`, joined frontend-side from the sessions store. */
  workers: Session[];
  /** Queued envelope count from the shared QueuedCounts map/event. */
  queuedCount: number;
  /** Whether the supervisor's "always deliver" lock is on. */
  deliveryLocked: boolean;
  /** Toggle the supervisor's "always deliver" lock. */
  onToggleLock: (locked: boolean) => void;
  /** Focus a session tab (worker row "focus" action). */
  onSelectSession: (id: string) => void;
  /** Detach a worker into its own dock panel (CrewSessionPanel). */
  onDetachWorker: (id: string) => void;
  /** Eligible sessions the mobile tap-assign picker can add (desktop uses drag-drop). */
  assignCandidates?: Session[];
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

function SectionLabel({
  children,
  note,
  actions,
}: {
  children: React.ReactNode;
  note?: string;
  /** trailing right-aligned extras (e.g. the deliver-now button) */
  actions?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        padding: "0 14px",
        margin: "0 0 9px",
        minWidth: 0,
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 9.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--fg-3)",
          fontWeight: 600,
          flex: "none",
        }}
      >
        {children}
      </span>
      {note && (
        <span
          style={{
            fontSize: 10,
            color: "var(--fg-4)",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {note}
        </span>
      )}
      {actions && (
        <>
          <span style={{ flex: 1 }} />
          {actions}
        </>
      )}
    </div>
  );
}

/** One dot of the worker row's 3×2 drag grip. */
function Dotty() {
  return (
    <span style={{ width: 2.5, height: 2.5, borderRadius: "50%", background: "var(--fg-3)" }} />
  );
}

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
        gap: 9,
        padding: "8px 10px",
        borderRadius: 9,
        background: hover ? "var(--panel-3)" : "var(--panel-2)",
        border: "1px solid var(--border-2)",
        cursor: "grab",
        minWidth: 0,
      }}
    >
      {/* 6-dot (3×2) drag grip */}
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          opacity: hover ? 0.6 : 0.3,
          flex: "none",
        }}
      >
        <span style={{ display: "flex", gap: 2 }}>
          <Dotty />
          <Dotty />
        </span>
        <span style={{ display: "flex", gap: 2 }}>
          <Dotty />
          <Dotty />
        </span>
        <span style={{ display: "flex", gap: 2 }}>
          <Dotty />
          <Dotty />
        </span>
      </span>
      <StatusDot status={status} size={8} glow />
      <span
        className="mono"
        style={{
          flex: 1,
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
      {meta && (
        <span
          style={{
            fontSize: 10.5,
            color: status === "error" ? "var(--warn)" : "var(--fg-3)",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            maxWidth: 110,
            flex: "none",
          }}
        >
          {meta}
        </span>
      )}
      {/* hover-reveal actions (alongside the meta, not replacing it) */}
      <span
        style={{
          display: "flex",
          gap: 1,
          opacity: hover ? 1 : 0,
          transition: "opacity .12s",
          flex: "none",
        }}
      >
        <IconButton
          name="columns"
          size={12}
          label="Detach to panel"
          onClick={() => onDetachWorker(session.id)}
        />
        <IconButton
          name="terminal"
          size={12}
          label="Focus session tab"
          onClick={() => onSelectSession(session.id)}
        />
        <IconButton name="x" size={12} label="Unassign" onClick={() => onUnassign(session.id)} />
      </span>
    </div>
  );
}

function EnvelopeCard({ envelope, fromName }: { envelope: CrewEnvelope; fromName: string }) {
  const [tone, iconName] = ENV_TONE[envelope.type] ?? ["var(--fg-3)", "note"];
  const delivered = envelope.status === "delivered";
  const state = delivered
    ? `✓ delivered · ${timeAgo(envelope.deliveredAt || envelope.createdAt)}`
    : `queued · ${timeAgo(envelope.createdAt)}`;
  return (
    <div
      style={{
        borderRadius: 10,
        overflow: "hidden",
        opacity: delivered ? 0.62 : 1,
        border: "1px solid var(--border-2)",
        background: "var(--panel-2)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 11px", minWidth: 0 }}>
        <Icon name={iconName} size={12} color={tone} />
        <span
          className="mono"
          style={{
            fontSize: 9.5,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: tone,
            fontWeight: 600,
            flex: "none",
          }}
        >
          {envelope.type}
        </span>
        <span
          className="mono"
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
      <div style={{ padding: "0 11px 9px", fontSize: 11.5, lineHeight: 1.45, color: "var(--fg-2)" }}>
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
}: {
  supervisor: Session;
  workers: Session[];
  onError: (msg: string) => void;
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
        height: 40,
        borderRadius: 10,
        border: `1.5px dashed ${over ? "var(--accent)" : "var(--border)"}`,
        background: over ? "var(--accent-soft)" : "transparent",
        color: over ? "var(--accent)" : "var(--fg-3)",
        fontSize: 11.5,
        fontFamily: "var(--sans)",
        minWidth: 0,
      }}
    >
      <Icon name="plus" size={13} />
      drag a session here to assign
    </div>
  );
}

/** Assign affordance: the desktop drag target, or a touch-friendly tap picker on
 *  mobile. Desktop path is byte-identical to the standalone AssignDropZone. */
function AssignFooter({
  supervisor,
  workers,
  candidates,
  onError,
}: {
  supervisor: Session;
  workers: Session[];
  candidates: Session[];
  onError: (msg: string) => void;
}) {
  const isMobile = useIsMobile();
  const [pickerOpen, setPickerOpen] = useState(false);

  const assign = useCallback(
    (candidate: Session) => {
      api
        .assignCrewWorker(candidate.id, supervisor.id)
        .then(() => setPickerOpen(false))
        .catch((err) => onError(String(err)));
    },
    [supervisor.id, onError]
  );

  if (!isMobile) {
    return <AssignDropZone supervisor={supervisor} workers={workers} onError={onError} />;
  }

  return (
    <>
      <button
        type="button"
        className="mo-tap"
        onClick={() => setPickerOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          width: "100%",
          height: 40,
          borderRadius: 10,
          border: "1.5px solid var(--border)",
          background: "transparent",
          color: "var(--accent)",
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: "var(--sans)",
          cursor: "pointer",
          minWidth: 0,
        }}
      >
        <Icon name="plus" size={14} color="var(--accent)" />
        Add worker
      </button>
      {pickerOpen && (
        <div
          onClick={() => setPickerOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            background: "rgba(0,0,0,.5)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              background: "var(--panel)",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              borderTop: "1px solid var(--border-2)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 16px",
                borderBottom: "1px solid var(--border-2)",
                flex: "none",
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 9.5,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--fg-3)",
                  fontWeight: 600,
                  flex: 1,
                }}
              >
                Add worker
              </span>
              <IconButton
                name="x"
                size={15}
                label="Close"
                onClick={() => setPickerOpen(false)}
              />
            </div>
            <div style={{ overflowY: "auto", padding: 8 }}>
              {candidates.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--fg-4)",
                    padding: "18px 10px",
                    textAlign: "center",
                  }}
                >
                  No eligible sessions to add
                </div>
              ) : (
                candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="mo-tap"
                    onClick={() => assign(c)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      minHeight: 44,
                      padding: "8px 12px",
                      borderRadius: 9,
                      border: "1px solid var(--border-2)",
                      background: "var(--panel-2)",
                      color: "var(--fg)",
                      fontFamily: "var(--sans)",
                      cursor: "pointer",
                      marginBottom: 6,
                      textAlign: "left",
                    }}
                  >
                    <StatusDot status={c.status as DisplayStatus} size={8} glow />
                    <span
                      className="mono"
                      style={{
                        flex: 1,
                        fontSize: 13,
                        fontWeight: 500,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.name}
                    </span>
                    <Icon name="plus" size={14} color="var(--accent)" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function CrewPane({
  supervisor,
  workers,
  queuedCount,
  deliveryLocked,
  onToggleLock,
  onSelectSession,
  onDetachWorker,
  assignCandidates,
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
        <AssignFooter
          supervisor={supervisor}
          workers={workers}
          candidates={assignCandidates ?? []}
          onError={onError}
        />
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
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingTop: 13 }}>
        {/* workers */}
        <SectionLabel note={`${workers.length} assigned`}>Workers</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "0 12px 6px" }}>
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
        </div>

        {/* divider between Workers and Inbox */}
        <div style={{ height: 1, background: "var(--border-2)", margin: "11px 14px" }} />

        {/* inbox */}
        <SectionLabel
          note={
            deliveryLocked
              ? queued.length > 0
                ? `${queued.length} queued · auto-delivering · injects immediately`
                : "auto-delivering · injects immediately"
              : queued.length > 0
                ? `${queued.length} queued · injects when idle`
                : "empty · injects when idle"
          }
          actions={
            <>
              {/* "always deliver" lock: the continuous form of deliver-now */}
              <button
                type="button"
                onClick={() => onToggleLock(!deliveryLocked)}
                title={
                  deliveryLocked
                    ? "Auto-delivering every report immediately — click to stop"
                    : "Always deliver reports immediately (bypasses the idle gates)"
                }
                style={{
                  flex: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  borderRadius: 6,
                  border: `1px solid ${deliveryLocked ? "var(--accent-line)" : "var(--border-2)"}`,
                  background: deliveryLocked ? "var(--accent-soft)" : "transparent",
                  color: deliveryLocked ? "var(--accent)" : "var(--fg-3)",
                  fontFamily: "var(--sans)",
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Icon name="lock" size={11} />
                {deliveryLocked ? "locked" : "lock"}
              </button>
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
            </>
          }
        >
          Inbox
        </SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 12px 12px" }}>
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
      </div>

      {/* drag-assign footer */}
      <div style={{ flex: "none", padding: "0 12px 12px" }}>
        <AssignFooter
          supervisor={supervisor}
          workers={workers}
          candidates={assignCandidates ?? []}
          onError={onError}
        />
      </div>
    </div>
  );
}
