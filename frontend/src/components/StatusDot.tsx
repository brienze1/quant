import type { DisplayStatus } from "./StatusBadge";

/**
 * Status -> token color. Mapped onto the new design tokens while preserving
 * the existing DisplayStatus value set used across the app.
 */
const DOT_COLOR: Record<DisplayStatus, string> = {
  running: "var(--accent)",
  waiting: "var(--info)",
  idle: "var(--fg-4)",
  paused: "var(--warn)",
  done: "var(--accent)",
  error: "var(--danger)",
  starting: "var(--purple)",
  resuming: "var(--purple)",
  stopping: "var(--warn)",
  archived: "var(--fg-4)",
};

const ANIMATED: Record<DisplayStatus, boolean> = {
  running: true,
  waiting: true,
  starting: true,
  resuming: true,
  stopping: true,
  idle: false,
  paused: false,
  done: false,
  error: false,
  archived: false,
};

interface Props {
  status: DisplayStatus;
  /** dot diameter in px (default 8) */
  size?: number;
  /** add a soft glow around the dot */
  glow?: boolean;
  className?: string;
}

export function StatusDot({ status, size = 8, glow, className = "" }: Props) {
  const c = DOT_COLOR[status] || "var(--fg-4)";
  const isIdle = status === "idle" || status === "archived";
  return (
    <span
      className={`shrink-0 ${className}`}
      title={status}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flex: "none",
        display: "inline-block",
        background: isIdle ? "transparent" : c,
        border: isIdle ? "1.5px solid var(--fg-4)" : "none",
        boxShadow: glow && !isIdle ? `0 0 7px ${c}` : "none",
        animation: ANIMATED[status] ? "pulseDot 1.7s ease-in-out infinite" : "none",
      }}
    />
  );
}

export { DOT_COLOR };
