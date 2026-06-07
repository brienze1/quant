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
import { readOrbTheme } from "./voiceOrbTheme";
import * as api from "../api";
import { createAudioService } from "../voice/audioService";
import { registerVoiceBridge } from "../voice/voiceBridge";
import { loadTranscript, saveTranscript, nextLineId } from "../voice/transcriptStore";
import type {
  AudioInputDevice,
  IAudioService,
  VoiceError,
  VoiceServiceState,
} from "../voice/types";

// Number of segments in the live input-level meter.
const METER_SEGMENTS = 12;

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

// WI-5.5: map an error kind to an actionable, human banner. `title` is short
// (status bar), `detail` is the actionable line, `action` (optional) hints what
// the user should do. Themed with --q-* by the renderer.
interface BannerCopy {
  title: string;
  detail: string;
}

function errorCopy(err: VoiceError): BannerCopy {
  switch (err.kind) {
    case "permission":
      return {
        title: "microphone blocked",
        detail: "Allow microphone access for quant in your OS/browser settings, then try again.",
      };
    case "network":
      return {
        title: "voice service unreachable",
        detail: "Couldn't reach the speech service. Check your connection / provider URL in Settings → Voice.",
      };
    case "stt":
      return {
        title: "transcription failed",
        detail: "The speech-to-text request failed. Check your STT model + key in Settings → Voice.",
      };
    case "tts":
      return {
        title: "speech synthesis failed",
        detail: "The text-to-speech request failed. Check your TTS model + key in Settings → Voice.",
      };
    case "playback":
      return {
        title: "playback failed",
        detail: "Couldn't play the audio reply. Check your output device.",
      };
    case "vad":
      return {
        title: "voice detector unavailable",
        detail: "The voice-activity detector failed to load. Reopen the pane to retry.",
      };
    case "timeout":
      return {
        title: "didn't catch that",
        detail:
          "No speech was heard. Tap to try again and speak after the orb turns on." +
          // Append the live diagnostic snapshot (ctx/mic/peakIn/vadStart) so a
          // copy-pasted report pinpoints which layer is dead on WebKit.
          (err.message && err.message.includes("[") ? `  ⟨${err.message.split("[")[1]?.replace("]", "") ?? ""}⟩` : ""),
      };
    default:
      return { title: "voice error", detail: err.message || "Something went wrong." };
  }
}

// "Voice not configured" gate: cloud provider with no saved key can't work.
const NOT_CONFIGURED: BannerCopy = {
  title: "voice not configured",
  detail: "Add an API key in Settings → Voice to start talking.",
};

