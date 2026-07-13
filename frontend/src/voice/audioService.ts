// Frontend audio service (WI-2.2).
//
// Owns the browser-side voice pipeline:
//   capture (getUserMedia + AudioContext/AnalyserNode)
//   → VAD endpointing (@ricky0123/vad-web, Silero, self-hosted assets)
//   → STT (Go proxy via injectable transport)
//   → TTS playback (Go proxy → <audio>, routed through an AnalyserNode)
//
// Pure TS, no React/DOM-component imports, so it is drivable from a dev harness,
// Playwright, and VoicePane.tsx. STT/TTS transport is injectable so tests can
// pass mocks instead of the Wails-bridged api.ts wrappers.

import { MicVAD, utils } from "@ricky0123/vad-web";
import * as api from "../api";
import type {
  AudioInputDevice,
  AudioServiceOptions,
  DevicesChangedCb,
  IAudioService,
  ListenOptions,
  RecordingTranscriptCb,
  VadTuning,
  VoiceError,
  VoiceErrorCb,
  VoiceServiceState,
  VoiceStateCb,
  VoiceTransport,
} from "./types";
import { playTransitionCue, playErrorCue } from "./voiceCues";

// Derive the VAD asset path from Vite's base URL so it resolves correctly under
// a non-root base (the remote PWA is served from `/quant-remote/`, where a
// root-absolute `/vad/` would 404). Desktop's base is `/`, so this stays `/vad/`.
const DEFAULT_VAD_ASSET_PATH = `${import.meta.env.BASE_URL}vad/`;

// iOS/WebKit and installed PWAs need TTS played through a BARE <audio> element
// rather than routed through Web Audio: Web Audio output is muted by the iPhone
// ring/silent switch and is silent while the AudioContext is suspended (which it
// is for agent-initiated playback that has no user gesture in its call stack).
// A native media element plays through the silent switch and doesn't depend on a
// running context. Desktop keeps the Web Audio route (orb output reactivity, no
// silent switch). Best-effort — any detection failure falls back to desktop.
function prefersNativePlayback(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    const ua: string = nav.userAgent || "";
    const iOS =
      /iP(hone|ad|od)/.test(ua) ||
      // iPadOS 13+ reports as MacIntel but is touch-capable.
      (nav.platform === "MacIntel" && (nav.maxTouchPoints || 0) > 1);
    const standalone =
      (typeof window !== "undefined" &&
        (window.matchMedia?.("(display-mode: standalone)").matches ||
          nav.standalone === true)) ||
      false;
    return Boolean(iOS || standalone);
  } catch {
    return false;
  }
}

// A ~0.1s silent 8-bit mono WAV, built once. Played (unmuted, inaudible) inside a
// user gesture to satisfy iOS's per-element autoplay unlock so a later agent-
// initiated `.play()` on the SAME reused element is allowed.
let SILENT_WAV_CACHE: string | null = null;
function silentWavDataUri(): string {
  if (SILENT_WAV_CACHE) return SILENT_WAV_CACHE;
  const sampleRate = 8000;
  const samples = 800; // 0.1s
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + samples, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate, true); // byte rate (8-bit mono)
  v.setUint16(32, 1, true); // block align
  v.setUint16(34, 8, true); // bits/sample
  w(36, "data");
  v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128); // 8-bit silence
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  SILENT_WAV_CACHE = "data:audio/wav;base64," + btoa(bin);
  return SILENT_WAV_CACHE;
}
// Overall cap on a single listen() turn (no speech-end within this window →
// timeout). Generous so a long, paused explanation isn't cut off by the ceiling;
// the redemption window (above) handles normal turn-taking well before this.
const DEFAULT_MAX_LISTEN_MS = 60_000;
// Safety ceiling for an explicit recording (user-pinned listen). Recording is
// only ended by the user's stop, so this just guards against a forgotten
// recording holding the mic forever; on expiry it finalizes with whatever was
// captured so far.
const RECORDING_MAX_MS = 15 * 60_000;
// After flushing a mid-speech segment on stopRecording (vad.pause with
// submitUserSpeechOnPause), give the onSpeechEnd callback a beat to enqueue its
// transcription before we snapshot the segment list.
const RECORDING_FLUSH_GRACE_MS = 80;
/** Barge-in is suppressed for this long after TTS playback starts (see handleSpeechStart). */
const BARGE_IN_GUARD_MS = 1200;
// Hands-free stop phrases for recording mode. When a recording segment's STT
// result ENDS with one of these (case-insensitive, trailing punctuation
// ignored), the phrase is stripped from the segment and the recording is
// finalized exactly as if the user pressed "■ stop". Matching is deliberately
// conservative: the phrase must be the END of the segment (a whole-word tail),
// so mentioning "stop recording" mid-sentence never cuts a dictation short.
const RECORDING_STOP_PHRASES = [
  "stop recording",
  "stop the recording",
  "end recording",
  "end the recording",
  "finish recording",
  "stop dictation",
] as const;
/**
 * Upper bound the orb stays in the post-listen "thinking" state after STT
 * resolves while the agent reasons (and may run tools), before the next
 * speak()/listen() request arrives. Caps the case where the conversation ends
 * and no further turn comes (pane left open) so the orb eventually relaxes to
 * idle. 45s comfortably exceeds a normal reasoning+tool turn so it won't
 * prematurely cut a real think. A real listen()/speak()/barge-in transition
 * clears this via setState() before it fires.
 */
const MAX_THINKING_MS = 45_000;

/** localStorage key for the (browser/machine-scoped) selected input deviceId. */
const INPUT_DEVICE_LS_KEY = "quant.voice.inputDeviceId";

