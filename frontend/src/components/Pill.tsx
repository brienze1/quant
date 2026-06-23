import type { CSSProperties, ReactNode } from "react";

export type PillTone = "muted" | "accent" | "info" | "warn" | "danger";

export interface PillProps {
  children?: ReactNode;
  tone?: PillTone;
  /** soft tinted background instead of an outlined chip */
  soft?: boolean;
  style?: CSSProperties;
}

const TONE_MAP: Record<PillTone, [string, string]> = {
  muted: ["var(--fg-3)", "var(--border)"],
  accent: ["var(--accent)", "var(--accent-line)"],
  info: ["var(--info)", "color-mix(in srgb,var(--info) 45%,var(--border))"],
  warn: ["var(--warn)", "color-mix(in srgb,var(--warn) 45%,var(--border))"],
  danger: ["var(--danger)", "color-mix(in srgb,var(--danger) 45%,var(--border))"],
};

export function Pill({ children, tone = "muted", soft, style }: PillProps) {
  const [c, b] = TONE_MAP[tone] || TONE_MAP.muted;
  return (
    <span
      className="mono"
      style={{
        flex: "none",
        fontSize: 9.5,
        lineHeight: "15px",
        padding: "0 6px",
        letterSpacing: "0.02em",
        borderRadius: 5,
        whiteSpace: "nowrap",
        color: c,
        background: soft ? `color-mix(in srgb, ${c} 13%, transparent)` : "transparent",
        border: `1px solid ${soft ? "transparent" : b}`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
