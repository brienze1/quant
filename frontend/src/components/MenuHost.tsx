import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

/**
 * Richer, design-spec context menu + host. This is an ADDITIVE API that lives
 * alongside the legacy `ContextMenu` component. Mount <MenuHost> near the app
 * root, then call `useMenu()(event, items)` from any descendant to open a menu
 * at the cursor.
 */

export type MenuTone = "accent" | "warn" | "danger" | "muted";

export interface HostMenuItem {
  /** divider */
  sep?: boolean;
  /** mono section header */
  header?: string;
  label?: ReactNode;
  icon?: IconName | (string & {});
  /** right-aligned mono hint (e.g. a shortcut) */
  hint?: ReactNode;
  tone?: MenuTone;
  disabled?: boolean;
  onClick?: () => void;
}

export type OpenMenu = (
  e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void },
  items: HostMenuItem[],
) => void;

const noop: OpenMenu = () => {};
export const MenuContext = createContext<OpenMenu>(noop);

/** Hook to open a host menu: `const openMenu = useMenu(); openMenu(e, items)` */
export function useMenu(): OpenMenu {
  return useContext(MenuContext);
}

const CTX_TONE: Record<MenuTone, string> = {
  accent: "var(--accent)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  muted: "var(--fg-4)",
};

function HostMenuItemRow({ item, onClose }: { item: HostMenuItem; onClose: () => void }) {
  const [h, setH] = useState(false);
  const toneCol = item.tone ? CTX_TONE[item.tone] : null;
  const danger = item.tone === "danger";
  const col = item.disabled ? "var(--fg-4)" : toneCol || "var(--fg-2)";
  return (
    <button
      type="button"
      disabled={item.disabled}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => {
        if (item.disabled) return;
        onClose();
        item.onClick && item.onClick();
      }}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 10px",
        borderRadius: 7,
        border: "none",
        cursor: item.disabled ? "default" : "pointer",
        textAlign: "left",
        whiteSpace: "nowrap",
        fontFamily: "var(--sans)",
        fontSize: 12.5,
        fontWeight: 500,
        color: col,
        background:
          h && !item.disabled
            ? danger
              ? "color-mix(in srgb, var(--danger) 14%, transparent)"
              : "var(--hover)"
            : "transparent",
      }}
    >
      {item.icon && (
        <Icon
          name={item.icon}
          size={14}
          color={item.disabled ? "var(--fg-4)" : toneCol || "var(--fg-3)"}
          style={{ flex: "none" }}
        />
      )}
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.hint && <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>{item.hint}</span>}
    </button>
  );
}

interface HostMenuProps {
  x: number;
  y: number;
  items: HostMenuItem[];
  onClose: () => void;
}

export function HostMenu({ x, y, items, onClose }: HostMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({
    left: x,
    top: y,
    ready: false,
  });

  useLayoutEffect(() => {
    const el = ref.current;
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
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
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
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={wrapStyle}
    >
      {items.map((it, i) =>
        it.sep ? (
          <div key={"s" + i} style={{ height: 1, background: "var(--border-2)", margin: "5px 8px" }} />
        ) : it.header ? (
          <div
            key={"h" + i}
            className="mono"
            style={{ padding: "6px 11px 3px", fontSize: 9.5, letterSpacing: "0.04em", color: "var(--fg-4)" }}
          >
            {it.header}
          </div>
        ) : (
          <HostMenuItemRow key={i} item={it} onClose={onClose} />
        ),
      )}
    </div>
  );
}

/** Place once near the app root; exposes openMenu(e, items) via useMenu(). */
export function MenuHost({ children }: { children?: ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: HostMenuItem[] } | null>(null);
  const openMenu = useCallback<OpenMenu>((e, items) => {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);
  return (
    <MenuContext.Provider value={openMenu}>
      {children}
      {menu && <HostMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </MenuContext.Provider>
  );
}
