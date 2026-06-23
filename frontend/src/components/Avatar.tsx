import type { ReactNode } from "react";

export interface AvatarProps {
  label?: ReactNode;
  /** base color; a gradient is derived from it */
  color?: string;
}

export function Avatar({ label = "K", color = "var(--accent)" }: AvatarProps) {
  return (
    <span
      style={{
        width: 22,
        height: 22,
        borderRadius: 7,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `linear-gradient(160deg, ${color}, color-mix(in srgb, ${color} 60%, #000))`,
        color: "var(--on-accent)",
        fontSize: 11,
        fontWeight: 700,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.25)",
      }}
    >
      {label}
    </span>
  );
}
