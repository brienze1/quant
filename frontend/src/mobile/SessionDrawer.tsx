import { Icon } from "../components/Icon";
import { MoSheet } from "./Sheet";
import { StatusDot, Pill, moBuzz } from "./primitives";
import type { MobileAppBag } from "./types";
import type { Repo, Task, Session } from "../types";

function SessionRow({
  s,
  active,
  onOpen,
}: {
  s: Session;
  active: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      onClick={() => {
        moBuzz();
        onOpen(s.id);
      }}
      className="mo-tap"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 12px 11px 40px",
        borderRadius: 12,
        marginBottom: 2,
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        background: active ? "var(--accent-soft)" : "transparent",
      }}
    >
      <StatusDot status={s.status} size={9} glow={active} />
      <span
        style={{
          flex: 1,
          fontSize: 15,
          fontWeight: active ? 600 : 500,
          color: active ? "var(--fg)" : "var(--fg-2)",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          letterSpacing: "-0.01em",
        }}
      >
        {s.name}
      </span>
      {s.worktreePath ? <Pill tone="muted">wt</Pill> : null}
      {s.status !== "idle" && (
        <Pill tone={s.status === "paused" ? "warn" : s.status === "error" ? "danger" : "accent"}>{s.status}</Pill>
      )}
    </button>
  );
}

/**
 * Full-screen sessions drawer. Joins the flat repos/tasks/sessions arrays into
 * a repo → task → session tree (mirrors the desktop sidebar hierarchy).
 */
export function MoSessionDrawer({
  open,
  onClose,
  app,
  onOpenSession,
}: {
  open: boolean;
  onClose: () => void;
  app: MobileAppBag;
  onOpenSession: (id: string) => void;
}) {
  const { repos, tasks, sessions, activeSessionId, onAction } = app;
  const openRepos = repos.filter((r: Repo) => !r.closedAt);

  return (
    <MoSheet
      open={open}
      onClose={onClose}
      full
      title="Sessions"
      headerRight={
        <button
          onClick={() => onAction("newRepo", {})}
          className="mo-tap"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 34,
            padding: "0 12px",
            borderRadius: 10,
            cursor: "pointer",
            border: "1px solid var(--border)",
            background: "var(--panel-2)",
            color: "var(--fg-2)",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <Icon name="plus" size={15} /> Repo
        </button>
      }
    >
      <div style={{ padding: "0 12px" }}>
        {openRepos.map((r) => {
          const repoTasks = tasks.filter((t: Task) => t.repoId === r.id && !t.archivedAt);
          return (
            <div key={r.id} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 6px" }}>
                <Icon name="folder" size={16} color="var(--fg-3)" />
                <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>{r.name}</span>
                <span style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{r.path}</span>
              </div>
              {repoTasks.map((t) => {
                const taskSessions = sessions.filter((s: Session) => s.taskId === t.id && !s.archivedAt);
                return (
                  <div key={t.id} style={{ marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 10px 6px 22px" }}>
                      <Icon name="hash" size={13} color="var(--accent)" />
                      <span className="mono" style={{ fontSize: 12.5, color: "var(--fg-2)" }}>{t.tag}</span>
                    </div>
                    {taskSessions.map((s) => (
                      <SessionRow
                        key={s.id}
                        s={s}
                        active={activeSessionId === s.id}
                        onOpen={(id) => {
                          onOpenSession(id);
                          onClose();
                        }}
                      />
                    ))}
                    <button
                      onClick={() => onAction("newSession", { repoId: r.id, taskId: t.id })}
                      className="mo-tap"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "7px 12px 7px 40px",
                        border: "none",
                        background: "transparent",
                        color: "var(--fg-4)",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      <Icon name="plus" size={13} /> session
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
        {openRepos.length === 0 && (
          <div className="mono" style={{ padding: "24px 14px", textAlign: "center", fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.6 }}>
            no repositories yet.
            <br />
            add one with the Repo button above.
          </div>
        )}
      </div>
    </MoSheet>
  );
}
