import type { ReactNode } from "react";
import { Icon } from "../components/Icon";

/**
 * Bottom sheet / full-screen overlay. Tapping the scrim closes it; the panel
 * slides up from the bottom and respects the top safe-area inset when `full`.
 */
export function MoSheet({
  open,
  onClose,
  children,
  full = false,
  title,
  headerRight,
  pad = true,
  fill = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  full?: boolean;
  title?: ReactNode;
  headerRight?: ReactNode;
  pad?: boolean;
  /**
   * Make the content region a definite-height flex column (no auto-scroll) so a
   * `flex:1` child (e.g. React Flow's canvas) inherits a real height instead of
   * collapsing to 0. Use for full-bleed panes that own their own scrolling.
   */
  fill?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        background: "var(--scrim)",
        animation: "moFadeIn .18s ease",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          height: full ? "100%" : "auto",
          maxHeight: full ? "100%" : "86%",
          background: "var(--panel)",
          borderTopLeftRadius: full ? 0 : 20,
          borderTopRightRadius: full ? 0 : 20,
          borderTop: "1px solid var(--border)",
          boxShadow: "var(--shadow-pop)",
          paddingTop: full ? "var(--safe-t)" : 0,
          animation: "moSheetUp .3s cubic-bezier(.32,.72,0,1)",
        }}
      >
        {!full && (
          <div style={{ display: "flex", justifyContent: "center", padding: "9px 0 3px", flex: "none" }}>
            <span style={{ width: 38, height: 5, borderRadius: 3, background: "var(--border)" }} />
          </div>
        )}
        {(title || headerRight) && (
          <div
            style={{
              flex: "none",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: full ? "6px 12px 10px 16px" : "6px 16px 12px",
            }}
          >
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", flex: 1 }}>{title}</span>
            {headerRight}
            {full && (
              <button
                onClick={onClose}
                className="mo-tap"
                aria-label="Close"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  background: "var(--panel-3)",
                  color: "var(--fg-2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="x" size={17} />
              </button>
            )}
          </div>
        )}
        <div
          className={fill ? undefined : "mo-scroll"}
          style={{
            flex: 1,
            minHeight: 0,
            ...(fill
              ? { display: "flex", flexDirection: "column", overflow: "hidden" }
              : { overflowY: "auto" }),
            padding: pad ? "0 0 calc(16px + var(--safe-b))" : 0,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** Wrap a wide desktop view so it scrolls both ways inside the phone. */
export function MoWideWrap({ children }: { children: ReactNode }) {
  return (
    <div className="mo-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex" }}>
      <div style={{ minWidth: "max-content", display: "flex", flex: 1 }}>{children}</div>
    </div>
  );
}
