// VoicePane (WI-3.1).
//
// The per-session voice surface: an audio-reactive orb on a dark "well", a clean
// `you ▸` / `quant ▸` transcript, and a listen/status bar showing the current
// state + mic/permission/error indicator.
//
// It owns ONE AudioService for its lifetime (created in a ref on mount, disposed
// on unmount), registers the voice bridge so the Go-side MCP voice tools can
// drive listen()/speak() through the browser pipeline, and surfaces the spoken
// turns into the transcript via the bridge's transcript callbacks.
//
// Mirrors the mindmap pane conventions: themed entirely with --q-* tokens,
// rendered as a split inside SessionPanel.

import { useEffect, useRef, useState } from "react";
import VoiceOrb from "./VoiceOrb";
import { createAudioService } from "../voice/audioService";
import { registerVoiceBridge } from "../voice/voiceBridge";
import type { IAudioService, VoiceError, VoiceServiceState } from "../voice/types";

interface TranscriptLine {
  id: number;
  who: "you" | "quant";
  text: string;
}

interface Props {
  sessionId: string;
  className?: string;
  style?: React.CSSProperties;
}

const STATE_LABEL: Record<VoiceServiceState, string> = {
  idle: "idle",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
};

// The status dot color tracks the orb's active accent role per state.
const STATE_COLOR: Record<VoiceServiceState, string> = {
  idle: "var(--q-fg-muted)",
  listening: "var(--q-accent)",
  thinking: "var(--q-blue)",
  speaking: "var(--q-term-green)",
};

export function VoicePane({ sessionId, className, style }: Props) {
  const [state, setState] = useState<VoiceServiceState>("idle");
  const [error, setError] = useState<VoiceError | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  // The orb wants the input analyser while listening and the output analyser
  // while speaking; null otherwise (orb falls back to its simulated envelope).
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const serviceRef = useRef<IAudioService | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const lineIdRef = useRef(0);

  const addLine = (who: TranscriptLine["who"], text: string) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    setLines((prev) => [...prev, { id: lineIdRef.current++, who, text: trimmed }]);
  };

  // One AudioService per pane: created on mount, bridge registered, disposed on
  // unmount. Re-created if the session changes (each pane owns its own session).
  useEffect(() => {
    // Default transport = the real api.ts Wails-bridged STT/TTS proxy.
    const service = createAudioService();
    serviceRef.current = service;

    const offState = service.onState((s) => {
      setState(s);
      // Pick the analyser relevant to the current state for the orb.
      setAnalyser(s === "speaking" ? service.getOutputAnalyser() : service.getInputAnalyser());
    });
    const offError = service.onError((e) => setError(e));

    // Bridge: Go MCP voice tools → this pane's audio service. The transcript
    // callbacks surface each turn into the conversation view.
    const offBridge = registerVoiceBridge(sessionId, service, {
      onUserTranscript: (text) => addLine("you", text),
      onAgentSpeak: (text) => addLine("quant", text),
    });

    return () => {
      offBridge();
      offState();
      offError();
      void service.dispose();
      serviceRef.current = null;
    };
  }, [sessionId]);

  // Keep the newest transcript line in view (scroll to bottom on append).
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        backgroundColor: "var(--q-bg)",
        fontFamily: "'JetBrains Mono', monospace",
        ...style,
      }}
    >
      {/* Orb stage: a dark radial well (the orb needs a dark stage even in light
          themes). Square-ish, centered, sized to the pane width. */}
      <div
        style={{
          flex: "0 0 auto",
          position: "relative",
          height: 240,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(circle at 50% 47%, #140e22 0%, #15121f 22%, #0c0a14 55%, #07060c 100%)",
          borderBottom: "1px solid var(--q-border)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: 220, height: 220 }}>
          <VoiceOrb state={state} analyser={analyser} />
        </div>
      </div>

      {/* Transcript: paired you/quant lines, scrollable, newest at bottom. */}
      <div
        ref={transcriptRef}
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {lines.length === 0 ? (
          <div
            style={{
              color: "var(--q-fg-muted)",
              fontSize: 11.5,
              lineHeight: 1.5,
              margin: "auto",
              textAlign: "center",
            }}
          >
            no conversation yet — start talking and quant will reply.
          </div>
        ) : (
          lines.map((line) => (
            <div key={line.id} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span
                style={{
                  flex: "none",
                  fontSize: 11,
                  fontWeight: 700,
                  color: line.who === "you" ? "var(--q-accent)" : "var(--q-term-green)",
                }}
              >
                {line.who} ▸
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: "var(--q-fg)",
                  overflowWrap: "anywhere",
                  whiteSpace: "pre-wrap",
                }}
              >
                {line.text}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Listen/status bar: current state + mic/permission/error indicator. */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{
          height: 28,
          backgroundColor: "var(--q-bg-input)",
          borderTop: "1px solid var(--q-border)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: STATE_COLOR[state],
              boxShadow:
                state !== "idle" ? `0 0 6px ${STATE_COLOR[state]}` : "none",
              transition: "background-color .2s ease, box-shadow .2s ease",
            }}
          />
          <span style={{ fontSize: 10.5, color: "var(--q-fg-secondary)" }}>
            {STATE_LABEL[state]}
          </span>
        </div>

        {error ? (
          <span
            title={error.message}
            style={{
              fontSize: 10,
              color: "var(--q-error)",
              maxWidth: "70%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {error.kind === "permission" ? "mic blocked" : error.kind}: {error.message}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: "var(--q-fg-muted)" }}>mic ready</span>
        )}
      </div>
    </div>
  );
}

export default VoicePane;
