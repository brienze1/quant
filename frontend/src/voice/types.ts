// Types for the frontend voice audio service (WI-2.2).
//
// The service owns the browser-side audio pipeline: mic capture + Web Audio
// analyser (for the orb), VAD endpointing (@ricky0123/vad-web, Silero v5,
// self-hosted assets), STT (Go proxy), and TTS playback (Go proxy). It is a
// pure-TS service with no React/DOM-component dependency so it can be driven
// from a dev harness, Playwright, and later from VoicePane.tsx.

/**
 * The orb-visible states. `thinking` = VAD ended, STT/agent in flight.
 * `recording` = a listen turn the user pinned open: VAD segments are
 * transcribed as they end but the turn only resolves on an explicit stop.
 */
export type VoiceServiceState = "idle" | "listening" | "recording" | "thinking" | "speaking";

export type VoiceStateCb = (state: VoiceServiceState) => void;

/**
 * Live recording transcript callback: receives the accumulated transcript so
 * far (segments joined with "\n", in speech order) each time a recording
 * segment's STT resolves with text, and "" when the recording state is reset
 * so a new recording starts with a clean draft.
 */
export type RecordingTranscriptCb = (text: string) => void;

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
 *   (Pass "" / 0 to use the server defaults af_heart / 1.2.)
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
  /** TTS voice id; "" → server default (af_heart). */
  voice?: string;
  /** TTS speed; 0 → server default (1.2). */
  speed?: number;
  /** Enable barge-in: pause TTS when VAD detects speech during playback. */
  bargeIn?: boolean;
  /**
   * Suppress barge-in for this many ms after TTS playback starts, so the agent's
   * own opening syllable leaking through speakers can't self-interrupt the reply.
   * Default 1200. Set 0 to disable the guard.
   */
  bargeInGuardMs?: number;
  /**
   * Preferred input (microphone) deviceId. When omitted the service falls back
   * to the value persisted in localStorage (`quant.voice.inputDeviceId`), then
   * to the browser default. deviceIds are browser/machine-scoped, hence
   * localStorage rather than Go-side config.
   */
  inputDeviceId?: string;
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

/** Options for a single listen() turn. */
export interface ListenOptions {
  /**
   * Start the listen already pinned open in recording mode (long-form
   * dictation): equivalent to calling startRecording() the instant the turn is
   * armed, so the user never has to tap "rec". The turn then only resolves on
   * an explicit stop (stopRecording(), the spoken stop phrase, or the
   * recording safety ceiling). Default false — a normal single-utterance turn.
   */
  record?: boolean;
}

/** A selectable audio input (microphone). */
export interface AudioInputDevice {
  deviceId: string;
  /** Human label; falls back to `Microphone (id…)` when permission hides it. */
  label: string;
}

export type DevicesChangedCb = () => void;

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
   * With `opts.record` the turn starts already in recording mode (see
   * ListenOptions / startRecording()).
   */
  listen(opts?: ListenOptions): Promise<string>;

  /** Cancel an in-flight listen() (rejects its promise with a cancel error). */
  cancelListen(): void;

  /**
   * Pin the active listen() open as a long-form recording: VAD endpointing no
   * longer resolves the turn — each detected segment is transcribed immediately
   * and accumulated, and the per-listen maxListenMs timeout is disarmed (a
   * generous recording safety ceiling applies instead). No-op unless a listen()
   * is in flight and not already recording.
   */
  startRecording(): void;

  /**
   * Finalize a recording: flush any mid-speech segment, await the in-flight
   * segment transcriptions in order, and resolve the pending listen() with the
   * joined transcript. If nothing was captured, behaves like the existing
   * no-speech (timeout) path. No-op if not recording.
   */
  stopRecording(): Promise<void>;

  /** True while a listen() is pinned open in recording mode. */
  isRecording(): boolean;

  /**
   * Subscribe to the live recording transcript: while a recording is active,
   * fires with the accumulated text so far each time a segment's STT resolves
   * (newline-joined, speech order — same join stopRecording() uses), and with
   * "" when recording state resets. Returns an unsubscribe fn.
   */
  onRecordingTranscript(cb: RecordingTranscriptCb): () => void;

  /** Synthesize + play `text`; resolve on playback end. */
  speak(text: string): Promise<void>;

  /** Stop any current playback immediately (resolves the in-flight speak()). */
  stopSpeaking(): void;

  /** Enable/disable barge-in at runtime. */
  setBargeIn(enabled: boolean): void;

  /** Tune (or disable, with 0) the post-playback barge-in suppression window. */
  setBargeInGuardMs(ms: number): void;

  // ---- device selection + input metering -----------------------------------

  /**
   * Enumerate available audio input devices. Labels are empty until mic
   * permission is granted; this fills empties with a generic
   * `Microphone (id…)` name. See `hasDeviceLabels()` to know if real labels are
   * available (i.e. whether permission has been granted at least once).
   */
  listInputDevices(): Promise<AudioInputDevice[]>;

  /** True once the browser exposes real device labels (permission granted). */
  hasDeviceLabels(): Promise<boolean>;

  /**
   * Switch the active input device. Persists the choice to localStorage. Pass
   * `null` to clear the override and use the browser default. If capture/preview
   * is active it is torn down and re-initialised on the new device; otherwise
   * the choice is stored for the next init()/listen()/preview. An invalid
   * deviceId (OverconstrainedError) falls back to default and reports onError.
   */
  setInputDevice(deviceId: string | null): Promise<void>;

  /** The currently selected input deviceId (override), or null for default. */
  getInputDevice(): string | null;

  /** Subscribe to device list changes (hotplug). Returns an unsubscribe fn. */
  onDevicesChanged(cb: DevicesChangedCb): () => void;

  /**
   * Open the mic + an analyser purely for metering, without starting a VAD turn.
   * Lets the UI show a live input level while idle so the user can verify the
   * chosen mic. No-op (reuses the existing graph) if capture is already open.
   */
  startInputPreview(deviceId?: string): Promise<void>;

  /** Stop a preview-only capture. No-op if a real listen() owns the mic. */
  stopInputPreview(): void;

  /** Current input level 0..1 (peak/RMS) from the input analyser, 0 if none. */
  getInputLevel(): number;

  /** Current playback level 0..1 from the output analyser, 0 if none. */
  getOutputLevel(): number;

  /** Current AudioContext state, or "none" if not yet created. */
  getContextState(): string;

  /**
   * Resume the AudioContext. Call from a user-gesture handler — WKWebView/
   * autoplay policies keep a gesture-less context suspended, which leaves the
   * input analyser flat (dead level meter). No-op if not created or running.
   */
  resumeContext(): Promise<void>;

  /** Release the mic + audio resources. */
  dispose(): Promise<void>;
}
