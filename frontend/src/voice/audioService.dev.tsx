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

// A short valid 16kHz mono WAV (a faint 220Hz tone, ~0.15s) so <audio> emits
// play+ended deterministically. NOTE: we use WAV (not MP3) because Playwright's
// open-source headless Chromium ships WITHOUT the proprietary MP3 decoder, so a
// data: MP3 fails with MEDIA_ERR_SRC_NOT_SUPPORTED. WAV is decodable everywhere
// (the real app's TTS still returns MP3, decoded fine by WKWebView's system
// codec). Generated with Python's wave module.
const TINY_WAV_B64 =
  "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";

const STATES: VoiceServiceState[] = ["idle", "listening", "thinking", "speaking"];

// Mock transport — used by default in the harness. Toggleable to the real
// api.ts transport via the URL flag `?real=1` (won't work outside the app).
// Tests can push strings onto window.__voiceTranscriptQueue to script what the
// next transcribe() calls return (e.g. a recording segment ending in a stop
// phrase); when the queue is empty the fixed marker is returned.
function makeMockTransport(): VoiceTransport {
  return {
    async transcribe() {
      const q = window.__voiceTranscriptQueue;
      if (Array.isArray(q) && q.length > 0) return q.shift()!;
      // Fixed marker so Playwright can assert deterministically.
      return "VOICE_TRANSCRIPT_MARKER";
    },
    async synthesize() {
      return { audioB64: TINY_WAV_B64, contentType: "audio/wav" };
    },
  };
}

declare global {
  interface Window {
    __voiceService?: IAudioService;
    __voiceState?: string;
    __voiceTranscript?: string;
    __voiceError?: string | null;
    /** Scripted transcribe() results for tests (shifted per call; empty → marker). */
    __voiceTranscriptQueue?: string[];
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
