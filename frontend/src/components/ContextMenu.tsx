import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

export type MenuItem =
  | { type: "label"; text: string }
  | { type: "separator" }
  | {
      type: "item";
      icon: string;
      iconColor: string;
      label: string;
      labelColor?: string;
      onClick: () => void;
    };

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({
    left: x,
    top: y,
    ready: false,
  });

  // Auto-flip / clamp into the viewport once measured.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - pad) left = Math.max(pad, x - r.width);
    if (top + r.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - r.height - pad);
    setPos({ left, top, ready: true });
  }, [x, y]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    const close = () => onClose();
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const wrapStyle: CSSProperties = {
    position: "fixed",
    left: pos.left,
    top: pos.top,
    zIndex: 400,
    minWidth: 196,
    opacity: pos.ready ? 1 : 0,
    transform: pos.ready ? "none" : "translateY(-3px)",
    transition: reduced ? "none" : "opacity .1s ease, transform .1s ease",
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 11,
    padding: 5,
    boxShadow: "var(--shadow-pop)",
    fontFamily: "var(--sans)",
  };

  return (
    <div ref={menuRef} style={wrapStyle}>
      {items.map((item, i) => {
        if (item.type === "label") {
          return (
            <div
              key={i}
              className="mono"
              style={{
                padding: "6px 11px 3px",
                fontSize: 9.5,
                letterSpacing: "0.04em",
                color: "var(--fg-4)",
              }}
            >
              {item.text}
            </div>
          );
        }
        if (item.type === "separator") {
          return (
            <div
              key={i}
              style={{ height: 1, background: "var(--border-2)", margin: "5px 8px" }}
            />
          );
        }
        return <ContextMenuItem key={i} item={item} onClose={onClose} />;
      })}
    </div>
  );
}

function ContextMenuItem({
  item,
  onClose,
}: {
  item: Extract<MenuItem, { type: "item" }>;
  onClose: () => void;
}) {
  const [h, setH] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        item.onClick();
        onClose();
      }}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 10px",
        borderRadius: 7,
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        whiteSpace: "nowrap",
        fontFamily: "var(--sans)",
        fontSize: 12.5,
        fontWeight: 500,
        color: item.labelColor ?? "var(--fg-2)",
        background: h ? "var(--hover)" : "transparent",
      }}
    >
      <span style={{ color: item.iconColor, flexShrink: 0, display: "flex", alignItems: "center" }}>
        {item.icon}
      </span>
      <span style={{ flex: 1 }}>{item.label}</span>
    </button>
  );
}
