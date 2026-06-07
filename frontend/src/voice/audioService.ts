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
  VadTuning,
  VoiceError,
  VoiceErrorCb,
  VoiceServiceState,
  VoiceStateCb,
  VoiceTransport,
} from "./types";

const DEFAULT_VAD_ASSET_PATH = "/vad/";
const DEFAULT_MAX_LISTEN_MS = 30_000;
/** Barge-in is suppressed for this long after TTS playback starts (see handleSpeechStart). */
const BARGE_IN_GUARD_MS = 1200;

/** localStorage key for the (browser/machine-scoped) selected input deviceId. */
const INPUT_DEVICE_LS_KEY = "quant.voice.inputDeviceId";

function readPersistedInputDevice(): string | null {
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
// a slightly-strict positive threshold to avoid triggering on room noise, an
// ~800ms redemption so natural mid-sentence pauses don't cut the user off, a
// short pre-speech pad so the first phoneme isn't clipped, and a min-speech
// floor so coughs/clicks misfire instead of being transcribed.
const VAD_DEFAULTS: Required<Omit<VadTuning, "sensitivity">> = {
  positiveSpeechThreshold: 0.6,
  negativeSpeechThreshold: 0.45,
  redemptionMs: 800,
  preSpeechPadMs: 160,
  minSpeechMs: 250,
};

/**
 * Resolve the VAD tuning into the concrete FrameProcessorOptions subset that
 * @ricky0123/vad-web accepts. Explicit thresholds win; otherwise `sensitivity`
 * (0..1, default 0.5) derives them around the default positive threshold.
 */
function resolveVadOptions(tuning: VadTuning | undefined) {
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
  return {
    positiveSpeechThreshold: positive,
    negativeSpeechThreshold: negative,
    redemptionMs: t.redemptionMs ?? VAD_DEFAULTS.redemptionMs,
    preSpeechPadMs: t.preSpeechPadMs ?? VAD_DEFAULTS.preSpeechPadMs,
    minSpeechMs: t.minSpeechMs ?? VAD_DEFAULTS.minSpeechMs,
  };
}

/** Default transport = the real Wails-bridged api.ts wrappers. */
const defaultTransport: VoiceTransport = {
  transcribe: (audioB64, mime) => api.transcribe(audioB64, mime),
  synthesize: (text, voice, speed) => api.synthesize(text, voice, speed),
};

export class AudioService implements IAudioService {
  private readonly transport: VoiceTransport;
  private readonly vadAssetPath: string;
  private readonly onnxWasmPath: string;
  private readonly vadModel: "v5" | "legacy";
  private readonly maxListenMs: number;
  private readonly voice: string;
  private readonly speed: number;
  private readonly vadOptions: ReturnType<typeof resolveVadOptions>;
  private bargeIn: boolean;
  private bargeInGuardMs: number;

  // Active input deviceId override (null = browser default). Initialised from
  // the explicit option, else persisted localStorage value, else null.
  private inputDeviceId: string | null;

  private state: VoiceServiceState = "idle";
  private readonly stateCbs = new Set<VoiceStateCb>();
  private readonly errorCbs = new Set<VoiceErrorCb>();
  private readonly devicesChangedCbs = new Set<DevicesChangedCb>();

  // Capture graph.
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private vad: MicVAD | null = null;
  private initPromise: Promise<void> | null = null;

  // Preview-only capture: a lightweight mic+analyser graph for metering while
  // idle (no VAD/listen turn). When a real init()/listen() takes over it adopts
  // the same graph (we never open the mic twice). Tracks who "owns" the mic so
  // stopInputPreview() won't tear down a graph an active listen() depends on.
  private previewActive = false;
  // Scratch buffer reused by getInputLevel() to avoid per-frame allocations.
  private levelBuf: Uint8Array | null = null;
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

  // Playback graph (TTS).
  private audioEl: HTMLAudioElement | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private playbackSource: MediaElementAudioSourceNode | null = null;
  // Wall-clock (performance.now) when the current TTS playback began. Used to
  // guard barge-in: VAD events in the first BARGE_IN_GUARD_MS of playback are
  // ignored so the agent's own opening syllable (leaking through speakers) can't
  // instantly self-interrupt the reply.
  private speakStartedAt = 0;

  // One in-flight listen() at a time.
  private pendingListen: {
    resolve: (transcript: string) => void;
    reject: (err: unknown) => void;
    timer: ReturnType<typeof setTimeout> | null;
    settled: boolean;
  } | null = null;

  // One in-flight speak() at a time.
  private pendingSpeak: {
    resolve: () => void;
    reject: (err: unknown) => void;
    settled: boolean;
  } | null = null;

  constructor(opts: AudioServiceOptions = {}) {
    this.transport = opts.transport ?? defaultTransport;
    this.vadAssetPath = opts.vadAssetPath ?? DEFAULT_VAD_ASSET_PATH;
    this.onnxWasmPath = opts.onnxWasmPath ?? this.vadAssetPath;
    this.vadModel = opts.vadModel ?? "v5";
    this.maxListenMs = opts.maxListenMs ?? DEFAULT_MAX_LISTEN_MS;
    this.voice = opts.voice ?? "";
    this.speed = opts.speed ?? 0;
    this.vadOptions = resolveVadOptions(opts.vad);
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

  private setState(s: VoiceServiceState) {
    if (this.state === s) return;
    this.state = s;
    for (const cb of this.stateCbs) {
      try {
        cb(s);
      } catch {
        /* never let a subscriber break the pipeline */
      }
    }
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
    // Enable the browser's audio processing chain. echoCancellation is the
    // important one for the voice loop: without it, a speaker-played TTS reply
    // leaks back into the mic and the VAD mistakes the agent's own voice for the
    // user speaking (self-barge-in / echo). Noise suppression + auto gain also
    // improve STT quality.
    const processing = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    const constraints: MediaStreamConstraints = {
      audio: id ? { ...processing, deviceId: { exact: id } } : { ...processing },
    };
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
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
          return await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
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
    if (ctx && ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* best-effort */
      }
    }
  }

  /** Build the input analyser graph on the given stream (shared by init/preview). */
  private buildInputGraph(ctx: AudioContext, stream: MediaStream): void {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    this.inputAnalyser = analyser;
    this.micSource = ctx.createMediaStreamSource(stream);
    this.micSource.connect(analyser);
    // NOTE: analyser is intentionally NOT connected to ctx.destination (no echo).
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
      this.setState("listening");
    }
  }

  private async handleSpeechEnd(audio: Float32Array) {
    if (!this.pendingListen || this.pendingListen.settled) return;

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
      const wav = utils.encodeWAV(audio); // defaults: PCM, 16000Hz, mono, 16-bit
      audioB64 = utils.arrayBufferToBase64(wav);
    } catch (e) {
      this.failListen({ kind: "stt", message: "Failed to encode captured audio.", cause: e });
      return;
    }

    // STT via the (injectable) transport.
    try {
      const transcript = await this.transport.transcribe(audioB64, "audio/wav");
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
      this.setState("listening");
    }
  }

  // ---- listen() ------------------------------------------------------------

  async listen(): Promise<string> {
    // Only one listen at a time; cancel any prior.
    if (this.pendingListen && !this.pendingListen.settled) {
      this.cancelListen();
    }
    await this.init();
    if (!this.vad) {
      throw { kind: "vad", message: "VAD is not initialized." } as VoiceError;
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failListen({
          kind: "timeout",
          message: `No complete utterance within ${this.maxListenMs}ms.`,
        });
      }, this.maxListenMs);

      this.pendingListen = { resolve, reject, timer, settled: false };

      // Begin capturing. We surface "listening" immediately so the orb reacts
      // to mic level even before the first speech-start fires.
      this.setState("listening");
      try {
        this.vad!.start();
      } catch (e) {
        this.failListen({ kind: "vad", message: "Failed to start the VAD.", cause: e });
      }
    });
  }

  cancelListen(): void {
    if (!this.pendingListen || this.pendingListen.settled) return;
    this.failListen({ kind: "unknown", message: "Listen cancelled." });
  }

  private resolveListen(transcript: string) {
    const p = this.pendingListen;
    if (!p || p.settled) return;
    p.settled = true;
    if (p.timer) clearTimeout(p.timer);
    this.pendingListen = null;
    try {
      this.vad?.pause();
    } catch {
      /* ignore */
    }
    this.setState("idle");
    p.resolve(transcript);
  }

  private failListen(err: VoiceError) {
    const p = this.pendingListen;
    if (!p || p.settled) return;
    p.settled = true;
    if (p.timer) clearTimeout(p.timer);
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

    let audioB64: string;
    let contentType: string;
    try {
      const res = await this.transport.synthesize(text, this.voice, this.speed);
      audioB64 = res.audioB64;
      contentType = res.contentType || "audio/mpeg";
    } catch (e) {
      const err: VoiceError = { kind: "network", message: "Text-to-speech request failed.", cause: e };
      this.emitError(err);
      throw err;
    }

    return new Promise<void>((resolve, reject) => {
      this.pendingSpeak = { resolve, reject, settled: false };

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
        el.removeEventListener("ended", onEnded);
        el.removeEventListener("error", onError);
      };

      el.addEventListener("play", onPlaying);
      el.addEventListener("playing", onPlaying);
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

  private finishSpeak() {
    this.teardownPlayback();
    const p = this.pendingSpeak;
    if (this.state === "speaking") this.setState("idle");
    if (!p || p.settled) return;
    p.settled = true;
    this.pendingSpeak = null;
    p.resolve();
  }

  private failSpeak(err: VoiceError) {
    this.teardownPlayback();
    if (this.state === "speaking") this.setState("idle");
    const p = this.pendingSpeak;
    this.emitError(err);
    if (!p || p.settled) return;
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
    this.micSource = null;
    this.inputAnalyser = null;
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
    this.previewActive = false;
    this.unbindDeviceChange();
    this.devicesChangedCbs.clear();
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