export function VoicePane({ sessionId, className, style }: Props) {
  const [state, setState] = useState<VoiceServiceState>("idle");
  const [error, setError] = useState<VoiceError | null>(null);
  // Transcript is persisted per session (localStorage) so it survives pane
  // close/reopen, tab switches, and refreshes. Hydrate from storage on mount.
  const [lines, setLines] = useState<TranscriptLine[]>(() => loadTranscript(sessionId));
  // WI-5.5: "voice not configured" gate (cloud provider without a saved key).
  const [notConfigured, setNotConfigured] = useState(false);
  // The orb wants the input analyser while listening and the output analyser
  // while speaking; null otherwise (orb falls back to its simulated envelope).
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // Device selection + live input metering.
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [hasLabels, setHasLabels] = useState(true);
  // 0..METER_SEGMENTS-1 lit segments, driven by getInputLevel() via rAF.
  const [meterLevel, setMeterLevel] = useState(0);

  const serviceRef = useRef<IAudioService | null>(null);
  // Live mirror of `state` for the orb's per-frame level callback (avoids stale
  // closures without re-creating the callback).
  const stateRef = useRef(state);
  stateRef.current = state;
  // Stable per-frame level source for the orb: output level while speaking,
  // input level otherwise. Reading the live service every frame sidesteps the
  // fragile per-state AnalyserNode handoff that left the orb flat after turn 1.
  const orbGetLevel = useRef(() => {
    const svc = serviceRef.current;
    if (!svc) return null;
    if (stateRef.current === "speaking") return svc.getOutputLevel();
    // Input: make the orb noticeably reactive to normal speech. getInputLevel()
    // peaks are small for conversational volume, so noise-gate a small floor
    // then apply a perceptual curve + gain so quiet/mid speech clearly drives
    // the orb while idle room noise stays flat.
    const raw = svc.getInputLevel();
    // Noise-gate a small floor (kills idle room noise + AGC drift), then shape
    // the level with a perceptual curve + modest gain. The gate keeps idle flat;
    // the near-linear exponent (0.85) gives a gentle early lift without slamming
    // the orb to max, and the moderate gain (1.55) maps conversational volume
    // (raw ~0.3) to mid-range (~0.48) while only loud speech (raw ~0.6) nears 1.0
    // — saturation now sits at raw ~0.65 instead of ~0.31. The orb's tick applies
    // fast-attack/slow-release smoothing on top, so this stays snappy.
    const gated = Math.max(0, raw - 0.05);
    if (gated <= 0) return 0;
    return Math.min(1, Math.pow(gated, 0.85) * 1.55);
  }).current;
  const transcriptRef = useRef<HTMLDivElement>(null);
  const lineIdRef = useRef(nextLineId(lines));
  // Which session the current `lines` belong to. Guards the persist effect from
  // writing the prior session's transcript under a newly-switched sessionId
  // before the reload effect swaps `lines` in.
  const linesSessionRef = useRef(sessionId);

  const addLine = (who: TranscriptLine["who"], text: string) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    setLines((prev) => [...prev, { id: lineIdRef.current++, who, text: trimmed }]);
  };

  // One AudioService per pane: created on mount, bridge registered, disposed on
  // unmount. Re-created if the session changes (each pane owns its own session).
  useEffect(() => {
    // Default transport = the real api.ts Wails-bridged STT/TTS proxy.
    // Half-duplex by default (barge-in OFF): the agent speaks its full reply,
    // then listens. Barge-in (talking over the agent) requires reliable acoustic
    // echo cancellation or headphones — on open speakers the mic re-captures the
    // agent's own TTS and the VAD self-interrupts, cutting replies mid-word. We
    // keep echoCancellation on the mic + a barge-in guard window as defenses, but
    // default to half-duplex so the conversation is robust on any audio setup.
    const service = createAudioService({ bargeIn: false });
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

    // Device list: query now, refresh on hotplug. startInputPreview() opens the
    // mic + an analyser purely for metering so the user can SEE the chosen mic
    // is receiving audio while the pane is open and idle (before any real turn).
    let alive = true;
    const refreshDevices = async () => {
      try {
        const [list, labels] = await Promise.all([
          service.listInputDevices(),
          service.hasDeviceLabels(),
        ]);
        if (!alive) return;
        setDevices(list);
        setHasLabels(labels);
        setSelectedDevice(service.getInputDevice());
      } catch {
        /* leave prior state */
      }
    };
    const offDevices = service.onDevicesChanged(() => void refreshDevices());
    void refreshDevices();
    // Best-effort live preview meter. If permission isn't granted this rejects
    // quietly (the onError handler surfaces the banner); the "Enable microphone"
    // affordance lets the user prompt explicitly.
    void service
      .startInputPreview()
      .then(() => void refreshDevices())
      .catch(() => {});

    // Animate the input-level meter while the pane is mounted. getInputLevel()
    // reads whichever analyser is live (preview or an active listen turn), so
    // the bar keeps moving across states without opening the mic twice.
    let raf = 0;
    const tick = () => {
      const lvl = service.getInputLevel();
      // Light segments proportional to level; small noise floor so an idle mic
      // shows ~0 segments rather than flicker.
      const lit = lvl <= 0.02 ? 0 : Math.max(1, Math.round(lvl * METER_SEGMENTS));
      setMeterLevel((prev) => (prev === lit ? prev : lit));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // WKWebView (and browser autoplay policies) keep an AudioContext created
    // without a user gesture in the "suspended" state, which leaves the input
    // analyser flat → the live meter and the orb's listening level read zero.
    // Resume on the first real interaction anywhere in the window.
    const unlock = () => {
      void service.resumeContext();
    };
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
      offDevices();
      service.stopInputPreview();
      offBridge();
      offState();
      offError();
      void service.dispose();
      serviceRef.current = null;
    };
  }, [sessionId]);

  // Each pane owns one session; when the session changes, swap in that session's
  // persisted transcript (and reset the id counter to stay unique).
  useEffect(() => {
    const restored = loadTranscript(sessionId);
    lineIdRef.current = nextLineId(restored);
    linesSessionRef.current = sessionId;
    setLines(restored);
  }, [sessionId]);

  // Persist the transcript on every change so it survives close/reopen/refresh.
  // Skip while `lines` still belong to a prior session (post-switch, pre-reload).
  useEffect(() => {
    if (linesSessionRef.current !== sessionId) return;
    saveTranscript(sessionId, lines);
  }, [sessionId, lines]);

  // Switch the active input device + persist it (audioService writes localStorage).
  const handleSelectDevice = (deviceId: string) => {
    const svc = serviceRef.current;
    if (!svc) return;
    const next = deviceId || null;
    setSelectedDevice(next);
    // This click is a user gesture — unlock the (possibly suspended) context so
    // the meter starts moving on the newly selected device.
    void svc.resumeContext();
    void svc.setInputDevice(next).catch(() => {});
  };

  // Explicit permission prompt: getUserMedia via a preview opens the OS prompt
  // and, once granted, populates real device labels — then we refresh the list.
  const handleEnableMic = () => {
    const svc = serviceRef.current;
    if (!svc) return;
    void (async () => {
      try {
        await svc.startInputPreview();
        await svc.resumeContext();
        const [list, labels] = await Promise.all([
          svc.listInputDevices(),
          svc.hasDeviceLabels(),
        ]);
        setDevices(list);
        setHasLabels(labels);
        setSelectedDevice(svc.getInputDevice());
        setError(null);
      } catch {
        /* onError already surfaced the permission banner */
      }
    })();
  };

  // Keep the newest transcript line in view (scroll to bottom on append).
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // WI-5.5: detect "voice not configured" (cloud/auto provider with no saved
  // key) so we can show an actionable banner instead of a cryptic network error
  // on the first turn. Local provider with a base URL needs no key.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const cfg = await api.getConfig();
        const v = cfg.voice;
        if (!alive || !v) return;
        const needsKey = v.provider !== "local";
        const hasUrl = !!(v.baseUrl && v.baseUrl.trim());
        setNotConfigured(needsKey && !v.hasApiKey && !hasUrl);
      } catch {
        // If config can't be read, don't block the pane — leave the gate off.
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  // Orb stage backing. In DARK themes the stage is just the plain app
  // background (var(--q-bg)) — no purple tint. In LIGHT themes the neon orb
  // needs a dark-ish backing to read, so keep the dark "well" gradient. Read
  // once per render off the active --q-* tokens (a full theme-type flip
  // re-renders the pane).
  const stageIsLight =
    typeof document !== "undefined" ? readOrbTheme().isLight : false;
  const stageBackground = stageIsLight
    ? "radial-gradient(circle at 50% 47%, #140e22 0%, #15121f 22%, #0c0a14 55%, #07060c 100%)"
    : "var(--q-bg)";

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
      {/* Orb stage: shares the pane's vertical space with the transcript and
          grows/shrinks as the pane is resized. The orb fills this container
          responsively (no fixed size) via its own ResizeObserver. Background is
          the plain app bg in dark themes, a dark well only in light themes. */}
      <div
        style={{
          // Grows with the pane (weight 2 vs the transcript's 3 → ~40% of the
          // shared space) but never collapses: minHeight is a hard floor so a
          // long transcript can't squeeze the orb to zero height (it scrolls
          // instead). This keeps the orb dynamic AND always visible.
          flex: "2 1 0",
          minHeight: 200,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: stageBackground,
          borderBottom: "1px solid var(--q-border)",
          overflow: "hidden",
        }}
      >
        {/* Square, centered orb box that tracks the SMALLER stage dimension so
            the orb stays circular + contained in any aspect ratio: height:100%
            + aspectRatio:1 makes width follow height, and maxWidth:100% clamps
            it (shrinking height to match) when the stage is taller than wide. No
            fixed size — the orb fills this box and resizes via its ResizeObserver. */}
        <div
          style={{
            height: "100%",
            aspectRatio: "1 / 1",
            maxWidth: "100%",
            minHeight: 0,
          }}
        >
          <VoiceOrb state={state} analyser={analyser} getLevel={orbGetLevel} />
        </div>
      </div>

      {/* Transcript: paired you/quant lines, scrollable, newest at bottom. */}
      <div
        ref={transcriptRef}
        style={{
          // Grow-driven basis (0, not auto) so a tall transcript scrolls within
          // its share instead of stealing the orb's space. Weight 3 → ~60%.
          flex: "3 1 0",
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
              lineHeight: 1.6,
              margin: "auto",
              textAlign: "center",
              maxWidth: 240,
            }}
          >
            {/* WI-5.5 idle/empty state. */}
            {notConfigured ? (
              <>
                <div style={{ color: "var(--q-fg-secondary)", marginBottom: 4 }}>
                  {NOT_CONFIGURED.title}
                </div>
                {NOT_CONFIGURED.detail}
              </>
            ) : (
              <>
                <div style={{ color: "var(--q-fg-secondary)", marginBottom: 4 }}>
                  open mic to start talking
                </div>
                say something and quant will reply — the orb lights up while it listens.
              </>
            )}
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

      {/* WI-5.5: actionable banner for the active error or the not-configured
          gate. Sits above the status bar; dismissible for errors. */}
      {(() => {
        const banner = error ? errorCopy(error) : notConfigured ? NOT_CONFIGURED : null;
        if (!banner) return null;
        const isWarn = notConfigured && !error;
        const accent = isWarn ? "var(--q-warning)" : "var(--q-error)";
        return (
          <div
            role="alert"
            style={{
              flex: "0 0 auto",
              padding: "8px 12px",
              borderTop: `1px solid ${accent}`,
              backgroundColor: "var(--q-bg-input)",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: accent }}>{banner.title}</div>
              <div style={{ fontSize: 11, lineHeight: 1.45, color: "var(--q-fg-secondary)" }}>
                {banner.detail}
              </div>
            </div>
            {error && (
              <button
                onClick={() => setError(null)}
                title="dismiss"
                style={{
                  flex: "none",
                  background: "transparent",
                  border: "none",
                  color: "var(--q-fg-muted)",
                  cursor: "pointer",
                  fontSize: 13,
                  lineHeight: 1,
                  padding: 2,
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })()}

      {/* Mic toolbar: device selector + live input-level meter. Lets the user
          SEE the available mics, choose one, and confirm it's picking up audio
          (the meter moves while they speak) before/while talking. When the
          browser hasn't granted permission yet (no labels), show an explicit
          "Enable microphone" affordance that prompts + populates labels. */}
      <div
        className="flex items-center gap-2 px-3 shrink-0"
        style={{
          minHeight: 30,
          backgroundColor: "var(--q-bg-input)",
          borderTop: "1px solid var(--q-border)",
        }}
      >
        <span
          title="microphone"
          style={{ flex: "none", fontSize: 11, color: "var(--q-fg-muted)" }}
        >
          mic
        </span>

        {devices.length === 0 ? (
          <span style={{ fontSize: 10.5, color: "var(--q-fg-muted)" }}>
            no microphones found
          </span>
        ) : (
          <select
            value={selectedDevice ?? ""}
            onChange={(e) => handleSelectDevice(e.target.value)}
            title="select input device"
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              maxWidth: 200,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              color: "var(--q-fg)",
              backgroundColor: "var(--q-bg)",
              border: "1px solid var(--q-border)",
              borderRadius: 4,
              padding: "2px 4px",
            }}
          >
            <option value="">system default</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        )}

        {/* Live input-level meter: segments light up with getInputLevel(). */}
        <div
          aria-label="input level"
          title="input level"
          style={{ flex: "none", display: "flex", alignItems: "center", gap: 1.5 }}
        >
          {Array.from({ length: METER_SEGMENTS }).map((_, i) => {
            const on = i < meterLevel;
            // Green → amber → red gradient across the bar.
            const color =
              i < METER_SEGMENTS * 0.6
                ? "var(--q-term-green)"
                : i < METER_SEGMENTS * 0.85
                  ? "var(--q-warning)"
                  : "var(--q-error)";
            return (
              <span
                key={i}
                style={{
                  width: 3,
                  height: 10,
                  borderRadius: 1,
                  backgroundColor: on ? color : "var(--q-border)",
                  opacity: on ? 1 : 0.5,
                  transition: "background-color .05s linear, opacity .05s linear",
                }}
              />
            );
          })}
        </div>

        {!hasLabels && (
          <button
            onClick={handleEnableMic}
            title="grant microphone access to list and meter devices"
            style={{
              flex: "none",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              color: "var(--q-term-green)",
              backgroundColor: "var(--q-bg-hover)",
              border: "1px solid var(--q-border)",
              borderRadius: 4,
              padding: "2px 6px",
              cursor: "pointer",
            }}
          >
            enable microphone
          </button>
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
            {errorCopy(error).title}
          </span>
        ) : notConfigured ? (
          <span style={{ fontSize: 10, color: "var(--q-warning)" }}>not configured</span>
        ) : (
          <span style={{ fontSize: 10, color: "var(--q-fg-muted)" }}>mic ready</span>
        )}
      </div>
    </div>
  );
}

export default VoicePane;
