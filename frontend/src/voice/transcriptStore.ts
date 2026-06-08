// Per-session voice transcript persistence (localStorage).
//
// The voice transcript is conversation history the user wants to keep across
// pane close/reopen, tab switches, and page refreshes. We persist it the same
// browser/machine-scoped way as the selected input device + the mindmap's
// active board: localStorage keyed by sessionId. (It is intentionally NOT
// Go/DB-backed — it's a UI convenience tied to this client.)

/** One rendered transcript line. Mirrors VoicePane's TranscriptLine. */
export interface StoredTranscriptLine {
  id: number;
  who: "you" | "quant";
  text: string;
}

const KEY_PREFIX = "quant.voiceTranscript.";
// Cap stored history so a long-running session can't grow localStorage without
// bound. Keep the most recent N turns.
const MAX_LINES = 200;

function keyFor(sessionId: string): string {
  return KEY_PREFIX + sessionId;
}

/** Load a session's persisted transcript (empty array if none/invalid). */
export function loadTranscript(sessionId: string): StoredTranscriptLine[] {
  if (!sessionId) return [];
  try {
    const raw = window.localStorage.getItem(keyFor(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: keep only well-formed entries.
    return parsed.filter(
      (l): l is StoredTranscriptLine =>
        l &&
        typeof l.id === "number" &&
        (l.who === "you" || l.who === "quant") &&
        typeof l.text === "string",
    );
  } catch {
    return [];
  }
}

/** Persist a session's transcript (best-effort; trimmed to MAX_LINES). */
export function saveTranscript(sessionId: string, lines: StoredTranscriptLine[]): void {
  if (!sessionId) return;
  try {
    const trimmed = lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines;
    if (trimmed.length === 0) {
      window.localStorage.removeItem(keyFor(sessionId));
      return;
    }
    window.localStorage.setItem(keyFor(sessionId), JSON.stringify(trimmed));
  } catch {
    /* ignore — persistence is best-effort */
  }
}

/** The next line id to use given an already-loaded transcript. */
export function nextLineId(lines: StoredTranscriptLine[]): number {
  let max = -1;
  for (const l of lines) if (l.id > max) max = l.id;
  return max + 1;
}
