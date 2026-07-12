// Push-to-talk capture service. No VAD: the press/release (or toggle) defines
// the utterance. Captures raw PCM from the mic and streams the transcript LIVE
// into the target session's input line: while recording, the full accumulated
// audio is re-transcribed every ~2.5s and only the words the last two
// consecutive partials AGREE on are committed (LocalAgreement-2). Whisper
// revises its tail between passes and text written to the PTY cannot be taken
// back, so commits are strictly append-only; a final full-audio pass on stop
// emits whatever suffix remains. Singleton shared by the toolbar button and
// the global hotkeys so either can stop a capture the other started.

import { utils } from "@ricky0123/vad-web";
import * as api from "../api";
import { openMicStreamFor, readPersistedInputDevice } from "./audioService";

export type PttState = "idle" | "recording" | "transcribing" | "error";
export type PttMode = "hold" | "toggle";
export type PttStateCb = (state: PttState) => void;
export type PttPartialTextCb = (sessionId: string, deltaText: string) => void;
export type PttErrorCb = (message: string) => void;

// Captures shorter than this are treated as accidental taps and discarded —
// but only when nothing has been streamed into the input yet.
const MIN_CAPTURE_MS = 300;
// Safety ceiling: auto-stop (and transcribe) a forgotten capture.
const MAX_CAPTURE_MS = 90_000;
// How long the button sits in the "error" state before relaxing to idle.
const ERROR_RESET_MS = 2500;
// STT expects what the voice pane sends: 16kHz mono float32 WAV.
const TARGET_SAMPLE_RATE = 16_000;
// Partial-transcription cadence while recording. A tick is skipped while the
// previous transcribe call is still in flight.
const PARTIAL_INTERVAL_MS = 2500;
// Whisper non-speech artifacts: [BLANK_AUDIO], [ Silence ], (music), ♪ …
const ARTIFACT_RE = /\[[^\]]*\]|\([^)]*\)|♪+/g;

// Mic contention with the voice pane: the pane mirrors its AudioService state
// into this flag (non-idle = busy) so PTT refuses to grab the mic mid-turn.
let voicePaneMicBusy = false;

export function setVoicePaneMicBusy(busy: boolean): void {
  voicePaneMicBusy = busy;
}

export function isVoicePaneMicBusy(): boolean {
  return voicePaneMicBusy;
}

// Live voice-pane state mirror (idle/listening/recording/thinking/speaking),
// set by VoicePane alongside the mic-busy flag. Lets shells reflect the
// conversation while the pane itself is hidden — e.g. the mobile mini-player
// showing "speaking" while the voice sheet is minimized. Subscribe/get pair is
// useSyncExternalStore-compatible.
let voicePaneState = "idle";
const voicePaneStateSubs = new Set<() => void>();

export function setVoicePaneState(state: string): void {
  if (voicePaneState === state) return;
  voicePaneState = state;
  voicePaneStateSubs.forEach((fn) => {
    try {
      fn();
    } catch {
      /* never let a subscriber break the voice loop */
    }
  });
}

export function getVoicePaneState(): string {
  return voicePaneState;
}

export function subscribeVoicePaneState(fn: () => void): () => void {
  voicePaneStateSubs.add(fn);
  return () => {
    voicePaneStateSubs.delete(fn);
  };
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

// Normalize a raw Whisper transcript into words: strip non-speech artifacts,
// collapse all whitespace (incl. \r\n — a newline reaching the PTY would
// auto-submit), and split. An all-artifact transcript yields [].
function transcriptWords(raw: string): string[] {
  return raw
    .replace(ARTIFACT_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0);
}

// Whisper flips punctuation/capitalization on earlier words between passes
// ("world" vs "world,"); compare normalized so cosmetic revisions don't break
// prefix agreement and re-emit already-committed words.
function wordsMatch(a: string, b: string): boolean {
  const norm = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return norm(a) === norm(b);
}

function normalizedCommonPrefixLen(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && wordsMatch(a[i], b[i])) i++;
  return i;
}

class PttService {
  private state: PttState = "idle";
  private readonly stateCbs = new Set<PttStateCb>();
  private readonly partialTextCbs = new Set<PttPartialTextCb>();
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

  // --- Live-streaming state (reset per capture) ---
  // Words already emitted into the input this capture. Append-only.
  private committedWords: string[] = [];
  // The previous partial transcript's words: the LocalAgreement-2 reference.
  private lastPartialWords: string[] = [];
  private partialTimer: ReturnType<typeof setInterval> | null = null;
  private partialInFlight = false;
  // Bumped on every start/stop/cancel so a partial result that lands after the
  // capture ended is discarded instead of committing into the next capture.
  private captureGen = 0;
  // Whether the last text we wrote into each session's input ended with a
  // space — decides if a delta needs a leading separator space.
  private readonly sentEndsWithSpace = new Map<string, boolean>();

