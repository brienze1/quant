import React, { useRef } from "react";
import type { ResolvedTheme, VSCodeTheme } from "../theme/types";
import { useTheme } from "../theme";
import type { Accent, Density } from "../theme/store";
import { Icon } from "./Icon";
import { Segmented } from "./Segmented";

// Preset cards drive the design-system data-attributes (data-theme / data-accent)
// via toggleThemeType + setAccent. type = dark|light, accent = emerald|iris|blue.
const THEME_PRESETS: { id: string; name: string; type: "dark" | "light"; accent: Accent }[] = [
  { id: "quant-dark", name: "quant dark", type: "dark", accent: "emerald" },
  { id: "quant-light", name: "quant light", type: "light", accent: "emerald" },
  { id: "iris-dark", name: "iris", type: "dark", accent: "iris" },
  { id: "blue-dark", name: "ocean", type: "dark", accent: "blue" },
];

const ACCENT_HEXES: Record<Accent, string> = {
  emerald: "#2ed3a0",
  iris: "#7b7bff",
  blue: "#3a8bff",
};

export function ThemeSettings() {
  const {
    theme,
    themes,
    setTheme,
    importTheme,
    removeTheme,
    accent,
    setAccent,
    density,
    setDensity,
  } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The theme `type` (dark/light) is sourced from the active resolved theme so
  // preset selection highlights correctly even after a VS Code import.
  const themeType = theme.type;

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text) as VSCodeTheme;
      if (!json.colors || typeof json.colors !== "object") {
        alert("Invalid theme file: missing 'colors' object");
        return;
      }
      if (!json.name) json.name = file.name.replace(/\.json$/, "");
      if (!json.type) json.type = "dark";
      importTheme(json);
    } catch (err) {
      alert("Failed to parse theme file: " + String(err));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Selecting a preset activates the matching builtin theme (so it also leaves
  // any imported theme, even one of the same dark/light type) and sets the
  // accent. Both builtins are tuned to the static design palette, so the accent
  // picker drives the accent on top.
  function selectPreset(p: { type: "dark" | "light"; accent: Accent }) {
    setTheme(p.type === "light" ? "quant-light" : "quant-dark");
    setAccent(p.accent);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* Header */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--accent)", fontWeight: 700 }}>~</span>
          <span style={{ color: "var(--fg)", fontWeight: 700, fontSize: 13 }}>theme</span>
        </div>
        <p style={{ color: "var(--fg-4)", fontSize: 11.5, marginTop: 6 }}>
          select a theme or import a VS Code theme (.json)
        </p>
      </div>

      {/* Preset grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
        {THEME_PRESETS.map((p) => (
          <PresetCard
            key={p.id}
            preset={p}
            active={themeType === p.type && accent === p.accent}
            onSelect={() => selectPreset(p)}
          />
        ))}

        {/* Import card */}
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            minHeight: 120,
            border: "1px dashed var(--border)",
            borderRadius: 10,
            background: "transparent",
            color: "var(--fg-4)",
            cursor: "pointer",
            fontFamily: "var(--mono)",
            fontSize: 12,
            transition: "all .15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.color = "var(--accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.color = "var(--fg-4)";
          }}
        >
          <Icon name="upload" size={22} />
          import .json
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={handleImport}
      />

      {/* Density */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>density</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--fg-4)" }}>// row + padding scale</span>
        </div>
        <Segmented
          options={[
            { value: "cozy", label: "cozy" },
            { value: "compact", label: "compact" },
          ]}
          value={density}
          onChange={(v) => setDensity(v as Density)}
        />
      </div>

      {/* Imported VS Code themes (terminal / editor palettes) */}
      {themes.some((t) => !t.isBuiltin) && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>imported palettes</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--fg-4)" }}>// VS Code terminal + editor colors</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
            {themes
              .filter((t) => !t.isBuiltin)
              .map((t) => (
                <VSCodeCard
                  key={t.id}
                  theme={t}
                  isActive={t.id === theme.id}
                  onSelect={() => setTheme(t.id)}
                  onDelete={() => removeTheme(t.id)}
                />
              ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div style={{ padding: 12, borderRadius: 9, background: "var(--panel)", border: "1px solid var(--border)" }}>
        <p style={{ color: "var(--fg-3)", fontSize: 11.5, margin: 0, lineHeight: 1.6 }}>
          you can import any VS Code color theme (.json file). the format uses the standard{" "}
          <span style={{ color: "var(--accent)" }}>colors</span> object with keys like{" "}
          <span style={{ color: "var(--fg)" }}>editor.background</span>,{" "}
          <span style={{ color: "var(--fg)" }}>sideBar.background</span>, etc. download themes from the VS Code
          marketplace or export them from your editor.
        </p>
      </div>
    </div>
  );
}

// PresetCard previews a dark/light × accent preset using inline hex (the preview
// is intentionally theme-independent so all four cards read distinctly).
function PresetCard({
  preset,
  active,
  onSelect,
}: {
  preset: { name: string; type: "dark" | "light"; accent: Accent };
  active: boolean;
  onSelect: () => void;
}) {
  const dark = preset.type === "dark";
  const bg = dark ? "#15181a" : "#f4f5f3";
  const surf = dark ? "#1b1f21" : "#e9ebe7";
  const fgM = dark ? "#5a625e" : "#b8bcb6";
  const lineC = dark ? "#2a2f2c" : "#d8dad4";
  const acc = ACCENT_HEXES[preset.accent];
  return (
    <div
      onClick={onSelect}
      style={{
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color .15s ease",
      }}
    >
      <div style={{ display: "flex", height: 78, background: bg }}>
        <div style={{ width: 38, background: surf, borderRight: `1px solid ${lineC}`, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ width: 12, height: 3, borderRadius: 1, background: acc }} />
          {[20, 16, 24, 14].map((w, i) => (
            <div key={i} style={{ width: w, height: 3, borderRadius: 1, background: fgM }} />
          ))}
        </div>
        <div style={{ flex: 1, padding: 7, display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", gap: 2, marginBottom: 2 }}>
            <div style={{ width: 20, height: 4, borderRadius: 1, background: acc }} />
            <div style={{ width: 16, height: 4, borderRadius: 1, background: fgM }} />
          </div>
          {["70%", "50%", "85%", "40%"].map((w, i) => (
            <div key={i} style={{ width: w, height: 3, borderRadius: 1, background: i === 1 ? acc : fgM }} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: surf, borderTop: `1px solid ${lineC}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {active && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />}
          <span className="mono" style={{ fontSize: 11, fontWeight: active ? 700 : 400, color: dark ? "#e7ebe9" : "#1a1d1b" }}>
            {preset.name}
          </span>
          <span className="mono" style={{ fontSize: 9, color: fgM }}>{preset.type}</span>
        </div>
      </div>
    </div>
  );
}

// VSCodeCard previews an imported VS Code theme using its own resolved colors.
function VSCodeCard({
  theme,
  isActive,
  onSelect,
  onDelete,
}: {
  theme: ResolvedTheme;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const c = theme.colors;
  return (
    <div
      onClick={onSelect}
      style={{
        position: "relative",
        border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color .15s ease",
      }}
    >
      <div style={{ display: "flex", height: 78, background: c.bg }}>
        <div style={{ width: 38, background: c.bgSurface, borderRight: `1px solid ${c.border}`, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ width: 12, height: 3, borderRadius: 1, background: c.accent }} />
          {[20, 16, 24, 14].map((w, i) => (
            <div key={i} style={{ width: w, height: 3, borderRadius: 1, background: c.fgMuted }} />
          ))}
        </div>
        <div style={{ flex: 1, padding: 7, display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", gap: 2, marginBottom: 2 }}>
            <div style={{ width: 20, height: 4, borderRadius: 1, background: c.accent }} />
            <div style={{ width: 16, height: 4, borderRadius: 1, background: c.fgMuted }} />
          </div>
          {["70%", "50%", "85%", "40%"].map((w, i) => (
            <div key={i} style={{ width: w, height: 3, borderRadius: 1, background: i === 1 ? c.accent : c.fgMuted }} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: c.bgSurface, borderTop: `1px solid ${c.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {isActive && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />}
          <span className="mono" style={{ fontSize: 11, fontWeight: isActive ? 700 : 400, color: isActive ? "var(--fg)" : "var(--fg-2)" }}>
            {theme.name}
          </span>
          <span className="mono" style={{ fontSize: 9, color: "var(--fg-4)" }}>{theme.type}</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{ background: "none", border: "none", color: "var(--fg-4)", cursor: "pointer", fontSize: 11, fontFamily: "var(--mono)", padding: "2px 4px" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--fg-4)")}
        >
          x
        </button>
      </div>
    </div>
  );
}
