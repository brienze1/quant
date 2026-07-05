// Voice-mode transition earcons.
//
// Short, synthesized audio cues that mark the voice conversation's state
// transitions (listening / thinking / speaking / ended / error) so the user
// gets non-visual feedback about what the assistant is doing. Tones are
// generated with the Web Audio API — no bundled audio assets, works fully
// offline, and stays in line with the local-only voice feature.
//
// Kept deliberately quiet + brief (< ~200ms) so the "listening" cue, which
// plays as the mic opens, can't register as real speech to the VAD (its
// minSpeech / pre-speech padding ignore a blip this short) and so the cues
// never talk over the conversation.

import type { VoiceServiceState } from "./types";

// A cue is one or two enveloped sine "blips". Frequencies in Hz, per-note
// duration in seconds. Two ascending notes read as "opening"; two descending as
// "closing"; a single note as a neutral tick.
interface CueSpec {
  notes: number[];
  noteDur: number;
  gain: number;
  type: OscillatorType;
}

// Per-transition earcons. Frequencies sit in a soft, pleasant mid range; gains
// are low so the cues are felt, not intrusive.
const CUES: Record<string, CueSpec> = {
  // Turn opened, mic live — a light rising two-note "go ahead".
  listening: { notes: [660, 880], noteDur: 0.075, gain: 0.06, type: "sine" },
  // Long-form recording pinned open — a slightly brighter open.
  recording: { notes: [700, 940], noteDur: 0.07, gain: 0.06, type: "sine" },
  // User turn ended, processing — a single soft mid tick.
  thinking: { notes: [560], noteDur: 0.09, gain: 0.05, type: "sine" },
  // Assistant begins speaking — a gentle low presence note.
  speaking: { notes: [520], noteDur: 0.08, gain: 0.045, type: "sine" },
  // Conversation returned to idle / ended — a soft falling two-note.
  ended: { notes: [660, 440], noteDur: 0.085, gain: 0.05, type: "sine" },
  // Something failed — a low, duller two-note to read as "problem".
  error: { notes: [320, 240], noteDur: 0.11, gain: 0.06, type: "triangle" },
};

// A dedicated output-only AudioContext, separate from the capture graph so cues
// never interfere with mic/VAD wiring. Created lazily on first use (needs a
// user gesture to start on WebKit — the voice pane has one by the time a
// transition fires).
let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Whether cues are enabled (config-backed; the pane toggles this on mount).
let enabled = true;
export function setVoiceCuesEnabled(on: boolean) {
  enabled = on;
}

// Play one earcon by key. Best-effort and never throws — audio is a nicety, not
// a correctness requirement.
function play(spec: CueSpec) {
  const ac = ensureCtx();
  if (!ac) return;
  try {
    const start = ac.currentTime + 0.001;
    spec.notes.forEach((freq, i) => {
      const t0 = start + i * spec.noteDur;
      const t1 = t0 + spec.noteDur;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(freq, t0);
      // Quick attack + smooth exponential release so each note is a soft blip
      // with no click at the edges.
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(spec.gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      osc.connect(g).connect(ac.destination);
      osc.start(t0);
      osc.stop(t1 + 0.02);
    });
  } catch {
    /* ignore — cue is best-effort */
  }
}

// playTransitionCue picks the earcon for a state change and plays it. `prev` is
// the state we're leaving (so we only play the "ended" cue when returning to
// idle from an active turn, never on the initial idle mount). No-op when cues
// are disabled or the transition has no cue.
export function playTransitionCue(next: VoiceServiceState, prev: VoiceServiceState) {
  if (!enabled) return;
  if (next === prev) return;
  if (next === "idle") {
    // Only chime when an actual turn wound down (not the mount-time idle).
    if (prev !== "idle") play(CUES.ended);
    return;
  }
  const spec = CUES[next];
  if (spec) play(spec);
}

// playErrorCue is a distinct cue for a voice error surfacing.
export function playErrorCue() {
  if (!enabled) return;
  play(CUES.error);
}
