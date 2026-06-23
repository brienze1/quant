import { useState } from "react";
import type { CSSProperties } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface IconButtonProps {
  name: IconName | (string & {});
  size?: number;
  label?: string;
  active?: boolean;
  onClick?: () => void;
  /** color used for the glyph when active */
  tone?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

export function IconButton({
  name,
  size = 15,
  label,
  active,
  onClick,
  tone,
  disabled,
  style,
}: IconButtonProps) {
  const [h, setH] = useState(false);
  const hover = h && !disabled;
  const col = active ? tone || "var(--fg)" : hover ? "var(--fg)" : "var(--fg-3)";
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        borderRadius: 7,
        cursor: disabled ? "default" : "pointer",
        border: "none",
        background: active ? "var(--active)" : hover ? "var(--hover)" : "transparent",
        color: col,
        opacity: disabled ? 0.45 : 1,
        ...style,
      }}
    >
      <Icon name={name} size={size} />
    </button>
  );
}