  onState(cb: PttStateCb): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  /**
   * Fires with append-only text deltas (live partial commits while recording,
   * then the final suffix + trailing space on stop). Spacing between word
   * groups is already baked into the delta; never contains \r or \n.
   */
  onPartialText(cb: PttPartialTextCb): () => void {
    this.partialTextCbs.add(cb);
    return () => this.partialTextCbs.delete(cb);
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
      this.committedWords = [];
      this.lastPartialWords = [];
      this.partialInFlight = false;
      this.captureGen++;
      this.capTimer = setTimeout(() => void this.stop(), MAX_CAPTURE_MS);
      this.partialTimer = setInterval(() => void this.partialTick(), PARTIAL_INTERVAL_MS);
      this.setState("recording");
    } catch {
      this.teardownCapture();
      this.fail("Microphone access was denied or is unavailable.");
    } finally {
      this.starting = false;
    }
  }

  // One live-streaming tick: re-transcribe the FULL accumulated audio (cheap
  // enough — local Whisper, 90s cap) and commit only the words the last two
  // partials agree on, past what's already been emitted.
  private async partialTick(): Promise<void> {
    if (this.partialInFlight || this.state !== "recording") return;
    const gen = this.captureGen;
    const sessionId = this.targetSessionId;
    if (!sessionId || this.chunks.length === 0) return;
    this.partialInFlight = true;
    try {
      const audioB64 = this.encodeAudio(this.chunks.slice(), this.captureRate);
      const raw = await api.transcribe(audioB64, "audio/wav");
      // Capture ended (or was replaced) while transcribing — drop the result.
      if (gen !== this.captureGen || this.state !== "recording") return;
      const words = transcriptWords(raw);
      const agreed = normalizedCommonPrefixLen(this.lastPartialWords, words);
      // Only commit if the new hypothesis still extends the committed prefix;
      // on index shift (inserted/merged leading words) skip and let the final
      // pass resolve.
      const extendsCommitted =
        normalizedCommonPrefixLen(this.committedWords, words) === this.committedWords.length;
      if (extendsCommitted && agreed > this.committedWords.length) {
        const fresh = words.slice(this.committedWords.length, agreed);
        this.committedWords.push(...fresh);
        this.emitDelta(sessionId, fresh, false);
      }
      this.lastPartialWords = words;
    } catch {
      // Whisper down mid-stream: stop the loop, one error, already-inserted
      // text stays (it can't be retracted anyway).
      if (gen !== this.captureGen || this.state !== "recording") return;
      this.captureGen++;
      this.chunks = [];
      this.teardownCapture();
      this.fail("Push-to-talk transcription failed.");
    } finally {
      this.partialInFlight = false;
    }
  }

  /**
   * Stop capturing and run the final full-audio pass: emit the final
   * transcript's suffix beyond the committed words, plus one trailing space.
   * Committed text always stands — if the final transcript diverges from it,
   * the suffix past their common word-prefix is appended as-is.
   */
  async stop(): Promise<void> {
    if (this.starting) {
      this.abortRequested = true;
      return;
    }
    if (this.state !== "recording") return;
    const sessionId = this.targetSessionId;
    const elapsed = performance.now() - this.startedAt;
    const chunks = this.chunks;
    const rate = this.captureRate;
    const committed = this.committedWords;
    this.captureGen++;
    this.chunks = [];
    this.teardownCapture();
    if ((elapsed < MIN_CAPTURE_MS && committed.length === 0) || chunks.length === 0 || !sessionId) {
      this.setState("idle");
      return;
    }
    this.setState("transcribing");
    try {
      const audioB64 = this.encodeAudio(chunks, rate);
      const finalWords = transcriptWords(await api.transcribe(audioB64, "audio/wav"));
      const agreed = normalizedCommonPrefixLen(committed, finalWords);
      this.emitDelta(sessionId, finalWords.slice(agreed), true);
      this.setState("idle");
    } catch {
      this.fail("Push-to-talk transcription failed.");
    }
  }

  /**
   * Abort the current capture: no final pass, but whatever was already
   * streamed into the input stays — it cannot be retracted.
   */
  cancel(): void {
    if (this.starting) {
      this.abortRequested = true;
      return;
    }
    if (this.state !== "recording") return;
    this.captureGen++;
    this.chunks = [];
    this.teardownCapture();
    this.setState("idle");
  }

  private encodeAudio(chunks: Float32Array[], rate: number): string {
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
    return utils.arrayBufferToBase64(wav);
  }

  // Build + emit one append-only delta. Words are space-joined; a leading
  // separator space is added only when the last text written to this session
  // didn't already end with one. `trailingSpace` (final pass) makes the next
  // dictation compose cleanly.
  private emitDelta(sessionId: string, words: string[], trailingSpace: boolean): void {
    const endsWithSpace = this.sentEndsWithSpace.get(sessionId) ?? true;
    let delta = words.join(" ");
    if (delta && !endsWithSpace) delta = " " + delta;
    if (trailingSpace && !delta.endsWith(" ") && (delta || !endsWithSpace)) delta += " ";
    if (!delta) return;
    this.sentEndsWithSpace.set(sessionId, delta.endsWith(" "));
    for (const cb of this.partialTextCbs) {
      try {
        cb(sessionId, delta);
      } catch {
        /* never let a subscriber break the pipeline */
      }
    }
  }

  private teardownCapture(): void {
    if (this.capTimer) {
      clearTimeout(this.capTimer);
      this.capTimer = null;
    }
    if (this.partialTimer) {
      clearInterval(this.partialTimer);
      this.partialTimer = null;
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
