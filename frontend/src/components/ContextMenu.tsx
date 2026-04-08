import { useEffect, useRef } from "react";

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  // Adjust position so menu doesn't overflow the viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 28 - 20);

  return (
    <div
      ref={menuRef}
      className="fixed z-50"
      style={{
        left: adjustedX,
        top: adjustedY,
        backgroundColor: "var(--q-bg)",
        border: "1px solid var(--q-border)",
        borderRadius: 0,
        minWidth: 180,
      }}
    >
      {items.map((item, i) => {
        if (item.type === "label") {
          return (
            <div
              key={i}
              className="px-3 pt-2 pb-1"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 9,
                color: "var(--q-fg-muted)",
                lineHeight: "16px",
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
              style={{
                height: 1,
                backgroundColor: "var(--q-border)",
                margin: "2px 0",
              }}
            />
          );
        }
        return (
          <button
            key={i}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className="w-full flex items-center text-left transition-colors"
            style={{
              height: 28,
              padding: "0 12px",
              gap: 8,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: item.labelColor ?? "var(--q-fg-dimmed)",
              backgroundColor: "transparent",
              border: "none",
              borderRadius: 0,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--q-bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <span style={{ color: item.iconColor, flexShrink: 0 }}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
