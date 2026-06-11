// Push-to-talk capture service. No VAD: the press/release (or toggle) defines
// the utterance. Captures raw PCM from the mic, encodes a 16kHz WAV, runs STT
// via the Go proxy, and emits the transcript for insertion into the target
// session's input line. Singleton shared by the toolbar button and the global
// hotkeys so either can stop a capture the other started.

import { utils } from "@ricky0123/vad-web";
import * as api from "../api";
import { openMicStreamFor, readPersistedInputDevice } from "./audioService";

export type PttState = "idle" | "recording" | "transcribing" | "error";
export type PttMode = "hold" | "toggle";
export type PttStateCb = (state: PttState) => void;
export type PttTranscriptCb = (sessionId: string, transcript: string) => void;
export type PttErrorCb = (message: string) => void;

// Captures shorter than this are treated as accidental taps and discarded.
const MIN_CAPTURE_MS = 300;
// Safety ceiling: auto-stop (and transcribe) a forgotten capture.
const MAX_CAPTURE_MS = 90_000;
// How long the button sits in the "error" state before relaxing to idle.
const ERROR_RESET_MS = 2500;
// STT expects what the voice pane sends: 16kHz mono float32 WAV.
const TARGET_SAMPLE_RATE = 16_000;

// Mic contention with the voice pane: the pane mirrors its AudioService state
// into this flag (non-idle = busy) so PTT refuses to grab the mic mid-turn.
let voicePaneMicBusy = false;

export function setVoicePaneMicBusy(busy: boolean): void {
  voicePaneMicBusy = busy;
}

