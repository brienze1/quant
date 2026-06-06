import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import VoiceOrb from "../components/VoiceOrb";
import { AudioService } from "./audioService";
import type { IAudioService, VoiceServiceState, VoiceTransport } from "./types";

// Dev harness for the frontend audio service (WI-2.2).
//
// Run: npx vite --config vite.audio.config.ts   (serves on :5181)
//
// It does NOT depend on the Wails bridge: a mock transport is injected so the
// service is hermetic outside the desktop app. The mock returns a fixed
// transcript marker and a tiny valid MP3 for synthesize. The real service +
// the live AnalyserNodes still run, so the VAD/STT/playback path is exercised
// end to end with Chromium fake-audio.
//
// Playwright globals exposed on `window`:
//   window.__voiceService  — the live IAudioService instance
//   window.__voiceState    — last state string
//   window.__voiceTranscript — last transcript from listen()
//   window.__voiceError    — last error message (or null)

// A 0.1s silent MP3 (valid frames) so <audio> emits play+ended deterministically.
const TINY_MP3_B64 =
  "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxAADwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

const STATES: VoiceServiceState[] = ["idle", "listening", "thinking", "speaking"];

// Mock transport — used by default in the harness. Toggleable to the real
// api.ts transport via the URL flag `?real=1` (won't work outside the app).
function makeMockTransport(): VoiceTransport {
  return {
    async transcribe() {
      // Fixed marker so Playwright can assert deterministically.
      return "VOICE_TRANSCRIPT_MARKER";
    },
    async synthesize() {
      return { audioB64: TINY_MP3_B64, contentType: "audio/mpeg" };
    },
  };
}

declare global {
  interface Window {
    __voiceService?: IAudioService;
    __voiceState?: string;
    __voiceTranscript?: string;
    __voiceError?: string | null;
  }
}

function Harness() {
  const [state, setState] = useState<VoiceServiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("hello from the voice service");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const svcRef = useRef<IAudioService | null>(null);

  useEffect(() => {
    // Apply a dark theme so the orb well looks right.
    const root = document.documentElement;
    root.style.setProperty("--q-bg", "#0A0A0A");
    root.style.setProperty("--q-accent", "#10B981");
    root.style.setProperty("--q-blue", "#06B6D4");
    root.style.setProperty("--q-cyan", "#06B6D4");
    root.style.setProperty("--q-warning", "#F59E0B");
    root.setAttribute("data-theme-type", "dark");

    const useReal = new URLSearchParams(location.search).get("real") === "1";
    const svc = new AudioService(useReal ? {} : { transport: makeMockTransport() });
    svcRef.current = svc;
    window.__voiceService = svc;
    window.__voiceState = "idle";
    window.__voiceError = null;

    const offState = svc.onState((s) => {
      setState(s);
      window.__voiceState = s;
      // Pick the relevant analyser for the orb when it becomes available.
      setAnalyser(s === "speaking" ? svc.getOutputAnalyser() : svc.getInputAnalyser());
    });
    const offError = svc.onError((e) => {
      setError(e.message);
      window.__voiceError = e.message;
    });

    return () => {
      offState();
      offError();
      void svc.dispose();
    };
  }, []);

  const onListen = async () => {
    setError(null);
    window.__voiceError = null;
    try {
      const t = await svcRef.current!.listen();
      setTranscript(t);
      window.__voiceTranscript = t;
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e);
      setError(msg);
      window.__voiceError = msg;
    }
  };

  const onSpeak = async () => {
    setError(null);
    window.__voiceError = null;
    try {
      await svcRef.current!.speak(text);
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e);
      setError(msg);
      window.__voiceError = msg;
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0A0A0A",
        color: "#FAFAFA",
        fontFamily: "monospace",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: 24,
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.7 }}>audioService dev harness</div>

      <div style={{ width: 320, height: 320, borderRadius: 12, overflow: "hidden" }}>
        <VoiceOrb state={state} analyser={analyser} />
      </div>

      <div id="state" data-testid="state">
        state: {state}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {STATES.map((s) => (
          <span key={s} style={{ opacity: state === s ? 1 : 0.3, fontSize: 11 }}>
            {s}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button id="listen-btn" data-testid="listen" onClick={onListen} style={btn}>
          Listen
        </button>
      </div>

      <div id="transcript" data-testid="transcript" style={{ minHeight: 18, fontSize: 13 }}>
        {transcript}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          id="speak-text"
          data-testid="speak-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{
            background: "#111",
            color: "#eee",
            border: "1px solid #333",
            padding: "6px 8px",
            fontFamily: "monospace",
            width: 280,
          }}
        />
        <button id="speak-btn" data-testid="speak" onClick={onSpeak} style={btn}>
          Speak
        </button>
      </div>

      <div id="error" data-testid="error" style={{ color: "#F87171", minHeight: 18, fontSize: 12 }}>
        {error ?? ""}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 12,
  padding: "8px 14px",
  borderRadius: 4,
  cursor: "pointer",
  background: "#0F0F0F",
  color: "#10B981",
  border: "1px solid #10B981",
};

createRoot(document.getElementById("root")!).render(<Harness />);
