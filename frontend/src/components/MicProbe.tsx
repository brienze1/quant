// ⚠️ SPIKE PROBE — getUserMedia / WKWebView de-risk (voice feature P0).
// Self-contained, dev-only. Safe to delete. Calls getUserMedia({audio:true})
// and reports success (track label) or the exact DOMException name on screen
// + console. See voice-orchestrator feature plan.
//
// Trigger: a small floating "🎤 mic probe" button in the bottom-right corner.
// It is rendered unconditionally so it works in both `wails dev` and a prod
// build; remove the <MicProbe /> mount in App.tsx to disable.

import { useState } from "react";

type ProbeResult =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; label: string; trackCount: number; secureContext: boolean }
  | { kind: "error"; name: string; message: string; secureContext: boolean };

export function MicProbe() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ProbeResult>({ kind: "idle" });

  async function runProbe() {
    setResult({ kind: "running" });
    const secureContext = window.isSecureContext;
    // eslint-disable-next-line no-console
    console.log("[MicProbe] origin=", window.location.href, "isSecureContext=", secureContext);
    console.log("[MicProbe] navigator.mediaDevices=", navigator.mediaDevices);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw Object.assign(new Error("navigator.mediaDevices.getUserMedia is undefined"), {
          name: "NotSupportedError",
        });
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tracks = stream.getAudioTracks();
      const label = tracks[0]?.label || "(no label / permission-limited)";
      // eslint-disable-next-line no-console
      console.log("[MicProbe] SUCCESS tracks=", tracks.length, "label=", label, tracks);
      setResult({ kind: "ok", label, trackCount: tracks.length, secureContext });
      // stop tracks so we don't hold the mic open
      tracks.forEach((t) => t.stop());
    } catch (err: unknown) {
      const e = err as DOMException;
      const name = e?.name || "UnknownError";
      const message = e?.message || String(err);
      // eslint-disable-next-line no-console
      console.error("[MicProbe] FAILED name=", name, "message=", message, err);
      setResult({ kind: "error", name, message, secureContext });
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 99999,
        fontFamily: "monospace",
        fontSize: 12,
      }}
    >
      {open && (
        <div
          style={{
            marginBottom: 8,
            width: 320,
            padding: 12,
            background: "#111",
            color: "#eee",
            border: "1px solid #444",
            borderRadius: 8,
            boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>🎤 getUserMedia probe (spike)</div>
          <button
            onClick={runProbe}
            style={{
              cursor: "pointer",
              padding: "6px 10px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              marginBottom: 8,
            }}
          >
            Run getUserMedia({"{ audio:true }"})
          </button>
          <div>
            {result.kind === "idle" && <span style={{ color: "#888" }}>Not run yet.</span>}
            {result.kind === "running" && <span style={{ color: "#fbbf24" }}>Requesting…</span>}
            {result.kind === "ok" && (
              <div style={{ color: "#34d399" }}>
                ✅ SUCCESS<br />
                tracks: {result.trackCount}<br />
                label: {result.label}<br />
                secureContext: {String(result.secureContext)}
              </div>
            )}
            {result.kind === "error" && (
              <div style={{ color: "#f87171" }}>
                ❌ {result.name}<br />
                {result.message}<br />
                secureContext: {String(result.secureContext)}
              </div>
            )}
          </div>
          <div style={{ marginTop: 8, color: "#666", fontSize: 10 }}>
            origin: {window.location.origin || window.location.href}
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          cursor: "pointer",
          padding: "6px 10px",
          background: "#333",
          color: "#fff",
          border: "1px solid #555",
          borderRadius: 6,
        }}
      >
        🎤 mic probe
      </button>
    </div>
  );
}
