import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export type ButtonVariant = "primary" | "ghost" | "subtle" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** leading icon name from the ICONS set */
  icon?: IconName | (string & {});
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
}

export function Button({
  children,
  variant = "ghost",
  size = "md",
  icon,
  onClick,
  active,
  disabled,
  title,
  style,
}: ButtonProps) {
  const [h, setH] = useState(false);
  const pad = size === "sm" ? "5px 10px" : "7px 13px";
  const fs = size === "sm" ? 12 : 12.5;
  const hover = h && !disabled;

  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
    fontFamily: "var(--sans)",
    fontSize: fs,
    fontWeight: 500,
    letterSpacing: "-0.01em",
    padding: pad,
    borderRadius: "var(--r2)",
    cursor: disabled ? "default" : "pointer",
    whiteSpace: "nowrap",
    border: "1px solid transparent",
    transition: "transform .06s",
    transform: hover ? "translateY(-0.5px)" : "none",
    opacity: disabled ? 0.5 : 1,
  };

  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: {
      background: hover ? "var(--accent-2)" : "var(--accent)",
      color: "var(--on-accent)",
      fontWeight: 600,
      boxShadow: "0 1px 2px rgba(0,0,0,.2), inset 0 1px 0 rgba(255,255,255,.18)",
    },
    ghost: {
      background: hover ? "var(--hover)" : "transparent",
      color: "var(--fg-2)",
      borderColor: "var(--border)",
    },
    subtle: {
      background: hover ? "var(--hover)" : "transparent",
      color: "var(--fg-2)",
      borderColor: "transparent",
    },
    danger: {
      background: hover ? "color-mix(in srgb,var(--danger) 16%,transparent)" : "transparent",
      color: "var(--danger)",
      borderColor: "color-mix(in srgb,var(--danger) 40%,var(--border))",
    },
  };

  const act: CSSProperties = active
    ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent-line)" }
    : {};

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{ ...base, ...variants[variant], ...act, ...style }}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
}
