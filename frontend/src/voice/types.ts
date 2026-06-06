// Types for the frontend voice audio service (WI-2.2).
//
// The service owns the browser-side audio pipeline: mic capture + Web Audio
// analyser (for the orb), VAD endpointing (@ricky0123/vad-web, Silero v5,
// self-hosted assets), STT (Go proxy), and TTS playback (Go proxy). It is a
// pure-TS service with no React/DOM-component dependency so it can be driven
// from a dev harness, Playwright, and later from VoicePane.tsx.

/** The four orb-visible states. `thinking` = VAD ended, STT/agent in flight. */
export type VoiceServiceState = "idle" | "listening" | "thinking" | "speaking";

export type VoiceStateCb = (state: VoiceServiceState) => void;

export interface VoiceError {
  /** Coarse category so the UI can branch (permission/network/etc). */
  kind: "permission" | "network" | "vad" | "stt" | "tts" | "playback" | "timeout" | "unknown";
  message: string;
  /** Original error, if any. */
  cause?: unknown;
}

export type VoiceErrorCb = (err: VoiceError) => void;

/**
 * STT/TTS transport, injectable so tests/harness can pass mocks instead of the
 * Wails-bridged api.ts functions (which throw outside the desktop app).
 *
 * - `transcribe(audioB64, mime)` → transcript string.
 * - `synthesize(text, voice, speed)` → { audioB64, contentType }.
 *   (Pass "" / 0 to use the server defaults am_onyx / 1.2.)
 */
export interface VoiceTransport {
  transcribe(audioB64: string, mime: string): Promise<string>;
  synthesize(
    text: string,
    voice: string,
    speed: number,
  ): Promise<{ audioB64: string; contentType: string }>;
}

export interface AudioServiceOptions {
  /** Injected STT/TTS transport. Defaults to the api.ts wrappers. */
  transport?: VoiceTransport;
  /**
   * Base URL (relative to the app root) where the self-hosted VAD assets live:
   * `vad.worklet.bundle.min.js` + `silero_vad_v5.onnx`. Must end with `/`.
   * Default: "/vad/".
   */
  vadAssetPath?: string;
  /**
   * Base URL where the onnxruntime-web WASM binaries live (`ort-wasm-*`). Must
   * end with `/`. Default: same as `vadAssetPath` ("/vad/").
   */
  onnxWasmPath?: string;
  /** Silero model variant. Default "v5". */
  vadModel?: "v5" | "legacy";
  /** Max time (ms) a single listen() will wait for a complete utterance. */
  maxListenMs?: number;
  /** TTS voice id; "" → server default (am_onyx). */
  voice?: string;
  /** TTS speed; 0 → server default (1.2). */
  speed?: number;
  /** Enable barge-in: pause TTS when VAD detects speech during playback. */
  bargeIn?: boolean;
  /**
   * VAD endpointing knobs (WI-5.6). All optional — sensible conversational
   * defaults are used when omitted. These map onto @ricky0123/vad-web's
   * FrameProcessorOptions. A single `sensitivity` 0..1 can also be supplied to
   * derive the positive/negative thresholds without setting them individually.
   */
  vad?: VadTuning;
}

/**
 * VAD endpointing tuning (WI-5.6). Higher `sensitivity` triggers on quieter /
 * less-certain speech (more eager, more false positives); lower is stricter.
 * Individual thresholds, if given, win over `sensitivity`.
 */
export interface VadTuning {
  /**
   * Convenience 0..1 knob (default 0.5). Maps to a positive speech threshold of
   * ~0.6 (at 0.5) and a negative threshold 0.15 below it (Silero's convention).
   * Higher = more sensitive. Ignored for any threshold set explicitly below.
   */
  sensitivity?: number;
  /** Silero score above which a frame counts as speech (0..1). */
  positiveSpeechThreshold?: number;
  /** Silero score below which a frame counts as silence (0..1). */
  negativeSpeechThreshold?: number;
  /** Grace period (ms) of silence before firing speech-end (endpointing). */
  redemptionMs?: number;
  /** Audio (ms) prepended to the captured utterance so it isn't clipped. */
  preSpeechPadMs?: number;
  /** Minimum speech (ms); shorter blips fire onVADMisfire instead of end. */
  minSpeechMs?: number;
}

/** Public surface of the audio service. */
export interface IAudioService {
  /** Subscribe to state changes. Returns an unsubscribe fn. */
  onState(cb: VoiceStateCb): () => void;
  /** Subscribe to errors. Returns an unsubscribe fn. */
  onError(cb: VoiceErrorCb): () => void;
  /** Current state. */
  getState(): VoiceServiceState;

  /** Input (mic) analyser for the orb's listening reactivity. */
  getInputAnalyser(): AnalyserNode | null;
  /** Output (TTS playback) analyser for the orb's speaking reactivity. */
  getOutputAnalyser(): AnalyserNode | null;

  /** Open the mic + warm up VAD/AudioContext (idempotent). */
  init(): Promise<void>;

  /**
   * Capture one VAD-endpointed utterance, run STT, resolve with the transcript.
   * Opens the mic if needed. Honors maxListenMs. Rejects on error/cancel.
   */
  listen(): Promise<string>;

  /** Cancel an in-flight listen() (rejects its promise with a cancel error). */
  cancelListen(): void;

  /** Synthesize + play `text`; resolve on playback end. */
  speak(text: string): Promise<void>;

  /** Stop any current playback immediately (resolves the in-flight speak()). */
  stopSpeaking(): void;

  /** Enable/disable barge-in at runtime. */
  setBargeIn(enabled: boolean): void;

  /** Release the mic + audio resources. */
  dispose(): Promise<void>;
}
