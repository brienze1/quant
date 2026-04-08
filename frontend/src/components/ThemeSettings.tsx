import React, { useRef } from "react";
import type { ResolvedTheme, VSCodeTheme } from "../theme/types";
import { useTheme } from "../theme";

export function ThemeSettings() {
  const { theme, themes, setTheme, importTheme, removeTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Section: Current Theme */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ color: "var(--q-accent)", fontWeight: 700 }}>~</span>
          <span style={{ color: "var(--q-fg)", fontWeight: 700, fontSize: 13 }}>theme</span>
        </div>
        <p style={{ color: "var(--q-fg-muted)", fontSize: 11, marginBottom: 16 }}>
          Select a theme or import a VS Code theme (.json)
        </p>
      </div>

      {/* Theme Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        {themes.map((t) => (
          <ThemeCard
            key={t.id}
            theme={t}
            isActive={t.id === theme.id}
            onSelect={() => setTheme(t.id)}
            onDelete={t.isBuiltin ? undefined : () => removeTheme(t.id)}
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
            padding: 16,
            border: "1px dashed var(--q-border)",
            borderRadius: 8,
            backgroundColor: "transparent",
            color: "var(--q-fg-muted)",
            cursor: "pointer",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            minHeight: 120,
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--q-accent)";
            e.currentTarget.style.color = "var(--q-accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--q-border)";
            e.currentTarget.style.color = "var(--q-fg-muted)";
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>import .json</span>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={handleImport}
      />

      {/* Info */}
      <div style={{
        padding: 12,
        borderRadius: 6,
        backgroundColor: "var(--q-bg-surface)",
        border: "1px solid var(--q-border)",
      }}>
        <p style={{ color: "var(--q-fg-secondary)", fontSize: 11, margin: 0, lineHeight: 1.6 }}>
          You can import any VS Code color theme (.json file). The theme format uses the standard VS Code{" "}
          <span style={{ color: "var(--q-accent)" }}>colors</span> object with keys like{" "}
          <span style={{ color: "var(--q-fg)" }}>editor.background</span>,{" "}
          <span style={{ color: "var(--q-fg)" }}>sideBar.background</span>, etc.
          Download themes from the VS Code marketplace or export them from your editor.
        </p>
      </div>
    </div>
  );
}

function ThemeCard({
  theme,
  isActive,
  onSelect,
  onDelete,
}: {
  theme: ResolvedTheme;
  isActive: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const c = theme.colors;

  return (
    <div
      onClick={onSelect}
      style={{
        position: "relative",
        border: `1px solid ${isActive ? "var(--q-accent)" : "var(--q-border)"}`,
        borderRadius: 8,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.borderColor = "var(--q-fg-secondary)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.borderColor = "var(--q-border)";
      }}
    >
      {/* Mini preview */}
      <div style={{
        display: "flex",
        height: 80,
        backgroundColor: c.bg,
      }}>
        {/* Mini sidebar */}
        <div style={{ width: 40, backgroundColor: c.bgSurface, borderRight: `1px solid ${c.border}`, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ width: 12, height: 3, borderRadius: 1, backgroundColor: c.accent }} />
          <div style={{ width: 20, height: 3, borderRadius: 1, backgroundColor: c.fgMuted }} />
          <div style={{ width: 16, height: 3, borderRadius: 1, backgroundColor: c.fgMuted }} />
          <div style={{ width: 24, height: 3, borderRadius: 1, backgroundColor: c.bgHover }} />
          <div style={{ width: 14, height: 3, borderRadius: 1, backgroundColor: c.fgMuted }} />
        </div>
        {/* Mini editor */}
        <div style={{ flex: 1, padding: 6, display: "flex", flexDirection: "column", gap: 3 }}>
          {/* Tab bar */}
          <div style={{ display: "flex", gap: 2, marginBottom: 2 }}>
            <div style={{ width: 20, height: 4, borderRadius: 1, backgroundColor: c.accent }} />
            <div style={{ width: 16, height: 4, borderRadius: 1, backgroundColor: c.fgMuted }} />
          </div>
          {/* Code lines */}
          <div style={{ width: "70%", height: 3, borderRadius: 1, backgroundColor: c.fgTertiary }} />
          <div style={{ width: "50%", height: 3, borderRadius: 1, backgroundColor: c.accent }} />
          <div style={{ width: "85%", height: 3, borderRadius: 1, backgroundColor: c.fgMuted }} />
          <div style={{ width: "40%", height: 3, borderRadius: 1, backgroundColor: c.warning }} />
          <div style={{ width: "60%", height: 3, borderRadius: 1, backgroundColor: c.fgTertiary }} />
        </div>
      </div>

      {/* Label bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 10px",
        backgroundColor: c.bgSurface,
        borderTop: `1px solid ${c.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {isActive && (
            <div style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: "var(--q-accent)",
            }} />
          )}
          <span style={{
            fontSize: 11,
            fontWeight: isActive ? 700 : 400,
            color: isActive ? "var(--q-fg)" : "var(--q-fg-secondary)",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {theme.name}
          </span>
          <span style={{
            fontSize: 9,
            color: "var(--q-fg-muted)",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {theme.type}
          </span>
        </div>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            style={{
              background: "none",
              border: "none",
              color: "var(--q-fg-muted)",
              cursor: "pointer",
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              padding: "2px 4px",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-error)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-muted)")}
          >
            x
          </button>
        )}
      </div>
    </div>
  );
}
