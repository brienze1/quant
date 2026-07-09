import type { ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import { useTheme } from "../theme";
import type { Accent } from "../theme/store";
import { MoSheet } from "./Sheet";

const ACCENT_HEX: Record<Accent, string> = {
  emerald: "#2ed3a0",
  iris: "#7b7bff",
  blue: "#3a8bff",
};

/** A panel destination reachable from the "More" sheet. */
export type MorePanel = "files" | "mindmap" | "agents";

function MoreRow({
  icon,
  label,
  sub,
  onClick,
  right,
}: {
  icon: IconName;
  label: string;
  sub?: string;
  onClick: () => void;
  right?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="mo-tap"
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 13, padding: "13px 16px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
    >
      <span style={{ width: 34, height: 34, flex: "none", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--panel-3)", color: "var(--fg-2)" }}>
        <Icon name={icon} size={17} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: 500, color: "var(--fg)" }}>{label}</span>
        {sub && <span style={{ display: "block", fontSize: 12, color: "var(--fg-4)" }}>{sub}</span>}
      </span>
      {right || <Icon name="chevronRight" size={17} color="var(--fg-4)" />}
    </button>
  );
}

const divider = <div style={{ height: 1, background: "var(--border-2)", margin: "0 16px 0 63px" }} />;

/**
 * "More" sheet — appearance controls (theme/accent/density, driven directly by
 * the app's useTheme() hook) plus links to the palette, Files, Mindmap, Agents,
 * and Settings.
 */
export function MoMoreSheet({
  open,
  onClose,
  onOpenPanel,
  onSettings,
  onPalette,
}: {
  open: boolean;
  onClose: () => void;
  onOpenPanel: (panel: MorePanel) => void;
  onSettings: () => void;
  onPalette: () => void;
}) {
  const { theme, accent, setAccent, density, setDensity, toggleThemeType } = useTheme();
  const isDark = theme.type !== "light";
  return (
    <MoSheet open={open} onClose={onClose} title="More">
      <div style={{ padding: "0 12px 4px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => toggleThemeType()}
            className="mo-tap"
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px 0", borderRadius: 14, cursor: "pointer", border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--fg-2)" }}
          >
            <Icon name={isDark ? "sun" : "moon"} size={20} />
            <span style={{ fontSize: 12, fontWeight: 500 }}>{isDark ? "Light" : "Dark"}</span>
          </button>
          <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--panel-2)" }}>
            <span style={{ fontSize: 11, color: "var(--fg-3)" }}>Accent</span>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {(Object.keys(ACCENT_HEX) as Accent[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setAccent(k)}
                  aria-label={k}
                  className="mo-tap"
                  style={{ width: 30, height: 30, borderRadius: 999, cursor: "pointer", background: ACCENT_HEX[k], border: accent === k ? "2px solid var(--fg)" : "2px solid transparent", boxShadow: "inset 0 1px 0 rgba(255,255,255,.3)" }}
                />
              ))}
              <span style={{ flex: 1 }} />
              <button
                onClick={() => setDensity(density === "cozy" ? "compact" : "cozy")}
                className="mo-tap"
                style={{ height: 30, padding: "0 12px", borderRadius: 999, cursor: "pointer", border: "1px solid var(--border)", background: "var(--panel-3)", color: "var(--fg-2)", fontSize: 12 }}
              >
                {density}
              </button>
            </div>
          </div>
        </div>
        <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-2)", background: "var(--panel-2)" }}>
          <MoreRow icon="search" label="Command palette" sub="Search or run a command" onClick={() => { onClose(); onPalette(); }} />
          {divider}
          <MoreRow icon="folder" label="Files" sub="Working tree & diffs" onClick={() => onOpenPanel("files")} />
          {divider}
          <MoreRow icon="waypoints" label="Mindmap" sub="Plan graph" onClick={() => onOpenPanel("mindmap")} />
          {divider}
          <MoreRow icon="users" label="Agents" sub="Definitions & roster" onClick={() => onOpenPanel("agents")} />
        </div>
        <div style={{ height: 12 }} />
        <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-2)", background: "var(--panel-2)" }}>
          <MoreRow icon="settings" label="Settings" onClick={() => { onClose(); onSettings(); }} />
        </div>
      </div>
    </MoSheet>
  );
}
