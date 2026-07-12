// Live terminal font-size state, shared across all TerminalPane instances via
// a window CustomEvent so Cmd+=/Cmd+-/Cmd+0 can resize existing terminals
// in place (mutating `term.options.fontSize`) without recreating them, while
// newly mounted terminals read the latest value from `getLiveFontSize()`.

let liveFontSize: number | null = null;

export function getLiveFontSize(): number | null {
  return liveFontSize;
}

export function setLiveFontSize(n: number): void {
  liveFontSize = n;
  window.dispatchEvent(new CustomEvent("terminal:fontsize", { detail: n }));
}

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;
export const FONT_SIZE_DEFAULT = 13;
