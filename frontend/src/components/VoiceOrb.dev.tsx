import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import VoiceOrb, { VoiceOrbState } from "./VoiceOrb";

// Dev harness for the VoiceOrb. Mounts the component with buttons to switch the
// 4 states and a couple of theme presets that inject sample --q-* tokens onto
// <html> (the same place ThemeProvider writes them in-app), so we can validate
// the dark + light glow recipes without the full quant app.
//
// Run: npx vite --config vite.orb.config.ts  (serves on :5180)

interface Preset {
  id: string;
  label: string;
  type: "dark" | "light";
  vars: Record<string, string>;
}

const PRESETS: Preset[] = [
  {
    id: "quant-dark",
    label: "dark (emerald)",
    type: "dark",
    vars: {
      "--q-bg": "#0A0A0A",
      "--q-accent": "#10B981",
      "--q-blue": "#06B6D4",
      "--q-cyan": "#06B6D4",
      "--q-warning": "#F59E0B",
    },
  },
  {
    id: "monokai",
    label: "dark (monokai)",
    type: "dark",
    vars: {
      "--q-bg": "#272822",
      "--q-accent": "#A6E22E",
      "--q-blue": "#66D9EF",
      "--q-cyan": "#66D9EF",
      "--q-warning": "#FD971F",
    },
  },
  {
    id: "quiet-light",
    label: "light (quiet light)",
    type: "light",
    vars: {
      "--q-bg": "#F5F5F5",
      "--q-accent": "#7A3E9D",
      "--q-blue": "#4B69C6",
      "--q-cyan": "#4B69C6",
      "--q-warning": "#9C5D27",
    },
  },
];

const STATES: VoiceOrbState[] = ["idle", "listening", "thinking", "speaking"];

function applyPreset(p: Preset) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(p.vars)) root.style.setProperty(k, v);
  root.setAttribute("data-theme-type", p.type);
}

function Harness() {
  const [state, setState] = useState<VoiceOrbState>("listening");
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const preset = PRESETS.find((p) => p.id === presetId)!;

  useEffect(() => {
    applyPreset(preset);
  }, [preset]);

  const appBg = preset.type === "light" ? "#F5F5F5" : preset.vars["--q-bg"];
  const appFg = preset.type === "light" ? "#333" : "#FAFAFA";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: appBg,
        color: appFg,
        fontFamily: "monospace",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        VoiceOrb dev harness — state: <b>{state}</b> · theme: <b>{preset.label}</b>
      </div>

      {/* Mirror the real VoicePane geometry: a 220×220 orb centered in a 240px
          dark "well" (10px margin each side). This makes the visual baselines
          and the flare-containment check representative of production — the
          speaking flare must stay inside the well, not bleed to the frame. */}
      <div
        data-orb-stage
        style={{
          width: 240,
          height: 240,
          borderRadius: 12,
          border: `1px solid ${preset.type === "light" ? "#D4D4D4" : "#2a2a2a"}`,
          // Exact production well gradient (VoicePane.tsx).
          background:
            "radial-gradient(circle at 50% 47%, #140e22 0%, #15121f 22%, #0c0a14 55%, #07060c 100%)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: 220, height: 220 }}>
          <VoiceOrb state={state} themeKey={presetId} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {STATES.map((s) => (
          <button
            key={s}
            data-state-btn={s}
            onClick={() => setState(s)}
            style={btnStyle(state === s, preset)}
          >
            {s}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            data-preset-btn={p.id}
            onClick={() => setPresetId(p.id)}
            style={btnStyle(presetId === p.id, preset)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function btnStyle(active: boolean, preset: Preset): React.CSSProperties {
  return {
    fontFamily: "monospace",
    fontSize: 11,
    padding: "7px 12px",
    borderRadius: 3,
    cursor: "pointer",
    background: preset.type === "light" ? "#ECECEC" : "#0F0F0F",
    color: active ? preset.vars["--q-accent"] : preset.type === "light" ? "#6B6B6B" : "#6B7280",
    border: `1px solid ${active ? preset.vars["--q-accent"] : preset.type === "light" ? "#D4D4D4" : "#2a2a2a"}`,
  };
}

createRoot(document.getElementById("root")!).render(<Harness />);
