import type { ReactNode } from "react";

export interface CountBadgeProps {
  n: ReactNode;
}

export function CountBadge({ n }: CountBadgeProps) {
  return (
    <span
      style={{
        flex: "none",
        minWidth: 16,
        height: 16,
        padding: "0 5px",
        borderRadius: 999,
        background: "var(--accent)",
        color: "var(--on-accent)",
        fontSize: 9.5,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {n}
    </span>
  );
}
