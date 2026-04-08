import type { DisplayStatus } from "./StatusBadge";

const statusColors: Record<DisplayStatus, string> = {
  running: "var(--q-accent)",    // green
  waiting: "var(--q-cyan)",    // cyan
  idle: "var(--q-fg-secondary)",       // gray
  paused: "var(--q-fg-secondary)",     // gray
  done: "var(--q-cyan)",       // cyan
  error: "var(--q-error)",      // red
  starting: "var(--q-purple)",   // purple
  resuming: "var(--q-purple)",   // purple
  stopping: "var(--q-warning)",   // amber
  archived: "var(--q-fg-secondary)",   // gray
};

const isAnimated = (s: DisplayStatus) =>
  s === "starting" || s === "stopping" || s === "resuming" || s === "running";

interface Props {
  status: DisplayStatus;
  className?: string;
}

export function StatusDot({ status, className = "" }: Props) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 ${className}`}
      style={{
        backgroundColor: statusColors[status],
        animation: isAnimated(status) ? "pulse-dot 0.8s ease-in-out infinite" : undefined,
      }}
      title={status}
    />
  );
}