export function readPersistedInputDevice(): string | null {
  try {
    const v = window.localStorage.getItem(INPUT_DEVICE_LS_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

function writePersistedInputDevice(deviceId: string | null): void {
  try {
    if (deviceId) window.localStorage.setItem(INPUT_DEVICE_LS_KEY, deviceId);
    else window.localStorage.removeItem(INPUT_DEVICE_LS_KEY);
  } catch {
    /* ignore — persistence is best-effort */
  }
}

// VAD endpointing defaults (WI-5.6), tuned for conversational turn-taking:
// a slightly-strict positive threshold to avoid triggering on room noise, a
// very generous ~3000ms redemption so the user can pause to THINK mid-thought
// while explaining something WITHOUT the turn ending under them (conversational
// thinking pauses routinely run 2-3s), a short pre-speech pad so the first
// phoneme isn't clipped, and a min-speech floor so coughs/clicks misfire instead
// of being transcribed.
const VAD_DEFAULTS: Required<Omit<VadTuning, "sensitivity">> = {
  positiveSpeechThreshold: 0.6,
  negativeSpeechThreshold: 0.45,
  redemptionMs: 3000,
  preSpeechPadMs: 160,
  minSpeechMs: 250,
};

// Silero frame size by model (samples per frame at 16 kHz). v5 requires 512
// (32ms/frame); the legacy v4 model uses 1536 (96ms/frame). The endpointing
// windows below are specified in ms and converted to frames against this.
const VAD_SAMPLE_RATE = 16_000;
const FRAME_SAMPLES_BY_MODEL: Record<"v5" | "legacy", number> = {
  v5: 512,
  legacy: 1536,
};

/**
 * Resolve the VAD tuning into the concrete FrameProcessorOptions subset that
 * @ricky0123/vad-web accepts. Explicit thresholds win; otherwise `sensitivity`
 * (0..1, default 0.5) derives them around the default positive threshold.
 *
 * IMPORTANT: vad-web's frame processor takes *frame counts* (redemptionFrames,
 * preSpeechPadFrames, minSpeechFrames), NOT milliseconds. Passing `*Ms` keys is
 * silently ignored and the library falls back to its defaults (redemption ≈ 8
 * frames ≈ 256ms — which cut users off mid-sentence). We therefore convert each
 * ms window to frames using the model's frame size, and pin `frameSamples` so
 * the conversion and the runtime agree.
 */
function resolveVadOptions(
  tuning: VadTuning | undefined,
  frameSamples: number,
) {
  const t = tuning ?? {};
  let positive = t.positiveSpeechThreshold;
  let negative = t.negativeSpeechThreshold;
  if (positive === undefined && t.sensitivity !== undefined) {
    const s = Math.max(0, Math.min(1, t.sensitivity));
    // sensitivity 0→0.85 (strict), 0.5→0.6 (default), 1→0.35 (eager).
    positive = 0.85 - s * 0.5;
  }
  if (positive === undefined) positive = VAD_DEFAULTS.positiveSpeechThreshold;
  if (negative === undefined) {
    // Silero convention: 0.15 below positive (clamped to a sane floor).
    negative = Math.max(0.2, positive - 0.15);
  }
  const msPerFrame = (frameSamples / VAD_SAMPLE_RATE) * 1000;
  const framesFor = (ms: number) => Math.max(1, Math.round(ms / msPerFrame));
  return {
    positiveSpeechThreshold: positive,
    negativeSpeechThreshold: negative,
    frameSamples,
    redemptionFrames: framesFor(t.redemptionMs ?? VAD_DEFAULTS.redemptionMs),
    preSpeechPadFrames: framesFor(t.preSpeechPadMs ?? VAD_DEFAULTS.preSpeechPadMs),
    minSpeechFrames: framesFor(t.minSpeechMs ?? VAD_DEFAULTS.minSpeechMs),
  };
}

/**
 * Join recording segment texts into the final transcript: trim each, drop
 * empties (failed segments resolve to ""), newline-separate. `null` slots
 * (STT still in flight) are simply omitted. Used by BOTH the live
 * onRecordingTranscript emission and stopRecording()'s final resolve so the
 * two can never diverge.
 */
function joinSegmentTexts(texts: ReadonlyArray<string | null>): string {
  return texts
    .map((t) => (t ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Detect a hands-free stop phrase at the END of a recording segment's
 * transcript. Returns the segment text with the phrase (and any separating /
 * trailing punctuation) stripped, plus whether a phrase matched. A segment that
 * is ONLY the stop phrase strips to "" (the slot is dropped by
 * joinSegmentTexts). The phrase must be a whole-word tail — "nonstop recording"
 * does not match.
 */
function stripStopPhrase(text: string): { text: string; matched: boolean } {
  // Ignore trailing whitespace + punctuation (STT often appends "." or "!").
  const trimmed = text.replace(/[\s.,!?…;:]+$/u, "");
  const lower = trimmed.toLowerCase();
  for (const phrase of RECORDING_STOP_PHRASES) {
    if (!lower.endsWith(phrase)) continue;
    const cut = trimmed.length - phrase.length;
    // Whole-word tail only: the phrase must start the string or follow a
    // non-alphanumeric character.
    if (cut > 0 && /[a-z0-9]/i.test(trimmed[cut - 1])) continue;
    // Keep the prefix, dropping the punctuation/whitespace that separated it
    // from the phrase ("…and that's all, stop recording" → "…and that's all").
    const prefix = trimmed.slice(0, cut).replace(/[\s.,!?…;:—–-]+$/u, "");
    return { text: prefix, matched: true };
  }
  return { text, matched: false };
}

// Browser audio-processing chain shared by every mic open (voice pane + PTT).
// echoCancellation keeps speaker-played TTS out of the capture; noise
// suppression + auto gain improve STT quality.
const MIC_PROCESSING = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const;

function micConstraints(deviceId: string | null): MediaStreamConstraints {
  return {
    audio: deviceId ? { ...MIC_PROCESSING, deviceId: { exact: deviceId } } : { ...MIC_PROCESSING },
  };
}

/**
 * Open the mic for `deviceId` (null = browser default) with the shared
 * processing chain, falling back to the default device when the requested one
 * is gone/unavailable. Standalone so non-VAD captures (PTT) reuse the exact
 * device handling the voice pane uses.
 */
export async function openMicStreamFor(deviceId: string | null): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(micConstraints(deviceId));
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (deviceId && (name === "OverconstrainedError" || name === "NotFoundError")) {
      return navigator.mediaDevices.getUserMedia(micConstraints(null));
    }
    throw e;
  }
}

/** Default transport = the real Wails-bridged api.ts wrappers. */
const defaultTransport: VoiceTransport = {
  transcribe: (audioB64, mime, lang) => api.transcribe(audioB64, mime, lang),
  synthesize: (text, voice, speed, lang) => api.synthesize(text, voice, speed, lang),
};

export class AudioService implements IAudioService {
  private readonly transport: VoiceTransport;
  private readonly vadAssetPath: string;
  private readonly onnxWasmPath: string;
  private readonly vadModel: "v5" | "legacy";
  private readonly maxListenMs: number;
  // Mutable so the session voice pane can switch language (and its per-language
  // voice/speed) live via setLanguage() without recreating the service.
  private voice: string;
  private speed: number;
  private lang: string;
  private readonly vadOptions: ReturnType<typeof resolveVadOptions>;
  private bargeIn: boolean;
  private bargeInGuardMs: number;

  // Active input deviceId override (null = browser default). Initialised from
  // the explicit option, else persisted localStorage value, else null.
  private inputDeviceId: string | null;

  private state: VoiceServiceState = "idle";
  // Single in-flight bound on the post-listen "thinking" state (see
  // MAX_THINKING_MS / armThinkingTimeout). Cancelled on any real transition.
  private thinkingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stateCbs = new Set<VoiceStateCb>();
  private readonly errorCbs = new Set<VoiceErrorCb>();
  private readonly devicesChangedCbs = new Set<DevicesChangedCb>();

  // Capture graph.
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  // Muted sink that keeps the input analyser in the render graph (so WebKit
  // actually pulls it). Silent — gain is pinned to 0.
  private inputSink: GainNode | null = null;
  // Silent looping source that keeps the AudioContext from idling into a
  // suspended/interrupted state between turns (WebKit suspends a context with no
  // active audio, which kills the VAD so later utterances are never heard). It
  // produces digital silence, so it is inaudible and feeds no echo.
  private keepAlive: AudioBufferSourceNode | null = null;
  private vad: MicVAD | null = null;
  private initPromise: Promise<void> | null = null;

  // Preview-only capture: a lightweight mic+analyser graph for metering while
  // idle (no VAD/listen turn). When a real init()/listen() takes over it adopts
  // the same graph (we never open the mic twice). Tracks who "owns" the mic so
  // stopInputPreview() won't tear down a graph an active listen() depends on.
  private previewActive = false;
  // Scratch buffers reused by get{Input,Output}Level() to avoid per-frame allocs.
  private levelBuf: Uint8Array | null = null;
  private outLevelBuf: Uint8Array | null = null;
  // Bound handler so we can add/remove the devicechange listener symmetrically.
  private readonly onDeviceChangeHandler = () => {
    for (const cb of this.devicesChangedCbs) {
      try {
        cb();
      } catch {
        /* ignore */
      }
    }
  };
  private deviceChangeBound = false;

  // On iOS/standalone, play TTS through a bare reused <audio> element (see
  // prefersNativePlayback) instead of the Web Audio route.
  private readonly preferNativePlayback: boolean = prefersNativePlayback();
  // The single reusable, gesture-blessed element for the native playback path.
  private ttsEl: HTMLAudioElement | null = null;
  // True once a user gesture has "blessed" ttsEl (played a silent clip on it).
  private ttsElBlessed = false;
  // Removes the current native playback listeners; called before re-arming the
  // reused element and on teardown so stale listeners never accumulate.
  private ttsElListeners: (() => void) | null = null;

  // Playback graph (TTS).
  private audioEl: HTMLAudioElement | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private playbackSource: MediaElementAudioSourceNode | null = null;
  // Wall-clock (performance.now) when the current TTS playback began. Used to
  // guard barge-in: VAD events in the first BARGE_IN_GUARD_MS of playback are
  // ignored so the agent's own opening syllable (leaking through speakers) can't
  // instantly self-interrupt the reply.
  private speakStartedAt = 0;

  // Per-listen diagnostics — folded into the timeout error so a "No speech was
  // heard" report carries the live state (which layer is actually dead) without
  // the user having to read the on-screen debug overlay.
  private listenPeakIn = 0;
  private listenSawSpeechStart = false;
  private listenSampler: ReturnType<typeof setInterval> | null = null;

  // One in-flight listen() at a time.
  private pendingListen: {
    resolve: (transcript: string) => void;
    reject: (err: unknown) => void;
    timer: ReturnType<typeof setTimeout> | null;
    settled: boolean;
  } | null = null;

  // Recording mode (user-pinned listen). While active, handleSpeechEnd
  // transcribes each VAD segment immediately (ordered promises below) instead
  // of resolving the pending listen; stopRecording() joins them and resolves.
  private recordingActive = false;
  private recordingStopping = false;
  private recordingSegments: Promise<string>[] = [];
  // Per-slot resolved segment texts, in SPEECH order (slot = push index above).
  // `null` = the segment's STT is still in flight. The live transcript emitted
  // via onRecordingTranscript is joinSegmentTexts() over this array, so an
  // out-of-order STT resolution can only ever fill in an earlier/later slot —
  // never reorder the text. stopRecording()'s final join uses the same helper
  // over the same per-segment results so live and final cannot diverge.
  private recordingSlotTexts: (string | null)[] = [];
  // Bumped on every reset so a stale segment promise resolving after the
  // recording ended (or a new one started) can't emit into the wrong recording.
  private recordingEpoch = 0;
  private recordingCeil: ReturnType<typeof setTimeout> | null = null;
  private readonly recordingTranscriptCbs = new Set<RecordingTranscriptCb>();

  // One in-flight speak() at a time.
  private pendingSpeak: {
    resolve: () => void;
    reject: (err: unknown) => void;
    settled: boolean;
  } | null = null;
  // Hard ceiling on a speak() turn: blocked playback on iOS can neither fire
  // "ended" nor "error", which would otherwise ride the Go bridge's 60s voice
  // timeout. See armSpeakCap().
  private speakCapTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: AudioServiceOptions = {}) {
    this.transport = opts.transport ?? defaultTransport;
    this.vadAssetPath = opts.vadAssetPath ?? DEFAULT_VAD_ASSET_PATH;
    this.onnxWasmPath = opts.onnxWasmPath ?? this.vadAssetPath;
    this.vadModel = opts.vadModel ?? "v5";
    this.maxListenMs = opts.maxListenMs ?? DEFAULT_MAX_LISTEN_MS;
    this.voice = opts.voice ?? "";
    this.speed = opts.speed ?? 0;
    this.lang = opts.lang ?? "";
    this.vadOptions = resolveVadOptions(opts.vad, FRAME_SAMPLES_BY_MODEL[this.vadModel]);
    this.bargeIn = opts.bargeIn ?? false;
    this.bargeInGuardMs = opts.bargeInGuardMs ?? BARGE_IN_GUARD_MS;
    this.inputDeviceId = opts.inputDeviceId ?? readPersistedInputDevice();
  }

  // ---- subscriptions -------------------------------------------------------

  onState(cb: VoiceStateCb): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  onError(cb: VoiceErrorCb): () => void {
    this.errorCbs.add(cb);
    return () => this.errorCbs.delete(cb);
  }

  onRecordingTranscript(cb: RecordingTranscriptCb): () => void {
    this.recordingTranscriptCbs.add(cb);
    return () => this.recordingTranscriptCbs.delete(cb);
  }

  private emitRecordingTranscript(text: string) {
    for (const cb of this.recordingTranscriptCbs) {
      try {
        cb(text);
      } catch {
        /* never let a subscriber break the pipeline */
      }
    }
  }

  getState(): VoiceServiceState {
    return this.state;
  }

  getInputAnalyser(): AnalyserNode | null {
    return this.inputAnalyser;
  }

  getOutputAnalyser(): AnalyserNode | null {
    return this.outputAnalyser;
  }

  setBargeIn(enabled: boolean): void {
    this.bargeIn = enabled;
  }

  /**
   * Switch the voice language served on subsequent STT/TTS turns, along with the
   * voice + speed to use for TTS. Effective on the next transcribe/synthesize
   * call; the live mic/VAD graph is untouched, so it's safe mid-conversation.
   */
  setLanguage(lang: string, voice: string, speed: number): void {
    this.lang = lang ?? "";
    this.voice = voice ?? "";
    this.speed = speed ?? 0;
  }

  /** Tune (or disable, with 0) the post-playback barge-in suppression window. */
  setBargeInGuardMs(ms: number): void {
    this.bargeInGuardMs = Math.max(0, ms);
  }

  // ---- device selection + input metering -----------------------------------

  async listInputDevices(): Promise<AudioInputDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    let devices: MediaDeviceInfo[];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return [];
    }
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d) => ({
        deviceId: d.deviceId,
        // Labels are empty until permission is granted; show a stable generic
        // name keyed off the (possibly opaque) id so the entry is selectable.
        label:
          d.label && d.label.trim()
            ? d.label
            : `Microphone (${(d.deviceId || "default").slice(0, 6)}…)`,
      }));
  }

  async hasDeviceLabels(): Promise<boolean> {
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some((d) => d.kind === "audioinput" && !!d.label.trim());
    } catch {
      return false;
    }
  }

  getInputDevice(): string | null {
    return this.inputDeviceId;
  }

  async setInputDevice(deviceId: string | null): Promise<void> {
    const next = deviceId && deviceId.trim() ? deviceId : null;
    if (next === this.inputDeviceId) return;
    this.inputDeviceId = next;
    writePersistedInputDevice(next);

    // If nothing is capturing, just store it — next init()/listen()/preview
    // will pick it up.
    const wasInitialised = !!this.stream;
    const wasPreviewing = this.previewActive;
    const wasListening = !!this.pendingListen && !this.pendingListen.settled;
    if (!wasInitialised) return;

    // Cancel any in-flight turn before swapping the device underneath it.
    if (wasListening) this.cancelListen();

    // Tear down the capture graph + VAD, then re-init cleanly on the new device.
    await this.teardownCapture();
    try {
      await this.init();
      if (wasPreviewing) this.previewActive = true;
    } catch {
      // openMicStream() already reported via onError; leave capture down.
    }
  }

  onDevicesChanged(cb: DevicesChangedCb): () => void {
    this.devicesChangedCbs.add(cb);
    this.bindDeviceChange();
    return () => {
      this.devicesChangedCbs.delete(cb);
      if (this.devicesChangedCbs.size === 0) this.unbindDeviceChange();
    };
  }

  private bindDeviceChange(): void {
    if (this.deviceChangeBound || !navigator.mediaDevices) return;
    try {
      navigator.mediaDevices.addEventListener("devicechange", this.onDeviceChangeHandler);
      this.deviceChangeBound = true;
    } catch {
      /* ignore */
    }
  }

  private unbindDeviceChange(): void {
    if (!this.deviceChangeBound || !navigator.mediaDevices) return;
    try {
      navigator.mediaDevices.removeEventListener("devicechange", this.onDeviceChangeHandler);
    } catch {
      /* ignore */
    }
    this.deviceChangeBound = false;
  }

  async startInputPreview(deviceId?: string): Promise<void> {
    if (deviceId !== undefined) {
      // Treat an explicit deviceId as a device selection (persists too).
      await this.setInputDevice(deviceId || null);
    }
    // If the full graph is already open (preview, listen, or a warmed init),
    // reuse it — never open the mic twice.
    if (this.stream && this.inputAnalyser) {
      this.previewActive = true;
      return;
    }
    // init() opens the mic + builds the input analyser (and warms the VAD). We
    // mark preview-active so stopInputPreview() may later tear it down (unless a
    // listen() has since taken ownership).
    await this.init();
    this.previewActive = true;
  }

  stopInputPreview(): void {
    if (!this.previewActive) return;
    this.previewActive = false;
    // If a real turn currently owns the mic, leave the graph intact.
    if (this.pendingListen && !this.pendingListen.settled) return;
    if (this.state === "listening" || this.state === "speaking" || this.state === "thinking") {
      return;
    }
    // Idle preview → release the mic so the OS indicator goes off.
    void this.teardownCapture();
  }

  getInputLevel(): number {
    const analyser = this.inputAnalyser;
    if (!analyser) return 0;
    const n = analyser.fftSize;
    if (!this.levelBuf || this.levelBuf.length !== n) {
      this.levelBuf = new Uint8Array(n);
    }
    const buf = this.levelBuf;
    analyser.getByteTimeDomainData(buf);
    // Peak deviation from the 128 midpoint → 0..1.
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(buf[i] - 128);
      if (v > peak) peak = v;
    }
    return Math.min(1, peak / 128);
  }

  /** Peak playback (TTS) level 0..1 — mirrors getInputLevel for the output graph. */
  getOutputLevel(): number {
    const analyser = this.outputAnalyser;
    if (!analyser) return 0;
    const n = analyser.fftSize;
    if (!this.outLevelBuf || this.outLevelBuf.length !== n) {
      this.outLevelBuf = new Uint8Array(n);
    }
    const buf = this.outLevelBuf;
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(buf[i] - 128);
      if (v > peak) peak = v;
    }
    return Math.min(1, peak / 128);
  }

  /** Current AudioContext state ("running"/"suspended"/"interrupted"/"closed"/"none"). */
  getContextState(): string {
    return this.audioCtx ? this.audioCtx.state : "none";
  }

  private setState(s: VoiceServiceState) {
    if (this.state === s) return;
    // Any real transition cancels the post-listen "thinking" bound; the new
    // state (listening/speaking/idle) is authoritative. Re-armed below only
    // when we are actually entering thinking.
    if (this.thinkingTimer) {
      clearTimeout(this.thinkingTimer);
      this.thinkingTimer = null;
    }
    this.state = s;
    if (s === "thinking") this.armThinkingTimeout();
    for (const cb of this.stateCbs) {
      try {
        cb(s);
      } catch {
        /* never let a subscriber break the pipeline */
      }
    }
  }

  /**
   * Arm (or re-arm) the upper bound on the "thinking" state so the orb doesn't
   * sit in thinking forever if the agent never speaks/listens again (e.g. the
   * conversation ended with the pane left open). A real listen()/speak()/
   * barge-in transition clears this via setState() before it fires.
   */
  private armThinkingTimeout() {
    if (this.thinkingTimer) clearTimeout(this.thinkingTimer);
    this.thinkingTimer = setTimeout(() => {
      this.thinkingTimer = null;
      if (this.state === "thinking") this.setState("idle");
    }, MAX_THINKING_MS);
  }

  private emitError(err: VoiceError) {
    for (const cb of this.errorCbs) {
      try {
        cb(err);
      } catch {
        /* ignore */
      }
    }
  }

  // ---- init / capture graph ------------------------------------------------

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit().catch((e) => {
      // Allow a later retry by clearing the cached promise on failure.
      this.initPromise = null;
      throw e;
    });
    return this.initPromise;
  }

  /**
   * Open the mic for the active input device with an OverconstrainedError
   * fallback to the browser default (reported via onError). Used by both the
   * full init() (VAD) path and the preview path so device handling lives in one
   * place.
   */
  private async openMicStream(): Promise<MediaStream> {
    const id = this.inputDeviceId;
    try {
      return await navigator.mediaDevices.getUserMedia(micConstraints(id));
    } catch (e) {
      // A specific device that's gone/unavailable → fall back to default and
      // surface a soft error rather than failing the whole pipeline.
      const name = (e as { name?: string } | null)?.name;
      if (id && (name === "OverconstrainedError" || name === "NotFoundError")) {
        this.emitError({
          kind: "permission",
          message:
            "The selected microphone is unavailable; falling back to the system default.",
          cause: e,
        });
        this.inputDeviceId = null;
        writePersistedInputDevice(null);
        try {
          return await navigator.mediaDevices.getUserMedia(micConstraints(null));
        } catch (e2) {
          const err: VoiceError = {
            kind: "permission",
            message: "Microphone access was denied or is unavailable.",
            cause: e2,
          };
          this.emitError(err);
          throw err;
        }
      }
      const err: VoiceError = {
        kind: "permission",
        message: "Microphone access was denied or is unavailable.",
        cause: e,
      };
      this.emitError(err);
      throw err;
    }
  }

  /** Lazily create (and resume) the shared AudioContext. */
  private ensureContext(): AudioContext {
    if (this.audioCtx) return this.audioCtx;
    const AC: typeof AudioContext =
      window.AudioContext ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext;
    const ctx = new AC();
    this.audioCtx = ctx;
    // Self-heal: WebKit can flip the context to "interrupted"/"suspended"
    // between turns (e.g. when a per-turn TTS <audio> element ends and drops the
    // OS audio session). Whenever that happens, try to resume immediately so the
    // VAD/analyser don't stay starved waiting for the next listen() turn.
    ctx.onstatechange = () => {
      if (ctx.state !== "running" && ctx.state !== "closed") {
        void ctx.resume().catch(() => {});
      }
    };
    if (ctx.state === "suspended") {
      // Resumed lazily on first user gesture in some browsers; best-effort.
      void ctx.resume().catch(() => {});
    }
    return ctx;
  }

  /**
   * Resume the shared AudioContext. MUST be called from within a user-gesture
   * handler: WKWebView (and browser autoplay policies) keep a context created
   * without a gesture in the "suspended" state, which means the input analyser
   * never receives samples and the live level meter reads flat zero. The pane
   * wires this to the first pointer/key interaction. No-op if not yet created
   * or already running.
   */
  async resumeContext(): Promise<void> {
    const ctx = this.audioCtx;
    // Resume on any non-running state. WebKit uses "suspended" (autoplay) AND
    // "interrupted" (Safari/iOS, e.g. another audio session or a finished media
    // element) — resume() recovers both. Skipping "interrupted" is what leaves
    // the loop dead after a turn or two.
    if (ctx && ctx.state !== "running" && ctx.state !== "closed") {
      try {
        // iOS WebKit: resume() outside a user gesture can stay pending FOREVER
        // (it neither resolves nor rejects). Awaiting it unguarded hangs the
        // whole speak/listen turn until the Go bridge's opaque voice timeout.
        // Race a short deadline — if it can't resume quickly, it won't resume
        // at all, and the caller must proceed (or fail fast) without it.
        await Promise.race([
          ctx.resume(),
          new Promise<void>((resolve) => setTimeout(resolve, 1000)),
        ]);
      } catch {
        /* best-effort */
      }
    }
    if (ctx) this.startKeepAlive(ctx);
  }

  /** Lazily create the reusable native-playback element (iOS path). */
  private ensureTtsEl(): HTMLAudioElement {
    if (this.ttsEl) return this.ttsEl;
    const el = new Audio();
    el.preload = "auto";
    // Keep audio inline (never hand off to the fullscreen player) on iOS.
    el.setAttribute("playsinline", "");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).playsInline = true;
    this.ttsEl = el;
    return el;
  }

  async unlockPlayback(): Promise<void> {
    // Always resume the context (drives the input meter + desktop playback).
    await this.resumeContext();
    if (!this.preferNativePlayback) return;
    // Never touch the element while a speak() owns it, and only bless it ONCE:
    // this handler fires on EVERY window tap (including scroll touches), and
    // re-pointing the reusable element's src mid-playback aborts the agent's
    // reply a word or two in ("Playback error"). A blessed element stays
    // blessed for its lifetime, so once is enough.
    if (this.pendingSpeak || this.ttsElBlessed) return;
    // iOS: play a short silent clip on the reusable element WITHIN this user
    // gesture. That grants the element "user-initiated audio", so the later
    // agent-driven speak() reusing this same element is allowed to play.
    try {
      const el = this.ensureTtsEl();
      el.muted = false;
      el.volume = 1;
      el.src = silentWavDataUri();
      await el.play().catch(() => {});
      try {
        el.pause();
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
      this.ttsElBlessed = true;
    } catch {
      /* best-effort — real speak() will still try to play */
    }
  }

  /**
   * Start a silent, looping buffer source feeding the destination so the context
   * never idles into "suspended"/"interrupted" between turns. WebKit suspends an
   * inactive context, which silently kills the VAD — the user then talks and
   * nothing is heard ("No speech was heard" / orb flat after the first turn).
   * Idempotent; the source plays inaudible digital silence.
   */
  private startKeepAlive(ctx: AudioContext): void {
    if (this.keepAlive) return;
    try {
      const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 0.5)), ctx.sampleRate);
      // buf is zero-filled = silence; loop it forever.
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(ctx.destination);
      src.start();
      this.keepAlive = src;
    } catch {
      /* best-effort — keep-alive is an optimization, never fatal */
    }
  }

  private stopKeepAlive(): void {
    if (!this.keepAlive) return;
    try {
      this.keepAlive.stop();
    } catch {
      /* ignore */
    }
    try {
      this.keepAlive.disconnect();
    } catch {
      /* ignore */
    }
    this.keepAlive = null;
  }

  /** Build the input analyser graph on the given stream (shared by init/preview). */
  private buildInputGraph(ctx: AudioContext, stream: MediaStream): void {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    this.inputAnalyser = analyser;
    this.micSource = ctx.createMediaStreamSource(stream);
    this.micSource.connect(analyser);
    // The analyser MUST have a path to the destination or some engines
    // (notably Safari/WebKit) never pull it through the render graph, leaving
    // getByteFrequencyData/getByteTimeDomainData flat — so the orb and the live
    // level meter read zero while the user talks. Route it through a muted gain
    // node: the node is pulled (analysis works) but emits silence (no echo).
    const sink = ctx.createGain();
    sink.gain.value = 0;
    analyser.connect(sink);
    sink.connect(ctx.destination);
    this.inputSink = sink;
  }

  private async doInit(): Promise<void> {
    // Reuse a stream/graph already opened by startInputPreview() so we never
    // open the mic twice; the VAD adopts the same stream below.
    const reusing = !!this.stream;

    // 1. Mic.
    let stream: MediaStream;
    if (this.stream) {
      stream = this.stream;
    } else {
      stream = await this.openMicStream();
      this.stream = stream;
    }

    // 2. AudioContext + input analyser (drives the orb's listening level).
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* resumed lazily on first user gesture in some browsers */
      }
    }
    if (!this.inputAnalyser || !reusing) {
      this.buildInputGraph(ctx, stream);
    }
    // Keep the context alive across turns so WebKit doesn't suspend it (which
    // would starve the VAD and make later utterances go unheard).
    this.startKeepAlive(ctx);

    // 3. VAD — self-hosted assets, offline-safe, no CDN.
    try {
      this.vad = await MicVAD.new({
        model: this.vadModel,
        // VAD endpointing tuning (WI-5.6): thresholds + redemption/min-speech.
        ...this.vadOptions,
        // worklet bundle + silero_vad_*.onnx are fetched from here.
        baseAssetPath: this.vadAssetPath,
        // onnxruntime-web wasm binaries (ort-wasm-*) are fetched from here.
        onnxWASMBasePath: this.onnxWasmPath,
        // Reuse our AudioContext + mic stream so the analyser and VAD share one
        // capture graph (avoids opening the mic twice).
        audioContext: ctx,
        getStream: async () => stream,
        // CRITICAL (WebKit): @ricky0123/vad-web's DEFAULT pauseStream calls
        // track.stop() on the mic stream, and its default resumeStream opens a
        // brand-new getUserMedia. Because our inputAnalyser/micSource share this
        // exact stream, the default pause() would permanently kill it — the orb
        // and VAD go dead after the first turn, and WebKit hands back a muted
        // track on re-acquire ("No speech was heard" on turn 2+). Override both
        // to NO-OP / return-the-same-stream so vad.pause()/start() only toggle
        // the frame processor on our persistent stream. Chromium masks this bug
        // (its fake mic silently re-grants), which is why it only bites WebKit.
        pauseStream: async () => {},
        resumeStream: async () => stream,
        // We control start/stop explicitly per listen().
        startOnLoad: false,
        onSpeechStart: () => this.handleSpeechStart(),
        onSpeechEnd: (audio) => this.handleSpeechEnd(audio),
        onVADMisfire: () => this.handleVADMisfire(),
      });
    } catch (e) {
      const err: VoiceError = {
        kind: "vad",
        message: "Failed to initialize the voice-activity detector (VAD assets).",
        cause: e,
      };
      this.emitError(err);
      throw err;
    }
  }

  // ---- VAD callbacks -------------------------------------------------------

  private handleSpeechStart() {
    // Diagnostics: the VAD actually fired this turn (mic frames are flowing).
    this.listenSawSpeechStart = true;
    // Barge-in: user started talking while TTS is playing → stop playback and
    // hand the turn back to the user. We stop (not just pause) so the in-flight
    // speak() resolves and the agent's loop can move on to listening; if a
    // listen() is already pending, surface "listening" immediately.
    if (this.bargeIn && this.state === "speaking") {
      // Guard window: ignore speech detected in the first moments of playback.
      // Without echo cancellation the agent's own voice leaks into the mic and
      // would trip the VAD immediately, killing the reply mid-word.
      if (performance.now() - this.speakStartedAt < this.bargeInGuardMs) {
        return;
      }
      try {
        this.stopSpeaking();
      } catch {
        /* ignore — never let barge-in crash the pipeline */
      }
      // stopSpeaking() drops us to "idle"; reflect that the user is now talking.
      this.setState("listening");
      return;
    }
    if (this.pendingListen) {
      this.setState(this.recordingActive ? "recording" : "listening");
    }
  }

  private async handleSpeechEnd(audio: Float32Array) {
    if (!this.pendingListen || this.pendingListen.settled) return;

    if (this.recordingActive) {
      // Recording: do NOT resolve the listen. Transcribe this segment right
      // away (keeps the final stop fast and avoids one giant WAV) and keep the
      // VAD running for the next segment. A failed segment resolves to "" so a
      // single STT hiccup is skipped instead of killing the whole recording.
      let audioB64: string;
      try {
        const wav = utils.encodeWAV(audio); // 32-bit float WAV, 16000Hz mono (vad-web default); backend decodes float32
        audioB64 = utils.arrayBufferToBase64(wav);
      } catch {
        return; // skip the segment; keep recording
      }
      // Slot index = speech order (this branch is synchronous up to here, so
      // pushes happen in endpoint order even though STT resolves out of order).
      const slot = this.recordingSlotTexts.length;
      const epoch = this.recordingEpoch;
      this.recordingSlotTexts.push(null);
      // The pushed segment promise resolves to the text AFTER stop-phrase
      // stripping, so stopRecording()'s final join and the live transcript see
      // the same per-segment results (a segment that was only the stop phrase
      // strips to "" and is dropped by joinSegmentTexts).
      const p = this.transport
        .transcribe(audioB64, "audio/wav", this.lang)
        .catch(() => "")
        .then((raw) => {
          const { text, matched } = stripStopPhrase(raw);
          // Live transcript: as each segment resolves, fill its slot and emit
          // the accumulated join so the pane can show the draft growing in real
          // time. Empty/failed segments change nothing, so emit nothing for
          // them. A stale resolution (recording reset/stopped meanwhile) is
          // dropped.
          if (epoch === this.recordingEpoch) {
            this.recordingSlotTexts[slot] = text;
            if (text.trim()) {
              this.emitRecordingTranscript(joinSegmentTexts(this.recordingSlotTexts));
            }
            // Hands-free stop: the segment ended with a stop phrase → finalize
            // as if "■ stop" was pressed. stopRecording() itself guards against
            // re-entrancy via recordingStopping.
            if (matched) void this.stopRecording();
          }
          return text;
        });
      this.recordingSegments.push(p);
      return;
    }

    // Stop the VAD: we want exactly one utterance per listen().
    try {
      this.vad?.pause();
    } catch {
      /* ignore */
    }

    // VAD endpointed → STT/agent in flight.
    this.setState("thinking");

    // Assemble a 16kHz mono PCM WAV from the VAD's Float32 samples.
    let audioB64: string;
    try {
      const wav = utils.encodeWAV(audio); // 32-bit float WAV, 16000Hz mono (vad-web default); backend decodes float32
      audioB64 = utils.arrayBufferToBase64(wav);
    } catch (e) {
      this.failListen({ kind: "stt", message: "Failed to encode captured audio.", cause: e });
      return;
    }

    // STT via the (injectable) transport.
    try {
      const transcript = await this.transport.transcribe(audioB64, "audio/wav", this.lang);
      this.resolveListen(transcript);
    } catch (e) {
      this.failListen({
        kind: "network",
        message: "Speech-to-text request failed.",
        cause: e,
      });
    }
  }

  private handleVADMisfire() {
    // Spoke too briefly to count; keep listening (stay in the same state).
    if (this.pendingListen && !this.pendingListen.settled) {
      this.setState(this.recordingActive ? "recording" : "listening");
    }
  }

  // ---- listen() ------------------------------------------------------------

  async listen(opts?: ListenOptions): Promise<string> {
    // Only one listen at a time; cancel any prior.
    if (this.pendingListen && !this.pendingListen.settled) {
      this.cancelListen();
    }
    await this.init();
    // init() is cached, so it only resumes the context the first time. In a
    // hands-free loop there are no further user gestures, and WebKit can suspend
    // the context between turns — leaving the VAD starved of audio so the next
    // utterance is never detected (the loop hangs after a turn or two). Resume
    // on every turn; once a context has been unlocked, resume() needs no gesture.
    await this.resumeContext();
    if (!this.vad) {
      throw { kind: "vad", message: "VAD is not initialized." } as VoiceError;
    }

    // Reset + start per-listen diagnostics for this turn.
    this.listenPeakIn = 0;
    this.listenSawSpeechStart = false;
    if (this.listenSampler) clearInterval(this.listenSampler);
    this.listenSampler = setInterval(() => {
      const lvl = this.getInputLevel();
      if (lvl > this.listenPeakIn) this.listenPeakIn = lvl;
    }, 50);

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failListen({
          kind: "timeout",
          message: `No complete utterance within ${this.maxListenMs}ms. [${this.listenDiag()}]`,
        });
      }, this.maxListenMs);

      this.pendingListen = { resolve, reject, timer, settled: false };

      if (opts?.record) {
        // Agent-activated recording: pin the turn open BEFORE the VAD starts so
        // the user can dictate hands-free from the first word. startRecording()
        // requires pendingListen (just armed above); it disarms the maxListenMs
        // timer, arms the recording safety ceiling, and sets state "recording"
        // — so we skip the "listening" transition below entirely.
        this.startRecording();
      } else {
        // Begin capturing. We surface "listening" immediately so the orb reacts
        // to mic level even before the first speech-start fires.
        this.setState("listening");
      }
      try {
        this.vad!.start();
      } catch (e) {
        this.failListen({ kind: "vad", message: "Failed to start the VAD.", cause: e });
      }
    });
  }

  /**
   * Compact snapshot of why a listen turn may have heard nothing: AudioContext
   * state, mic-track health, the peak input level seen this turn, and whether
   * the VAD ever fired speech-start. Surfaced in the timeout message so the
   * failure is self-diagnosing from the user's report.
   */
  private listenDiag(): string {
    const track = this.stream ? this.stream.getAudioTracks()[0] : undefined;
    const mic = track
      ? `${track.readyState}${track.muted ? "/muted" : ""}${track.enabled ? "" : "/disabled"}`
      : "none";
    return `ctx=${this.getContextState()} mic=${mic} peakIn=${this.listenPeakIn.toFixed(
      2,
    )} vadStart=${this.listenSawSpeechStart ? "yes" : "no"}`;
  }

  private clearListenSampler(): void {
    if (this.listenSampler) {
      clearInterval(this.listenSampler);
      this.listenSampler = null;
    }
  }

  cancelListen(): void {
    if (!this.pendingListen || this.pendingListen.settled) return;
    this.failListen({ kind: "unknown", message: "Listen cancelled." });
  }

  // ---- recording (user-pinned long-form listen) ------------------------------

  isRecording(): boolean {
    return this.recordingActive;
  }

  startRecording(): void {
    const p = this.pendingListen;
    if (!p || p.settled || this.recordingActive) return;

    // Disarm the per-listen maxListenMs timeout: the user explicitly owns the
    // turn now. A generous safety ceiling replaces it (finalizes with whatever
    // was captured if the user walks away).
    if (p.timer) {
      clearTimeout(p.timer);
      p.timer = null;
    }
    this.recordingActive = true;
    this.recordingStopping = false;
    this.recordingSegments = [];
    this.recordingSlotTexts = [];
    this.recordingEpoch++;
    // A new recording always starts with a clean live draft.
    this.emitRecordingTranscript("");
    // Make vad.pause() flush a mid-speech segment via onSpeechEnd, so the user
    // can hit stop without waiting out the redemption window. Recording-only:
    // reset in resetRecording() so normal listens keep today's pause semantics.
    try {
      this.vad?.setOptions({ submitUserSpeechOnPause: true });
    } catch {
      /* ignore — stop falls back to whatever the VAD has endpointed */
    }
    this.recordingCeil = setTimeout(() => {
      this.recordingCeil = null;
      void this.stopRecording();
    }, RECORDING_MAX_MS);
    this.setState("recording");
  }

  async stopRecording(): Promise<void> {
    if (!this.recordingActive || this.recordingStopping) return;
    this.recordingStopping = true;
    if (this.recordingCeil) {
      clearTimeout(this.recordingCeil);
      this.recordingCeil = null;
    }

    // Flush a mid-speech segment: with submitUserSpeechOnPause, pause() emits a
    // final onSpeechEnd carrying whatever has been captured so far (it lands in
    // recordingSegments via the recording branch above, which is still active).
    try {
      await this.vad?.pause();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, RECORDING_FLUSH_GRACE_MS));

    const segments = this.recordingSegments;
    const p = this.pendingListen;
    // Keep the live draft on screen through the post-stop "thinking" beat: the
    // pane removes it when the final transcript line arrives, so don't emit a
    // clear here (a NEW recording still starts clean via startRecording()).
    this.resetRecording(false);
    if (!p || p.settled) return; // listen was cancelled mid-stop

    // STT for the tail segments is (possibly) still in flight.
    this.setState("thinking");
    const texts = await Promise.all(segments); // segment failures resolved to ""
    if (!this.pendingListen || this.pendingListen.settled) return;
    // Same per-segment results + join as the live onRecordingTranscript path.
    const transcript = joinSegmentTexts(texts);
    if (!transcript) {
      // Recording was toggled but nothing was captured/recognized — behave like
      // the existing no-speech path (the bridge maps "timeout" to an empty
      // transcript so the agent gets the "no speech heard" nudge, not an error).
      this.failListen({
        kind: "timeout",
        message: `No speech was captured while recording. [${this.listenDiag()}]`,
      });
      return;
    }
    this.resolveListen(transcript);
  }

  /**
   * Clear all recording state (also invoked when a listen settles/fails).
   * Emits an empty live transcript by default so the pane's draft is cleared;
   * stopRecording() passes false to keep the draft visible until the final
   * transcript line lands.
   */
  private resetRecording(emitClear = true): void {
    this.recordingActive = false;
    this.recordingStopping = false;
    this.recordingSegments = [];
    this.recordingSlotTexts = [];
    // Invalidate any still-in-flight segment resolutions for the old recording.
    this.recordingEpoch++;
    if (emitClear) this.emitRecordingTranscript("");
    if (this.recordingCeil) {
      clearTimeout(this.recordingCeil);
      this.recordingCeil = null;
    }
    try {
      this.vad?.setOptions({ submitUserSpeechOnPause: false });
    } catch {
      /* ignore */
    }
  }

  private resolveListen(transcript: string) {
    const p = this.pendingListen;
    if (!p || p.settled) return;
    p.settled = true;
    if (p.timer) clearTimeout(p.timer);
    this.clearListenSampler();
    if (this.recordingActive) this.resetRecording();
    this.pendingListen = null;
    try {
      this.vad?.pause();
    } catch {
      /* ignore */
    }
    // The transcript is about to be handed back to Go; the agent now reasons
    // (and may run tools) BEFORE the next speak()/listen() request arrives.
    // Stay in "thinking" so the orb reflects that real reasoning window instead
    // of dropping to idle. handleSpeechEnd() already set "thinking" for the STT
    // slice; re-arm the bound here explicitly because setState() short-circuits
    // when the state is unchanged and would not refresh the timeout — this makes
    // the bound measure from STT-completion across the whole reasoning window.
    this.setState("thinking");
    this.armThinkingTimeout();
    p.resolve(transcript);
  }

  private failListen(err: VoiceError) {
    const p = this.pendingListen;
    if (!p || p.settled) return;
    p.settled = true;
    if (p.timer) clearTimeout(p.timer);
    this.clearListenSampler();
    if (this.recordingActive) this.resetRecording();
    this.pendingListen = null;
    try {
      this.vad?.pause();
    } catch {
      /* ignore */
    }
    this.setState("idle");
    this.emitError(err);
    p.reject(err);
  }

  // ---- speak() + playback --------------------------------------------------

  async speak(text: string): Promise<void> {
    // Cancel any prior playback.
    this.stopSpeaking();

    // Keep the shared context alive across turns (see the note in listen()): a
    // suspended context would play the reply silently / not at all. The native
    // iOS path plays outside Web Audio entirely, so it must not block on a
    // context that may refuse to resume without a user gesture.
    if (this.preferNativePlayback) {
      void this.resumeContext();
    } else {
      await this.resumeContext();
    }

    let audioB64: string;
    let contentType: string;
    try {
      const res = await this.transport.synthesize(text, this.voice, this.speed, this.lang);
      audioB64 = res.audioB64;
      contentType = res.contentType || "audio/mpeg";
    } catch (e) {
      // Synthesis failed before playback started; we were holding "thinking"
      // from the prior listen turn — relax to idle now rather than waiting for
      // the thinking-timeout bound.
      if (this.state === "thinking" || this.state === "speaking") this.setState("idle");
      const err: VoiceError = { kind: "network", message: "Text-to-speech request failed.", cause: e };
      this.emitError(err);
      throw err;
    }

    // iOS/standalone: play through the bare, gesture-blessed element so the
    // reply is audible through the ring/silent switch and isn't trapped by a
    // suspended AudioContext.
    if (this.preferNativePlayback) {
      return this.speakNative(audioB64, contentType);
    }

    return new Promise<void>((resolve, reject) => {
      this.pendingSpeak = { resolve, reject, settled: false };
      this.armSpeakCap();

      const el = new Audio();
      el.src = `data:${contentType};base64,${audioB64}`;
      this.audioEl = el;

      // Route playback through an AnalyserNode for speaking-reactive orb. Best
      // effort: if Web Audio routing fails (e.g. CORS/codec quirks) we still
      // play the element directly.
      this.wirePlaybackAnalyser(el);

      const onPlaying = () => {
        this.speakStartedAt = performance.now();
        this.setState("speaking");
      };
      // As long as playback advances, push the stall watchdog out so a long reply
      // plays to completion instead of being cut off at a fixed ceiling.
      const onProgress = () => this.armSpeakCap();
      const onEnded = () => {
        cleanup();
        this.finishSpeak();
      };
      const onError = () => {
        cleanup();
        this.failSpeak({ kind: "playback", message: "Audio playback failed." });
      };
      const cleanup = () => {
        el.removeEventListener("playing", onPlaying);
        el.removeEventListener("play", onPlaying);
        el.removeEventListener("timeupdate", onProgress);
        el.removeEventListener("ended", onEnded);
        el.removeEventListener("error", onError);
      };

      el.addEventListener("play", onPlaying);
      el.addEventListener("playing", onPlaying);
      el.addEventListener("timeupdate", onProgress);
      el.addEventListener("ended", onEnded);
      el.addEventListener("error", onError);

      // Barge-in: keep the VAD running during playback so the user can talk over
      // the agent. handleSpeechStart() stops playback when that happens. Best
      // effort — never let a missing/unready VAD break playback. (handleSpeechEnd
      // is a no-op while no listen() is pending, so this won't trigger STT.)
      if (this.bargeIn && this.vad) {
        try {
          this.vad.start();
        } catch {
          /* ignore */
        }
      }

      el.play().catch((e) => {
        cleanup();
        this.failSpeak({ kind: "playback", message: "Audio playback was blocked.", cause: e });
      });
    });
  }

  /**
   * iOS/standalone playback: reuse the single gesture-blessed <audio> element
   * and play the reply NATIVELY (no Web Audio routing). This survives the
   * ring/silent switch and a suspended AudioContext — the two reasons agent-
   * initiated TTS was inaudible in the installed PWA. The orb's output level has
   * no analyser here, so it falls back to its simulated speaking envelope.
   */
  private speakNative(audioB64: string, contentType: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pendingSpeak = { resolve, reject, settled: false };
      this.armSpeakCap();
      const el = this.ensureTtsEl();
      // Native route: not wired through Web Audio (would re-mute it on iOS).
      this.outputAnalyser = null;
      this.playbackSource = null;
      this.audioEl = el;

      // Drop any listeners still attached from a prior turn on this reused el.
      if (this.ttsElListeners) {
        this.ttsElListeners();
        this.ttsElListeners = null;
      }

      const onPlaying = () => {
        this.speakStartedAt = performance.now();
        this.setState("speaking");
      };
      // Push the stall watchdog out while playback advances (see speak()).
      const onProgress = () => this.armSpeakCap();
      const onEnded = () => {
        cleanup();
        this.finishSpeak();
      };
      const onError = () => {
        cleanup();
        this.failSpeak({ kind: "playback", message: "Audio playback failed." });
      };
      const cleanup = () => {
        el.removeEventListener("play", onPlaying);
        el.removeEventListener("playing", onPlaying);
        el.removeEventListener("timeupdate", onProgress);
        el.removeEventListener("ended", onEnded);
        el.removeEventListener("error", onError);
        this.ttsElListeners = null;
      };
      this.ttsElListeners = cleanup;
      el.addEventListener("play", onPlaying);
      el.addEventListener("playing", onPlaying);
      el.addEventListener("timeupdate", onProgress);
      el.addEventListener("ended", onEnded);
      el.addEventListener("error", onError);

      // Barge-in parity with the Web Audio path (see speak()).
      if (this.bargeIn && this.vad) {
        try {
          this.vad.start();
        } catch {
          /* ignore */
        }
      }

      el.muted = false;
      el.volume = 1;
      el.src = `data:${contentType};base64,${audioB64}`;
      try {
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
      el.play().catch((e) => {
        cleanup();
        this.failSpeak({ kind: "playback", message: "Audio playback was blocked.", cause: e });
      });
    });
  }

  private wirePlaybackAnalyser(el: HTMLAudioElement) {
    try {
      const AC: typeof AudioContext =
        window.AudioContext ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).webkitAudioContext;
      // Reuse the capture context if present so we don't proliferate contexts.
      const ctx = this.audioCtx ?? new AC();
      this.audioCtx = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      const src = ctx.createMediaElementSource(el);
      src.connect(analyser);
      analyser.connect(ctx.destination);
      this.outputAnalyser = analyser;
      this.playbackSource = src;
    } catch {
      // Element will still play through its default output; orb falls back to
      // its simulated speaking envelope.
      this.outputAnalyser = null;
      this.playbackSource = null;
    }
  }

  stopSpeaking(): void {
    if (this.audioEl) {
      try {
        this.audioEl.pause();
        this.audioEl.src = "";
      } catch {
        /* ignore */
      }
    }
    // Resolve (not reject) an in-flight speak when explicitly stopped.
    this.finishSpeak();
  }

  // Cue dispatch lives here (not in voiceCues.ts) because the service owns the
  // three facts a correct routing decision needs: the single shared
  // AudioContext, the platform flag, and speak state. voiceCues is a pure tone
  // synthesizer that takes the context to play into.
  //
  // On the iOS native-playback path we return BEFORE touching the context: a
  // Web Audio context opened here would arbitrate the one WebKit audio session
  // against the native <audio> TTS and duck it. Cues are silent on that path by
  // design (conversation-only on mobile). On desktop we reuse the same context
  // as TTS so cues share its session instead of competing with it.
  playCue(next: VoiceServiceState, prev: VoiceServiceState): void {
    if (this.preferNativePlayback) return;
    try {
      playTransitionCue(this.ensureContext(), next, prev);
    } catch {
      /* cues are best-effort */
    }
  }

  playCueError(): void {
    if (this.preferNativePlayback) return;
    try {
      playErrorCue(this.ensureContext());
    } catch {
      /* cues are best-effort */
    }
  }

  /**
   * Watchdog for a single speak() turn: fail with an actionable message if
   * playback makes no progress for the window, covering the two ways an element
   * can hang without firing "ended"/"error" — iOS autoplay gating (never starts)
   * and a mid-clip stall. It is (re)armed on every "timeupdate", so a long reply
   * that keeps playing pushes the deadline out and is NEVER cut off mid-sentence
   * — only a genuine lack of progress trips it. (The Go SpeakTimeout is held off
   * for long replies by the bridge keepalive, so this no longer needs to stay
   * under 60s.)
   */
  private armSpeakCap(): void {
    if (this.speakCapTimer) clearTimeout(this.speakCapTimer);
    this.speakCapTimer = setTimeout(() => {
      this.failSpeak({
        kind: "playback",
        message:
          "Playback stalled — audio output may be blocked; tap the voice pane once and retry.",
      });
    }, 45_000);
  }

  private clearSpeakCap(): void {
    if (this.speakCapTimer) {
      clearTimeout(this.speakCapTimer);
      this.speakCapTimer = null;
    }
  }

  private finishSpeak() {
    this.clearSpeakCap();
    this.teardownPlayback();
    const p = this.pendingSpeak;
    // Reset from speaking OR thinking: a speak() can be abandoned (stopSpeaking)
    // while we're still in the post-listen "thinking" hold, and we shouldn't lean
    // on the thinking-timeout bound to relax it.
    if (this.state === "speaking" || this.state === "thinking") this.setState("idle");
    if (!p || p.settled) return;
    p.settled = true;
    this.pendingSpeak = null;
    p.resolve();
  }

  private failSpeak(err: VoiceError) {
    this.clearSpeakCap();
    this.teardownPlayback();
    if (this.state === "speaking" || this.state === "thinking") this.setState("idle");
    const p = this.pendingSpeak;
    // No live speak = a stale event on the reused element (e.g. an "error"
    // fired by clearing src after an explicit stop) — nothing failed for the
    // user, so don't surface an error banner for it.
    if (!p || p.settled) return;
    this.emitError(err);
    p.settled = true;
    this.pendingSpeak = null;
    p.reject(err);
  }

  private teardownPlayback() {
    // If barge-in left the VAD running during playback, pause it now (unless a
    // listen() is pending, which owns the VAD and will (re)start it).
    if (this.bargeIn && !this.pendingListen) {
      try {
        this.vad?.pause();
      } catch {
        /* ignore */
      }
    }
    try {
      this.playbackSource?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.outputAnalyser?.disconnect();
    } catch {
      /* ignore */
    }
    this.playbackSource = null;
    this.outputAnalyser = null;
    this.audioEl = null;
  }

  // ---- teardown ------------------------------------------------------------

  /**
   * Release the capture half of the graph — VAD, mic stream, and input analyser
   * — while KEEPING the AudioContext alive so it can be reused (e.g. when
   * switching the input device, or so playback's context survives). Clears the
   * cached init promise so a subsequent init() re-opens the mic cleanly.
   */
  private async teardownCapture(): Promise<void> {
    try {
      await this.vad?.destroy();
    } catch {
      /* ignore */
    }
    this.vad = null;
    try {
      this.micSource?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.inputAnalyser?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.inputSink?.disconnect();
    } catch {
      /* ignore */
    }
    this.stopKeepAlive();
    this.micSource = null;
    this.inputAnalyser = null;
    this.inputSink = null;
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
    }
    this.stream = null;
    this.initPromise = null;
  }

  async dispose(): Promise<void> {
    this.cancelListen();
    this.stopSpeaking();
    // Defensively clear the thinking bound so no orphaned timer fires after
    // teardown (setState("idle") below also clears it, but only if the state
    // actually changes — clearing explicitly is robust if state was already idle).
    if (this.thinkingTimer) {
      clearTimeout(this.thinkingTimer);
      this.thinkingTimer = null;
    }
    this.previewActive = false;
    this.unbindDeviceChange();
    this.devicesChangedCbs.clear();
    if (this.ttsElListeners) {
      this.ttsElListeners();
      this.ttsElListeners = null;
    }
    this.ttsElBlessed = false;
    if (this.ttsEl) {
      try {
        this.ttsEl.pause();
        this.ttsEl.src = "";
      } catch {
        /* ignore */
      }
      this.ttsEl = null;
    }
    await this.teardownCapture();
    try {
      await this.audioCtx?.close();
    } catch {
      /* ignore */
    }
    this.audioCtx = null;
    this.setState("idle");
  }
}

/** Factory mirroring the class for callers that prefer a function. */
export function createAudioService(opts?: AudioServiceOptions): IAudioService {
  return new AudioService(opts);
}

export type { IAudioService, AudioServiceOptions, VoiceServiceState, VoiceTransport };
