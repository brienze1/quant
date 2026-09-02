// Helpers for state that is refreshed on a timer.
//
// The sidebar polls sessions, tasks, crew state and per-session actions every
// couple of seconds. Almost every poll comes back identical to the last one,
// but the naive `setState({ ...prev, [key]: list })` allocates a new object
// every time, so React re-rendered the whole app several times a second
// forever — a constant CPU and energy cost for a UI that had not changed.
//
// Returning the PREVIOUS state object unchanged makes React bail out of the
// render entirely, so a quiet app really is quiet.

/** Structural equality, good enough for the plain JSON the backend returns. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Updates one key of a record, returning the same object reference when the
 * value has not changed.
 */
export function mergeKey<T>(prev: Record<string, T>, key: string, value: T): Record<string, T> {
  if (key in prev && sameData(prev[key], value)) return prev;
  return { ...prev, [key]: value };
}

/** Replaces state wholesale, keeping the previous reference when unchanged. */
export function replaceIfChanged<T>(prev: T, next: T): T {
  return sameData(prev, next) ? prev : next;
}
