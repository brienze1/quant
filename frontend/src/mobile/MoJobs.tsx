import { useState } from "react";
import { Icon } from "../components/Icon";
import { moBuzz } from "./primitives";
import type { Job, JobGroup } from "../types";

/**
 * MoJobs — a touch-native jobs list for the mobile shell. The desktop `JobsView`
 * is a pan/zoom SVG canvas that's unusable on a phone (pinch zooms the page); this
 * renders the same job data as a plain scrollable, tappable list instead.
 */
function scheduleLabel(j: Job): string {
  if (!j.scheduleEnabled) return "manual";
  if (j.scheduleType === "one_time") return "one-time";
  if (j.cronExpression) return `cron: ${j.cronExpression}`;
  if (j.scheduleInterval) return `every ${j.scheduleInterval}s`;
  return "recurring";
}

function JobRow({ job, onEdit }: { job: Job; onEdit: (j: Job) => void }) {
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
        <span className="mono" style={{ display: "block", fontSize: 11.5, color: "var(--fg-4)", marginTop: 2 }}>
          {job.type} · {scheduleLabel(job)}
        </span>
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

export function MoJobs({
  jobs,
  groups,
  onCreateJob,
  onEditJob,
  onRefresh,
}: {
  jobs: Job[];
  groups: JobGroup[];
  onCreateJob: () => void;
  onEditJob: (job: Job) => void;
  onRefresh: () => void;
}) {
  const [spin, setSpin] = useState(false);
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
    setTimeout(() => setSpin(false), 600);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel)" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border-2)" }}>
        <span className="mono" style={{ flex: 1, fontSize: 12, color: "var(--fg-3)" }}>{jobs.length} job{jobs.length === 1 ? "" : "s"}</span>
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
                <JobRow key={j.id} job={j} onEdit={onEditJob} />
              ))}
            </div>
          </div>
        ))}

        {ungrouped.length > 0 && (
          <div>
            {grouped.length > 0 && <SectionLabel count={ungrouped.length}>ungrouped</SectionLabel>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: grouped.length === 0 ? 8 : 0 }}>
              {ungrouped.map((j) => (
                <JobRow key={j.id} job={j} onEdit={onEditJob} />
              ))}
            </div>
          </div>
        )}
      </div>
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
