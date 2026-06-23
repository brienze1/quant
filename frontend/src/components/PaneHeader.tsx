import type { HTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";

export interface PaneHeaderProps {
  /** show a status dot */
  dot?: boolean;
  dotColor?: string;
  /** uppercase mono eyebrow text */
  eyebrow?: ReactNode;
  title?: ReactNode;
  sub?: ReactNode;
  /** trailing actions, rendered right-aligned */
  actions?: ReactNode;
  /** spread onto the header to make it a drag handle (shows a grip glyph) */
  grip?: HTMLAttributes<HTMLDivElement>;
}

export function PaneHeader({ dot, dotColor, eyebrow, title, sub, actions, grip }: PaneHeaderProps) {
  return (
    <div
      {...(grip || {})}
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 38,
        padding: grip ? "0 10px 0 8px" : "0 10px 0 14px",
        borderBottom: "1px solid var(--border-2)",
        cursor: grip ? "grab" : "default",
      }}
    >
      {grip && (
        <span style={{ display: "flex", color: "var(--fg-4)", flex: "none", cursor: "grab" }}>
          <Icon name="grip" size={14} />
        </span>
      )}
      {dot && (
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: dotColor || "var(--accent)",
            flex: "none",
            boxShadow: `0 0 6px ${dotColor || "var(--accent)"}`,
          }}
        />
      )}
      {eyebrow && (
        <span
          className="mono"
          style={{
            fontSize: 9.5,
            letterSpacing: "0.13em",
            textTransform: "uppercase",
            color: "var(--fg-3)",
            fontWeight: 600,
          }}
        >
          {eyebrow}
        </span>
      )}
      {title && (
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg)", letterSpacing: "-0.01em" }}>
          {title}
        </span>
      )}
      {sub && <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{sub}</span>}
      <span style={{ flex: 1 }} />
      {actions}
    </div>
  );
}
