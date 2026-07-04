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
// Mirrors the mindmap pane conventions: themed entirely with design tokens,
// rendered as a split inside SessionPanel.

import { useEffect, useRef, useState } from "react";
import VoiceOrb from "./VoiceOrb";
import { Icon } from "./Icon";
import * as api from "../api";
import { useTheme } from "../theme";
import { createAudioService } from "../voice/audioService";
import { setVoicePaneMicBusy } from "../voice/pttService";
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
  recording: "recording",
  thinking: "thinking",
  speaking: "speaking",
};

// The status dot color tracks the orb's active accent role per state.
const STATE_COLOR: Record<VoiceServiceState, string> = {
  idle: "var(--fg-3)",
  listening: "var(--accent)",
  recording: "var(--danger)",
  thinking: "var(--info)",
  speaking: "var(--ok)",
};

/** mm:ss for the recording elapsed indicator. */
function formatElapsed(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// WI-5.5: map an error kind to an actionable, human banner. `title` is short
// (status bar), `detail` is the actionable line, `action` (optional) hints what
// the user should do. Themed with --* by the renderer.
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

// "Voice not configured" gate: local STT/TTS endpoints aren't set yet.
const NOT_CONFIGURED: BannerCopy = {
  title: "voice not configured",
  detail:
    "Set your local Whisper (STT) and Kokoro (TTS) URLs in Settings → Voice to start talking.",
};

export function VoicePane({ sessionId, className, style }: Props) {
  const { theme } = useTheme();
  const [state, setState] = useState<VoiceServiceState>("idle");
  const [error, setError] = useState<VoiceError | null>(null);
  // Transcript is persisted per session (localStorage) so it survives pane
  // close/reopen, tab switches, and refreshes. Hydrate from storage on mount.
  const [lines, setLines] = useState<TranscriptLine[]>(() => loadTranscript(sessionId));
  // WI-5.5: "voice not configured" gate (local STT/TTS URLs missing).
  const [notConfigured, setNotConfigured] = useState(false);

  // Device selection + live input metering.
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [hasLabels, setHasLabels] = useState(true);
  // 0..METER_SEGMENTS-1 lit segments, driven by getInputLevel() via rAF.
  const [meterLevel, setMeterLevel] = useState(0);
  // Seconds elapsed in the current recording (drives the mm:ss indicator).
  const [recordSecs, setRecordSecs] = useState(0);
  // Live draft transcript while recording: the accumulated text so far, grown
  // segment by segment as each STT resolves (onRecordingTranscript). Rendered
  // as an in-progress `you ▸` line; removed when the final transcript line
  // lands (onUserTranscript) so there's never a duplicate.
  const [draft, setDraft] = useState("");

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
    // `alive` guards every async continuation: if the effect is torn down before
    // (or while) the service is being created, we skip wiring and dispose. The
    // cleanup runs whatever has registered into `cleanupFns` by tear-down time.
    let alive = true;
    const cleanupFns: Array<() => void> = [];

    // The rAF meter starts immediately and tolerates serviceRef.current being
    // briefly null (config load is async, so the service isn't created yet).
    // getInputLevel() reads whichever analyser is live (preview or an active
    // listen turn), so the bar keeps moving across states once the service is up.
    let raf = 0;
    const tick = () => {
      const svc = serviceRef.current;
      const lvl = svc ? svc.getInputLevel() : 0;
      // Light segments proportional to level; small noise floor so an idle mic
      // shows ~0 segments rather than flicker.
      const lit = lvl <= 0.02 ? 0 : Math.max(1, Math.round(lvl * METER_SEGMENTS));
      setMeterLevel((prev) => (prev === lit ? prev : lit));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    void (async () => {
      // Load the saved voice/speed/pause config FIRST so the service honors the
      // user's chosen voice, playback speed, and VAD redemption (pause tolerance)
      // window. The settings apply when the service initializes (pane open /
      // session switch / refresh) — we do NOT live-reinit the VAD.
      let options: Parameters<typeof createAudioService>[0];
      try {
        const cfg = await api.getConfig();
        options = {
          bargeIn: false,
          voice: cfg.voice?.voice || undefined,
          speed: cfg.voice?.speed || undefined,
          // `?? undefined` (not `||`) so a legitimately-saved 0 pause isn't
          // conflated with "unset" (the slider min is 500 today, but be safe).
          vad: { redemptionMs: cfg.voice?.pauseMs ?? undefined },
        };
        // Voice now runs on the embedded managed runtime — there are no
        // user-facing endpoint URLs to be missing, so the old "not configured"
        // URL gate is gone (the state stays false; install/readiness issues
        // surface through Settings → Voice instead).
      } catch {
        options = { bargeIn: false };
      }
      // The effect may have been torn down while getConfig was in flight.
      if (!alive) return;

      // Default transport = the real api.ts Wails-bridged STT/TTS proxy.
      // Half-duplex by default (barge-in OFF): the agent speaks its full reply,
      // then listens. Barge-in (talking over the agent) requires reliable acoustic
      // echo cancellation or headphones — on open speakers the mic re-captures the
      // agent's own TTS and the VAD self-interrupts, cutting replies mid-word. We
      // keep echoCancellation on the mic + a barge-in guard window as defenses, but
      // default to half-duplex so the conversation is robust on any audio setup.
      const service = createAudioService(options);
      serviceRef.current = service;

      // The orb is driven entirely by the per-frame orbGetLevel callback below,
      // so we don't hand it AnalyserNodes per state transition (which would force
      // an extra re-render the orb ignores).
      // Mirror non-idle states into the shared PTT flag so push-to-talk won't
      // grab the mic while this pane owns a turn.
      const offState = service.onState((s) => {
        setState(s);
        setVoicePaneMicBusy(s !== "idle");
      });
      const offError = service.onError((e) => setError(e));
      // Live recording draft: the service emits the accumulated transcript as
      // each segment's STT resolves ("" on reset → clears the draft).
      const offRecTranscript = service.onRecordingTranscript((text) => setDraft(text));

      // Bridge: Go MCP voice tools → this pane's audio service. The transcript
      // callbacks surface each turn into the conversation view.
      const offBridge = registerVoiceBridge(sessionId, service, {
        onUserTranscript: (text) => {
          // The final line replaces the in-progress draft (no duplicate).
          setDraft("");
          addLine("you", text);
        },
        onAgentSpeak: (text) => addLine("quant", text),
      });

      // Device list: query now, refresh on hotplug. startInputPreview() opens the
      // mic + an analyser purely for metering so the user can SEE the chosen mic
      // is receiving audio while the pane is open and idle (before any real turn).
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

      // WKWebView (and browser autoplay policies) keep an AudioContext created
      // without a user gesture in the "suspended" state, which leaves the input
      // analyser flat → the live meter and the orb's listening level read zero.
      // Resume on the first real interaction anywhere in the window.
      const unlock = () => {
        void service.resumeContext();
      };
      window.addEventListener("pointerdown", unlock, { capture: true });
      window.addEventListener("keydown", unlock, { capture: true });

      // Register service-dependent teardown. If the effect already cleaned up
      // while we were awaiting config (alive flipped false above we returned),
      // this block isn't reached; otherwise cleanup runs these on tear-down.
      cleanupFns.push(() => {
        window.removeEventListener("pointerdown", unlock, { capture: true });
        window.removeEventListener("keydown", unlock, { capture: true });
        offDevices();
        service.stopInputPreview();
        offBridge();
        offState();
        offError();
        offRecTranscript();
        setVoicePaneMicBusy(false);
        void service.dispose();
        serviceRef.current = null;
      });
    })();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      // Run whatever service-dependent teardown was registered. If the service
      // was never created (effect torn down before config resolved), there's
      // nothing here and serviceRef.current stays null — no leak.
      for (const fn of cleanupFns) fn();
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

  // Toggle long-form recording on the active listen turn. Start is sync; stop
  // flushes/joins the segments and resolves the listen (state → thinking).
  const handleToggleRecording = () => {
    const svc = serviceRef.current;
    if (!svc) return;
    if (svc.isRecording()) {
      void svc.stopRecording();
    } else {
      svc.startRecording();
    }
  };

  // Tick the mm:ss elapsed indicator while recording.
  useEffect(() => {
    if (state !== "recording") {
      setRecordSecs(0);
      return;
    }
    const startedAt = Date.now();
    setRecordSecs(0);
    const t = setInterval(() => {
      setRecordSecs(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [state]);

  // The draft only makes sense while recording (and through the brief
  // "thinking" after stop, until the final line arrives). Any other state means
  // the turn ended some other way (cancel/error/no speech) — drop the draft.
  useEffect(() => {
    if (state !== "recording" && state !== "thinking") setDraft("");
  }, [state]);

  // The in-progress recording draft, shown while recording + the post-stop
  // thinking beat. Empty (no segment recognized yet / user never spoke) → no
  // draft line at all.
  const showDraft = !!draft.trim() && (state === "recording" || state === "thinking");

  // Keep the newest transcript line in view (scroll to bottom on append —
  // including when the live draft appears/grows).
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, draft, showDraft]);

  // (The "voice not configured" gate is derived in the service-init effect above
  // from the same getConfig() it already performs — see setNotConfigured there.)

  // Orb stage backing. In DARK themes the stage is just the plain app
  // background (var(--bg)) — no purple tint. In LIGHT themes the neon orb
  // needs a dark-ish backing to read, so keep the dark "well" gradient. Read
  // once per render off the active design tokens (a full theme-type flip
  // re-renders the pane).
  const stageIsLight = theme.type === "light";
  const stageBackground = stageIsLight
    ? "radial-gradient(circle at 50% 47%, #140e22 0%, #15121f 22%, #0c0a14 55%, #07060c 100%)"
    : "var(--bg)";

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        backgroundColor: "var(--bg)",
        fontFamily: "var(--sans)",
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
          borderBottom: "1px solid var(--border-2)",
          overflow: "hidden",
        }}
      >
        {/* The orb canvas fills the ENTIRE stage (full width + height), not a
            centered square. This makes the scene background + starfield "dust"
            extend edge-to-edge so there's no visible square seam against the
            pane background. The orb's perspective camera uses the live w/h aspect
            (camera.aspect = w/h), so the sphere itself stays perfectly circular
            and centered no matter how wide the pane is — it just gets more dusty
            space around it. The orb resizes with the stage via its ResizeObserver. */}
        <VoiceOrb
          state={state}
          getLevel={orbGetLevel}
          themeKey={theme.id}
          style={{ position: "absolute", inset: 0 }}
        />
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
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 11,
        }}
      >
        {lines.length === 0 && !showDraft ? (
          <div
            style={{
              color: "var(--fg-4)",
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
                <div style={{ color: "var(--fg-2)", marginBottom: 4 }}>
                  {NOT_CONFIGURED.title}
                </div>
                {NOT_CONFIGURED.detail}
              </>
            ) : (
              <>
                <div style={{ color: "var(--fg-2)", marginBottom: 4 }}>
                  open mic to start talking
                </div>
                say something and quant will reply — the orb lights up while it listens.
              </>
            )}
          </div>
        ) : (
          <>
            {lines.map((line) => (
              <div key={line.id} style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
                <span
                  style={{
                    flex: "none",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    paddingTop: 1,
                    color: line.who === "you" ? "var(--accent)" : "var(--info)",
                  }}
                >
                  {line.who} ▸
                </span>
                <span
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.55,
                    color: "var(--fg-2)",
                    overflowWrap: "anywhere",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {line.text}
                </span>
              </div>
            ))}
            {/* Live recording draft: same `you ▸` layout as a real line, but
                dimmed + italic to read as in-progress. It grows as each speech
                segment is transcribed and is replaced by the final line on stop. */}
            {showDraft && (
              <div
                style={{
                  display: "flex",
                  gap: 9,
                  alignItems: "baseline",
                  opacity: 0.72,
                }}
              >
                <span
                  style={{
                    flex: "none",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    paddingTop: 1,
                    color: "var(--accent)",
                  }}
                >
                  you ▸
                </span>
                <span
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.55,
                    fontStyle: "italic",
                    color: "var(--fg-2)",
                    overflowWrap: "anywhere",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {draft}
                  <span style={{ color: "var(--fg-4)", fontStyle: "normal" }}>
                    {state === "recording" ? " · listening…" : " · finishing…"}
                  </span>
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* WI-5.5: actionable banner for the active error or the not-configured
          gate. Sits above the status bar; dismissible for errors. */}
      {(() => {
        const banner = error ? errorCopy(error) : notConfigured ? NOT_CONFIGURED : null;
        if (!banner) return null;
        const isWarn = notConfigured && !error;
        const accent = isWarn ? "var(--warn)" : "var(--danger)";
        return (
          <div
            role="alert"
            style={{
              flex: "0 0 auto",
              padding: "8px 14px",
              borderTop: `1px solid ${accent}`,
              backgroundColor: "var(--panel)",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: accent }}>{banner.title}</div>
              <div style={{ fontSize: 11, lineHeight: 1.45, color: "var(--fg-2)" }}>
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
                  color: "var(--fg-4)",
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
          minHeight: 34,
          backgroundColor: "var(--panel)",
          borderTop: "1px solid var(--border-2)",
        }}
      >
        <span
          title="microphone"
          style={{
            flex: "none",
            fontSize: 10.5,
            color: "var(--fg-3)",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Icon name="mic" size={13} />
          mic
        </span>

        {devices.length === 0 ? (
          <span style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
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
              fontFamily: "var(--sans)",
              fontSize: 11,
              color: "var(--fg-2)",
              backgroundColor: "var(--panel-2)",
              border: "1px solid var(--border-2)",
              borderRadius: 7,
              padding: "3px 7px",
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
          style={{ flex: "none", display: "flex", alignItems: "center", gap: 2 }}
        >
          {Array.from({ length: METER_SEGMENTS }).map((_, i) => {
            const on = i < meterLevel;
            // Green → amber → red gradient across the bar.
            const color =
              i < METER_SEGMENTS * 0.6
                ? "var(--ok)"
                : i < METER_SEGMENTS * 0.85
                  ? "var(--warn)"
                  : "var(--danger)";
            return (
              <span
                key={i}
                style={{
                  width: 3,
                  height: 11,
                  borderRadius: 1,
                  backgroundColor: on ? color : "var(--border)",
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
              fontFamily: "var(--sans)",
              fontSize: 10.5,
              color: "var(--accent)",
              backgroundColor: "var(--panel-3)",
              border: "1px solid var(--border-2)",
              borderRadius: 7,
              padding: "3px 7px",
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
          height: 32,
          backgroundColor: "var(--panel)",
          borderTop: "1px solid var(--border-2)",
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
          <span
            style={{
              fontSize: 11,
              color: "var(--fg-2)",
              textTransform: "capitalize",
            }}
          >
            {STATE_LABEL[state]}
          </span>

          {/* Record toggle: visible while a listen turn is active. Pressing it
              pins the turn open (recording: speak as long as you want, across
              pauses); pressing again stops + finalizes the full transcript. */}
          {(state === "listening" || state === "recording") && (
            <button
              onClick={handleToggleRecording}
              title={
                state === "recording"
                  ? "stop recording and send the full transcript (you can also say 'stop recording')"
                  : "record a long message (keeps listening across pauses until you tap stop or say 'stop recording')"
              }
              style={{
                flex: "none",
                marginLeft: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontFamily: "var(--sans)",
                fontSize: 10.5,
                color: "var(--danger)",
                backgroundColor: "var(--panel-3)",
                border:
                  state === "recording"
                    ? "1px solid var(--danger)"
                    : "1px solid var(--border-2)",
                borderRadius: 7,
                padding: "1px 6px",
                cursor: "pointer",
              }}
            >
              {state === "recording" ? (
                <>
                  <span style={{ fontSize: 9, lineHeight: 1 }}>■</span>
                  stop
                  <span style={{ color: "var(--fg-2)" }}>
                    {formatElapsed(recordSecs)}
                  </span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 9, lineHeight: 1 }}>●</span>
                  rec
                </>
              )}
            </button>
          )}
        </div>

        {error ? (
          <span
            title={error.message}
            style={{
              fontSize: 10,
              color: "var(--danger)",
              maxWidth: "70%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {errorCopy(error).title}
          </span>
        ) : notConfigured ? (
          <span style={{ fontSize: 10, color: "var(--warn)" }}>not configured</span>
        ) : (
          <span style={{ fontSize: 10, color: "var(--fg-4)" }}>mic ready</span>
        )}
      </div>
    </div>
  );
}

export default VoicePane;
