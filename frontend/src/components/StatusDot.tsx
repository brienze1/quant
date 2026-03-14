import type { DisplayStatus } from "./StatusBadge";

const statusColors: Record<DisplayStatus, string> = {
  running: "#10B981",    // green
  waiting: "#06B6D4",    // cyan
  idle: "#6B7280",       // gray
  paused: "#6B7280",     // gray
  done: "#06B6D4",       // cyan
  error: "#EF4444",      // red
  starting: "#A78BFA",   // purple
  resuming: "#A78BFA",   // purple
  stopping: "#F59E0B",   // amber
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
