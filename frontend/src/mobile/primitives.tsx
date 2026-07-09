import type { CSSProperties, ReactNode } from "react";

/** Guarded haptic tap — a no-op where `navigator.vibrate` is unavailable. */
export function moBuzz(ms = 8): void {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}

const STATUS_COLOR: Record<string, string> = {
  running: "var(--accent)",
  idle: "var(--fg-4)",
  paused: "var(--warn)",
  waiting: "var(--info)",
  starting: "var(--info)",
  done: "var(--accent)",
  error: "var(--danger)",
};

const STATUS_PULSE = new Set(["running", "starting"]);

export function StatusDot({
  status,
  size = 9,
  glow = false,
}: {
  status: string;
  size?: number;
  glow?: boolean;
}) {
  const color = STATUS_COLOR[status] || "var(--fg-3)";
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        background: color,
        boxShadow: glow ? `0 0 6px ${color}` : "none",
        animation: STATUS_PULSE.has(status) ? "pulseDot 1.6s infinite" : "none",
      }}
    />
  );
}

export type PillTone = "accent" | "info" | "warn" | "danger" | "muted";

const PILL_TONE: Record<PillTone, string> = {
  accent: "var(--accent)",
  info: "var(--info)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  muted: "var(--fg-3)",
};

export function Pill({
  children,
  tone = "muted",
  soft = false,
  style,
}: {
  children: ReactNode;
  tone?: PillTone;
  soft?: boolean;
  style?: CSSProperties;
}) {
  const c = PILL_TONE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 7px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.02em",
        color: c,
        background: soft
          ? `color-mix(in srgb, ${c} 16%, transparent)`
          : `color-mix(in srgb, ${c} 12%, transparent)`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function CountBadge({ n }: { n: number }) {
  return (
    <span
      style={{
        minWidth: 17,
        height: 17,
        padding: "0 5px",
        borderRadius: 999,
        background: "var(--accent)",
        color: "var(--on-accent)",
        fontSize: 10,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {n}
    </span>
  );
}
