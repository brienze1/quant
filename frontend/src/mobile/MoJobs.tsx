import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { moBuzz } from "./primitives";
import * as api from "../api";
import type { Job, JobGroup, JobRunStatus } from "../types";

/**
 * MoJobs — a touch-native jobs surface for the mobile shell. The desktop `JobsView`
 * is a pan/zoom SVG canvas that's unusable on a phone (pinch zooms the whole page).
 * This offers two views of the same job data:
 *  - "list":    a plain scrollable, tappable list with last-run status + run-now.
 *  - "diagram": a self-contained, READ-ONLY, touch-native DAG of the job pipeline
 *               with one-finger pan and two-finger pinch that never zooms the page
 *               (touch-action:none + preventDefault on native non-passive handlers).
 */

// ---- status → color (mirrors JobRunStatus) --------------------------------
function statusColor(s?: JobRunStatus): string {
  if (s === "success") return "var(--ok)";
  if (s === "failed" || s === "timed_out" || s === "cancelled") return "var(--danger)";
  if (s === "running" || s === "pending" || s === "waiting") return "var(--info)";
  return "var(--fg-4)";
}

function scheduleLabel(j: Job): string {
  if (!j.scheduleEnabled) return "manual";
  if (j.scheduleType === "one_time") return "one-time";
  if (j.cronExpression) return `cron: ${j.cronExpression}`;
  if (j.scheduleInterval) return `every ${j.scheduleInterval}s`;
  return "recurring";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ---------------------------------------------------------------------------
// List row
// ---------------------------------------------------------------------------
function JobRow({
  job,
  onEdit,
  lastStatus,
  onRun,
}: {
  job: Job;
  onEdit: (j: Job) => void;
  lastStatus?: JobRunStatus;
  onRun?: () => void;
}) {
  return (
    <button
      onClick={() => {
        moBuzz();
        onEdit(job);
      }}
      className="mo-tap"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "12px 12px",
        borderRadius: 12,
        border: "1px solid var(--border-2)",
        background: "var(--panel-2)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      {/* schedule indicator */}
      <span
        style={{
          width: 9,
          height: 9,
          flex: "none",
          borderRadius: "50%",
          background: job.scheduleEnabled ? "var(--accent)" : "var(--fg-4)",
          boxShadow: job.scheduleEnabled ? "0 0 6px var(--accent)" : "none",
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          className="mono"
          style={{ display: "block", fontSize: 14.5, fontWeight: 500, color: "var(--fg)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}
        >
          {job.name || "untitled job"}
        </span>
        <span className="mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--fg-4)", marginTop: 2 }}>
          {/* last-run status dot */}
          <span
            title={lastStatus ? `last run: ${lastStatus}` : "no runs yet"}
            style={{ width: 7, height: 7, flex: "none", borderRadius: "50%", background: statusColor(lastStatus) }}
          />
          {job.type} · {scheduleLabel(job)}
        </span>
      </span>
      {/* run now */}
      <span
        role="button"
        aria-label="Run now"
        className="mo-tap"
        onClick={(e) => {
          e.stopPropagation();
          moBuzz(10);
          onRun?.();
        }}
        style={{
          width: 32,
          height: 32,
          flex: "none",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--panel-3)",
          color: "var(--fg-2)",
        }}
      >
        <Icon name="play" size={14} />
      </span>
      <Icon name="chevronRight" size={16} color="var(--fg-4)" />
    </button>
  );
}

function SectionLabel({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "0 4px", margin: "14px 0 8px" }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-3)", fontWeight: 600 }}>
        {children}
      </span>
      <span style={{ fontSize: 11, color: "var(--fg-4)" }}>{count}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diagram layout — layered DAG (longest-path depth), deterministic
// ---------------------------------------------------------------------------
const NODE_W = 138;
const NODE_H = 48;
const H_GAP = 26;
const V_GAP = 54;
const MAX_PER_ROW = 4;

interface NodePos {
  job: Job;
  x: number;
  y: number;
}
interface Edge {
  from: string;
  to: string;
  kind: "success" | "failure";
}
interface Layout {
  nodes: NodePos[];
  edges: Edge[];
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

function computeLayout(jobs: Job[]): Layout {
  const ids = new Set(jobs.map((j) => j.id));

  // adjacency (only edges to jobs that exist in this set)
  const out = new Map<string, string[]>();
  const preds = new Map<string, string[]>();
  const edges: Edge[] = [];
  jobs.forEach((j) => {
    out.set(j.id, []);
    preds.set(j.id, []);
  });
  jobs.forEach((j) => {
    for (const t of j.onSuccess ?? []) {
      if (!ids.has(t)) continue;
      out.get(j.id)!.push(t);
      preds.get(t)!.push(j.id);
      edges.push({ from: j.id, to: t, kind: "success" });
    }
    for (const t of j.onFailure ?? []) {
      if (!ids.has(t)) continue;
      out.get(j.id)!.push(t);
      preds.get(t)!.push(j.id);
      edges.push({ from: j.id, to: t, kind: "failure" });
    }
  });

  // longest-path depth from any root (predecessors → depth+1), cycle-guarded
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // break cycles
    visiting.add(id);
    let d = 0;
    for (const p of preds.get(id) ?? []) d = Math.max(d, depthOf(p) + 1);
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  jobs.forEach((j) => depthOf(j.id));

  // group by depth, preserving original job order for determinism
  const byDepth = new Map<number, Job[]>();
  let maxDepth = 0;
  jobs.forEach((j) => {
    const d = depth.get(j.id) ?? 0;
    maxDepth = Math.max(maxDepth, d);
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(j);
  });

  // place: each depth level flows top→down; wide levels (and the no-edge case)
  // wrap into sub-rows of MAX_PER_ROW so the graph stays compact.
  const pos = new Map<string, { x: number; y: number }>();
  const nodes: NodePos[] = [];
  let curY = 0;
  let minX = 0;
  let maxX = 0;
  for (let d = 0; d <= maxDepth; d++) {
    const level = byDepth.get(d) ?? [];
    for (let i = 0; i < level.length; i += MAX_PER_ROW) {
      const chunk = level.slice(i, i + MAX_PER_ROW);
      const rowW = chunk.length * NODE_W + (chunk.length - 1) * H_GAP;
      const startX = -rowW / 2;
      chunk.forEach((job, k) => {
        const x = startX + k * (NODE_W + H_GAP);
        pos.set(job.id, { x, y: curY });
        nodes.push({ job, x, y: curY });
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + NODE_W);
      });
      curY += NODE_H + V_GAP;
    }
  }

  return { nodes, edges, pos, width: maxX - minX, height: Math.max(0, curY - V_GAP) };
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const x1 = a.x + NODE_W / 2;
  const y1 = a.y + NODE_H;
  const x2 = b.x + NODE_W / 2;
  const y2 = b.y;
  const dy = Math.max(24, (y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// Diagram (read-only, touch-native pan + pinch)
// ---------------------------------------------------------------------------
function JobsDiagram({
  jobs,
  runStatus,
  onTapNode,
}: {
  jobs: Job[];
  runStatus: Record<string, JobRunStatus>;
  onTapNode: (j: Job) => void;
}) {
  const layout = useMemo(() => computeLayout(jobs), [jobs]);
  const containerRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 28 });
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  scaleRef.current = scale;
  offsetRef.current = offset;

  const movedRef = useRef(false);
  const gestureRef = useRef<
    | { mode: "pan"; startX: number; startY: number; startOffset: { x: number; y: number } }
    | { mode: "pinch"; startDist: number; startScale: number; startOffset: { x: number; y: number }; midX: number; midY: number }
    | null
  >(null);

  // center content horizontally when the container mounts / jobs change
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth || 320;
    const next = { x: w / 2, y: 28 };
    setOffset(next);
    offsetRef.current = next;
    setScale(1);
    scaleRef.current = 1;
  }, [jobs]);

  // native non-passive touch handlers so preventDefault actually blocks the
  // browser's page pan/zoom — this is the core "diagram-only zoom" fix.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = () => el.getBoundingClientRect();

    const onStart = (e: TouchEvent) => {
      movedRef.current = false;
      const r = rect();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        gestureRef.current = {
          mode: "pan",
          startX: t.clientX - r.left,
          startY: t.clientY - r.top,
          startOffset: { ...offsetRef.current },
        };
      } else if (e.touches.length >= 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const dx = a.clientX - b.clientX;
        const dy = a.clientY - b.clientY;
        gestureRef.current = {
          mode: "pinch",
          startDist: Math.hypot(dx, dy) || 1,
          startScale: scaleRef.current,
          startOffset: { ...offsetRef.current },
          midX: (a.clientX + b.clientX) / 2 - r.left,
          midY: (a.clientY + b.clientY) / 2 - r.top,
        };
      }
    };

    const onMove = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      e.preventDefault(); // keep the PAGE from panning/zooming
      const r = rect();
      if (g.mode === "pan" && e.touches.length === 1) {
        const t = e.touches[0];
        const cx = t.clientX - r.left;
        const cy = t.clientY - r.top;
        if (Math.abs(cx - g.startX) > 4 || Math.abs(cy - g.startY) > 4) movedRef.current = true;
        const next = { x: g.startOffset.x + (cx - g.startX), y: g.startOffset.y + (cy - g.startY) };
        setOffset(next);
        offsetRef.current = next;
      } else if (g.mode === "pinch" && e.touches.length >= 2) {
        movedRef.current = true;
        const [a, b] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
        const ratio = dist / g.startDist;
        const newScale = Math.min(3, Math.max(0.3, g.startScale * ratio));
        // zoom about the initial pinch midpoint so it stays put
        const contentX = (g.midX - g.startOffset.x) / g.startScale;
        const contentY = (g.midY - g.startOffset.y) / g.startScale;
        const next = { x: g.midX - contentX * newScale, y: g.midY - contentY * newScale };
        setScale(newScale);
        scaleRef.current = newScale;
        setOffset(next);
        offsetRef.current = next;
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) gestureRef.current = null;
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [layout]);

  if (jobs.length === 0) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center" }}>
        <span style={{ width: 46, height: 46, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--panel-3)", color: "var(--fg-3)" }}>
          <Icon name="grid" size={22} />
        </span>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)" }}>No pipeline</div>
        <div style={{ fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>Create jobs and link them to see the graph.</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
        touchAction: "none",
        background: "var(--panel)",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
    >
      {/* pan/zoom hint */}
      <div style={{ position: "absolute", top: 8, left: 10, zIndex: 2, fontSize: 10.5, color: "var(--fg-4)", pointerEvents: "none" }} className="mono">
        drag to pan · pinch to zoom
      </div>
      <svg width="100%" height="100%" style={{ display: "block", touchAction: "none" }}>
        <defs>
          <marker id="mo-arrow-ok" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ok)" />
          </marker>
          <marker id="mo-arrow-fail" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--danger)" />
          </marker>
        </defs>
        <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
          {/* edges */}
          {layout.edges.map((e, i) => {
            const a = layout.pos.get(e.from);
            const b = layout.pos.get(e.to);
            if (!a || !b) return null;
            const col = e.kind === "failure" ? "var(--danger)" : "var(--ok)";
            return (
              <path
                key={i}
                d={edgePath(a, b)}
                fill="none"
                stroke={col}
                strokeOpacity={0.55}
                strokeWidth={1.6}
                markerEnd={`url(#${e.kind === "failure" ? "mo-arrow-fail" : "mo-arrow-ok"})`}
              />
            );
          })}
          {/* nodes */}
          {layout.nodes.map(({ job, x, y }) => (
            <g
              key={job.id}
              transform={`translate(${x} ${y})`}
              onClick={() => {
                if (movedRef.current) return; // ignore tap that was really a drag
                moBuzz();
                onTapNode(job);
              }}
              style={{ cursor: "pointer" }}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={11}
                fill="var(--panel-2)"
                stroke={job.scheduleEnabled ? "var(--accent)" : "var(--border-2)"}
                strokeWidth={1.2}
              />
              <circle cx={15} cy={NODE_H / 2} r={4.5} fill={statusColor(runStatus[job.id])} />
              <text
                x={28}
                y={NODE_H / 2 - 4}
                fill="var(--fg)"
                fontSize={12.5}
                fontWeight={500}
                dominantBaseline="middle"
                style={{ fontFamily: "var(--font-mono, monospace)" }}
              >
                {truncate(job.name || "untitled", 15)}
              </text>
              <text
                x={28}
                y={NODE_H / 2 + 11}
                fill="var(--fg-4)"
                fontSize={9.5}
                dominantBaseline="middle"
                style={{ fontFamily: "var(--font-mono, monospace)" }}
              >
                {truncate(job.type, 16)}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MoJobs (root)
// ---------------------------------------------------------------------------
export function MoJobs({
  jobs,
  groups,
  onCreateJob,
  onEditJob,
  onRefresh,
  onRunJob,
}: {
  jobs: Job[];
  groups: JobGroup[];
  onCreateJob: () => void;
  onEditJob: (job: Job) => void;
  onRefresh: () => void;
  onRunJob?: (jobId: string) => void;
}) {
  const [spin, setSpin] = useState(false);
  const [view, setView] = useState<"list" | "diagram">("list");
  const [reloadKey, setReloadKey] = useState(0);
  const [runStatus, setRunStatus] = useState<Record<string, JobRunStatus>>({});

  // fetch the latest run status per visible job (on mount, refresh, or job change)
  const idsKey = jobs.map((j) => j.id).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        jobs.map(async (j): Promise<[string, JobRunStatus | undefined]> => {
          try {
            const runs = await api.listRunsByJobPaginated(j.id, 1, 0);
            return [j.id, runs[0]?.status];
          } catch {
            return [j.id, undefined];
          }
        }),
      );
      if (cancelled) return;
      const map: Record<string, JobRunStatus> = {};
      for (const [id, st] of entries) if (st) map[id] = st;
      setRunStatus(map);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, reloadKey]);

  const byId = new Map(jobs.map((j) => [j.id, j]));
  const grouped = groups
    .map((g) => ({ group: g, items: g.jobIds.map((id) => byId.get(id)).filter((j): j is Job => !!j) }))
    .filter((g) => g.items.length > 0);
  const groupedIds = new Set(grouped.flatMap((g) => g.items.map((j) => j.id)));
  const ungrouped = jobs.filter((j) => !groupedIds.has(j.id));

  const refresh = () => {
    moBuzz(6);
    setSpin(true);
    onRefresh();
    setReloadKey((k) => k + 1);
    setTimeout(() => setSpin(false), 600);
  };

  const runNow = (jobId: string) => {
    // optimistic: show running immediately, then let refresh reconcile
    setRunStatus((prev) => ({ ...prev, [jobId]: "running" }));
    onRunJob?.(jobId);
    setTimeout(() => setReloadKey((k) => k + 1), 800);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel)" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border-2)" }}>
        {/* List / Diagram segmented toggle */}
        <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 9, background: "var(--panel-3)" }}>
          {(["list", "diagram"] as const).map((v) => (
            <button
              key={v}
              onClick={() => {
                moBuzz(6);
                setView(v);
              }}
              className="mo-tap"
              aria-pressed={view === v}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 10px",
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                background: view === v ? "var(--panel)" : "transparent",
                color: view === v ? "var(--fg)" : "var(--fg-4)",
                boxShadow: view === v ? "0 1px 3px rgba(0,0,0,0.18)" : "none",
              }}
            >
              <Icon name={v === "list" ? "list" : "grid"} size={13} />
              {v === "list" ? "List" : "Diagram"}
            </button>
          ))}
        </div>
        <span className="mono" style={{ flex: 1, textAlign: "right", fontSize: 12, color: "var(--fg-3)" }}>
          {jobs.length} job{jobs.length === 1 ? "" : "s"}
        </span>
        <button onClick={refresh} className="mo-tap" aria-label="Refresh" style={iconBtn}>
          <Icon name="refresh" size={16} style={spin ? { animation: "moSpin .6s linear" } : undefined} />
        </button>
        <button
          onClick={() => {
            moBuzz();
            onCreateJob();
          }}
          className="mo-tap"
          aria-label="New job"
          style={{ ...iconBtn, background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          <Icon name="plus" size={18} />
        </button>
      </div>

      {view === "diagram" ? (
        <JobsDiagram jobs={jobs} runStatus={runStatus} onTapNode={onEditJob} />
      ) : (
        <div className="mo-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 12px 16px" }}>
          {jobs.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "48px 24px", textAlign: "center" }}>
              <span style={{ width: 46, height: 46, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--panel-3)", color: "var(--fg-3)" }}>
                <Icon name="list" size={22} />
              </span>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)" }}>No jobs</div>
              <div style={{ fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>Tap + to create a scheduled or manual job.</div>
            </div>
          )}

          {grouped.map(({ group, items }) => (
            <div key={group.id}>
              <SectionLabel count={items.length}>{group.name}</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map((j) => (
                  <JobRow key={j.id} job={j} onEdit={onEditJob} lastStatus={runStatus[j.id]} onRun={() => runNow(j.id)} />
                ))}
              </div>
            </div>
          ))}

          {ungrouped.length > 0 && (
            <div>
              {grouped.length > 0 && <SectionLabel count={ungrouped.length}>ungrouped</SectionLabel>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: grouped.length === 0 ? 8 : 0 }}>
                {ungrouped.map((j) => (
                  <JobRow key={j.id} job={j} onEdit={onEditJob} lastStatus={runStatus[j.id]} onRun={() => runNow(j.id)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const iconBtn = {
  width: 34,
  height: 34,
  flex: "none",
  borderRadius: 9,
  border: "none",
  cursor: "pointer",
  background: "var(--panel-3)",
  color: "var(--fg-2)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;
