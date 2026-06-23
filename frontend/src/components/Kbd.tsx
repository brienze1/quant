import type { ReactNode } from "react";

export interface KbdProps {
  children?: ReactNode;
}

export function Kbd({ children }: KbdProps) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        lineHeight: "15px",
        padding: "0 5px",
        borderRadius: 4,
        color: "var(--fg-3)",
        background: "var(--panel-3)",
        border: "1px solid var(--border-2)",
        boxShadow: "0 1px 0 var(--border)",
      }}
    >
      {children}
    </span>
  );
}
