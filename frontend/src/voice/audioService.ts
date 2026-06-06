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
  AudioServiceOptions,
  IAudioService,
  VoiceError,
  VoiceErrorCb,
  VoiceServiceState,
  VoiceStateCb,
  VoiceTransport,
} from "./types";

const DEFAULT_VAD_ASSET_PATH = "/vad/";
const DEFAULT_MAX_LISTEN_MS = 30_000;

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
  private bargeIn: boolean;

  private state: VoiceServiceState = "idle";
  private readonly stateCbs = new Set<VoiceStateCb>();
  private readonly errorCbs = new Set<VoiceErrorCb>();

  // Capture graph.
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private vad: MicVAD | null = null;
  private initPromise: Promise<void> | null = null;

  // Playback graph (TTS).
  private audioEl: HTMLAudioElement | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private playbackSource: MediaElementAudioSourceNode | null = null;

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
    this.bargeIn = opts.bargeIn ?? false;
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

  private async doInit(): Promise<void> {
    // 1. Mic.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const err: VoiceError = {
        kind: "permission",
        message: "Microphone access was denied or is unavailable.",
        cause: e,
      };
      this.emitError(err);
      throw err;
    }
    this.stream = stream;

    // 2. AudioContext + input analyser (drives the orb's listening level).
    const AC: typeof AudioContext =
      window.AudioContext ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext;
    const ctx = new AC();
    this.audioCtx = ctx;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* resumed lazily on first user gesture in some browsers */
      }
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    this.inputAnalyser = analyser;
    this.micSource = ctx.createMediaStreamSource(stream);
    this.micSource.connect(analyser);
    // NOTE: analyser is intentionally NOT connected to ctx.destination (no echo).

    // 3. VAD — self-hosted assets, offline-safe, no CDN.
    try {
      this.vad = await MicVAD.new({
        model: this.vadModel,
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
    // Barge-in: user started talking while TTS is playing → pause playback.
    if (this.bargeIn && this.state === "speaking" && this.audioEl && !this.audioEl.paused) {
      try {
        this.audioEl.pause();
      } catch {
        /* ignore */
      }
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

      const onPlaying = () => this.setState("speaking");
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

  async dispose(): Promise<void> {
    this.cancelListen();
    this.stopSpeaking();
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
    try {
      await this.audioCtx?.close();
    } catch {
      /* ignore */
    }
    this.audioCtx = null;
    this.initPromise = null;
    this.setState("idle");
  }
}

/** Factory mirroring the class for callers that prefer a function. */
export function createAudioService(opts?: AudioServiceOptions): IAudioService {
  return new AudioService(opts);
}

export type { IAudioService, AudioServiceOptions, VoiceServiceState, VoiceTransport };
