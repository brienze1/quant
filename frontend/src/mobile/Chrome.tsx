import { Icon, type IconName } from "../components/Icon";
import { StatusDot, moBuzz } from "./primitives";
import type { MobileTab } from "./types";

/** Translucent top bar: repos menu · session title · search · new. */
export function MoTopBar({
  title,
  status,
  onMenu,
  onPalette,
  onNew,
}: {
  title: string;
  status: string | null;
  onMenu: () => void;
  onPalette: () => void;
  onNew: () => void;
}) {
  return (
    <div
      style={{
        flex: "none",
        paddingTop: "var(--safe-t)",
        background: "color-mix(in srgb, var(--bg) 82%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border-2)",
        position: "relative",
        zIndex: 5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 52, padding: "0 8px" }}>
        <button
          onClick={onMenu}
          className="mo-tap"
          aria-label="Repositories"
          style={iconBtn}
        >
          <Icon name="list" size={21} />
        </button>
        <button
          onClick={onMenu}
          className="mo-tap"
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 40,
            padding: "0 6px",
            borderRadius: 11,
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          {status && <StatusDot status={status} size={8} glow />}
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--fg)",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </span>
          <Icon name="chevronDown" size={15} color="var(--fg-4)" />
        </button>
        <button onClick={onPalette} className="mo-tap" aria-label="Search" style={iconBtn}>
          <Icon name="search" size={20} />
        </button>
        <button onClick={onNew} className="mo-tap" aria-label="New session" style={iconBtn}>
          <Icon name="plus" size={21} />
        </button>
      </div>
    </div>
  );
}

const iconBtn = {
  width: 40,
  height: 40,
  flex: "none",
  borderRadius: 11,
  border: "none",
  background: "transparent",
  color: "var(--fg-2)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

export const MO_TABS: { key: MobileTab; label: string; icon: IconName }[] = [
  { key: "chat", label: "Chat", icon: "sparkles" },
  { key: "terminal", label: "Terminal", icon: "terminal" },
  { key: "crew", label: "Crew", icon: "layout" },
  { key: "jobs", label: "Jobs", icon: "list" },
  { key: "more", label: "More", icon: "grid" },
];

/** Bottom tab bar with the five destinations + optional crew badge. */
export function MoTabBar({
  tab,
  onTab,
  crewBadge,
}: {
  tab: MobileTab;
  onTab: (key: MobileTab) => void;
  crewBadge?: number;
}) {
  // Installed (standalone) PWA: the full home-indicator inset reads as a dead
  // band under the icons — keep only a small guard instead of the whole inset.
  const standalone =
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(display-mode: standalone)").matches;

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "stretch",
        padding: standalone
          ? "6px 6px max(calc(var(--safe-b) - 14px), 6px)"
          : "6px 6px calc(6px + var(--safe-b))",
        background: "color-mix(in srgb, var(--bg) 82%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: "1px solid var(--border-2)",
        position: "relative",
        zIndex: 5,
      }}
    >
      {MO_TABS.map((tb) => {
        const on = tab === tb.key;
        return (
          <button
            key={tb.key}
            onClick={() => {
              moBuzz();
              onTab(tb.key);
            }}
            className="mo-tap"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              padding: "6px 0 4px",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              position: "relative",
              color: on ? "var(--accent)" : "var(--fg-3)",
            }}
          >
            <span style={{ position: "relative" }}>
              <Icon name={tb.icon} size={22} stroke={on ? 2.2 : 2} />
              {tb.key === "crew" && crewBadge ? (
                <span
                  style={{
                    position: "absolute",
                    top: -3,
                    right: -6,
                    minWidth: 15,
                    height: 15,
                    padding: "0 4px",
                    borderRadius: 999,
                    background: "var(--accent)",
                    color: "var(--on-accent)",
                    fontSize: 9,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {crewBadge}
                </span>
              ) : null}
            </span>
            <span style={{ fontSize: 10, fontWeight: on ? 700 : 500, letterSpacing: "-0.01em" }}>{tb.label}</span>
          </button>
        );
      })}
    </div>
  );
}