export function isVoicePaneMicBusy(): boolean {
  return voicePaneMicBusy;
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

class PttService {
  private state: PttState = "idle";
  private readonly stateCbs = new Set<PttStateCb>();
  private readonly transcriptCbs = new Set<PttTranscriptCb>();
  private readonly errorCbs = new Set<PttErrorCb>();

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private sink: GainNode | null = null;

  private chunks: Float32Array[] = [];
  private captureRate = TARGET_SAMPLE_RATE;
  private startedAt = 0;
  private targetSessionId: string | null = null;
  private mode: PttMode = "toggle";
  private starting = false;
  // stop()/cancel() arrived while start() was still acquiring the mic; the
  // pending start tears everything down instead of leaving the capture hot.
  private abortRequested = false;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private levelBuf: Uint8Array | null = null;

  onState(cb: PttStateCb): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  /** Fires with the trimmed transcript for BOTH manual stops and the auto-cap. */
  onTranscript(cb: PttTranscriptCb): () => void {
    this.transcriptCbs.add(cb);
    return () => this.transcriptCbs.delete(cb);
  }

  onError(cb: PttErrorCb): () => void {
    this.errorCbs.add(cb);
    return () => this.errorCbs.delete(cb);
  }

  getState(): PttState {
    return this.state;
  }

  getTargetSessionId(): string | null {
    return this.targetSessionId;
  }

  /** How the current capture was started; "hold" captures are cancelled on blur. */
  getMode(): PttMode {
    return this.mode;
  }

  /** Reclassify an in-flight capture (button quick-click upgrades hold → toggle). */
  setMode(mode: PttMode): void {
    this.mode = mode;
  }

  isCapturing(): boolean {
    return this.state === "recording";
  }

  /** Peak input level 0..1 while recording (0 otherwise). */
  getLevel(): number {
    const analyser = this.analyser;
    if (!analyser) return 0;
    const n = analyser.fftSize;
    if (!this.levelBuf || this.levelBuf.length !== n) {
      this.levelBuf = new Uint8Array(n);
    }
    const buf = this.levelBuf;
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(buf[i] - 128);
      if (v > peak) peak = v;
    }
    return Math.min(1, peak / 128);
  }

  async start(sessionId: string, mode: PttMode): Promise<void> {
    if (this.starting || this.state === "recording" || this.state === "transcribing") return;
    if (voicePaneMicBusy) {
      this.fail("Voice pane is using the microphone — finish that turn first.");
      return;
    }
    this.mode = mode;
    this.abortRequested = false;
    this.starting = true;
    try {
      const stream = await openMicStreamFor(readPersistedInputDevice());
      this.stream = stream;
      const AC: typeof AudioContext =
        window.AudioContext ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
      }
      this.captureRate = ctx.sampleRate;
      this.source = ctx.createMediaStreamSource(stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      // 4096-sample blocks, mono. The processor must reach the destination or
      // WebKit never pulls it; route through a muted gain so it stays silent.
      this.processor = ctx.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (e) => {
        this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.analyser);
      this.source.connect(this.processor);
      this.processor.connect(this.sink);
      this.sink.connect(ctx.destination);

      // Released/stopped while getUserMedia was pending — let go of the mic
      // instead of entering a capture nothing will stop.
      if (this.abortRequested) {
        this.teardownCapture();
        return;
      }

      this.chunks = [];
      this.targetSessionId = sessionId;
      this.startedAt = performance.now();
      this.capTimer = setTimeout(() => void this.stop(), MAX_CAPTURE_MS);
      this.setState("recording");
    } catch {
      this.teardownCapture();
      this.fail("Microphone access was denied or is unavailable.");
    } finally {
      this.starting = false;
    }
  }

  /**
   * Stop capturing, transcribe, emit + return the trimmed transcript. Returns
   * "" for too-short captures, empty transcripts, or when not recording.
   */
  async stop(): Promise<string> {
    if (this.starting) {
      this.abortRequested = true;
      return "";
    }
    if (this.state !== "recording") return "";
    const sessionId = this.targetSessionId;
    const elapsed = performance.now() - this.startedAt;
    const chunks = this.chunks;
    const rate = this.captureRate;
    this.chunks = [];
    this.teardownCapture();
    if (elapsed < MIN_CAPTURE_MS || chunks.length === 0) {
      this.setState("idle");
      return "";
    }
    this.setState("transcribing");
    try {
      let total = 0;
      for (const c of chunks) total += c.length;
      const merged = new Float32Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      const samples = downsample(merged, rate, TARGET_SAMPLE_RATE);
      const wav = utils.encodeWAV(samples); // defaults match the voice pane: 16kHz mono float32
      const audioB64 = utils.arrayBufferToBase64(wav);
      // Whisper's text format can carry interior newlines (one per segment);
      // collapse them so no \r/\n ever reaches the PTY (would auto-submit).
      const transcript = (await api.transcribe(audioB64, "audio/wav"))
        .replace(/\s*[\r\n]+\s*/g, " ")
        .trim();
      this.setState("idle");
      if (transcript && sessionId) {
        for (const cb of this.transcriptCbs) {
          try {
            cb(sessionId, transcript);
          } catch {
            /* never let a subscriber break the pipeline */
          }
        }
      }
      return transcript;
    } catch {
      this.fail("Push-to-talk transcription failed.");
      return "";
    }
  }

  /** Discard the current capture without transcribing. */
  cancel(): void {
    if (this.starting) {
      this.abortRequested = true;
      return;
    }
    if (this.state !== "recording") return;
    this.chunks = [];
    this.teardownCapture();
    this.setState("idle");
  }

  private teardownCapture(): void {
    if (this.capTimer) {
      clearTimeout(this.capTimer);
      this.capTimer = null;
    }
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.analyser?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.sink?.disconnect();
    } catch {
      /* ignore */
    }
    this.processor = null;
    this.source = null;
    this.analyser = null;
    this.sink = null;
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
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  private fail(message: string): void {
    for (const cb of this.errorCbs) {
      try {
        cb(message);
      } catch {
        /* ignore */
      }
    }
    this.setState("error");
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      this.errorTimer = null;
      if (this.state === "error") this.setState("idle");
    }, ERROR_RESET_MS);
  }

  private setState(s: PttState): void {
    if (this.state === s) return;
    if (s !== "error" && this.errorTimer) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }
    this.state = s;
    for (const cb of this.stateCbs) {
      try {
        cb(s);
      } catch {
        /* ignore */
      }
    }
  }
}

export const pttService = new PttService();
