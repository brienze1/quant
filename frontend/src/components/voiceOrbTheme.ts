import { parseHex } from "../theme/mapper";

// Theme-token reading + luminance helpers for the VoiceOrb.
//
// The orb's color is driven by the active quant theme. Themes are applied by
// `src/theme/provider.tsx`, which writes `--q-*` custom properties onto
// `document.documentElement`. We read them back with getComputedStyle so the
// orb stays in sync with whatever theme is active (and works in the dev harness
// where tokens are injected the same way).

export interface OrbThemeTokens {
  /** Resolved hex/rgb string for --q-accent (orb base accent). */
  accent: string;
  /** Resolved string for --q-bg (used only for light/dark detection). */
  bg: string;
  /** Accent used for the "speaking" state (falls back to accent). */
  speakAccent: string;
  /** Accent used for the "thinking" state (falls back to a warm tone / accent). */
  thinkAccent: string;
  /** True when the app background is light -> use the light-theme glow recipe. */
  isLight: boolean;
}

const FALLBACK_ACCENT = "#10B981";
const FALLBACK_BG = "#0A0A0A";

/** Parse a CSS color string (#rgb, #rrggbb, rgb(), rgba()) into [r,g,b] 0..255. */
export function parseColor(input: string): [number, number, number] | null {
  const s = (input || "").trim();
  if (!s) return null;

  if (s[0] === "#") {
    // Reuse the shared hex parser from theme/mapper. It handles 3/6-digit hex;
    // we keep parseColor's contract of returning null for any other length or
    // non-hex digits (parseHex yields NaN components for those).
    const hex = s.slice(1);
    if (hex.length !== 3 && hex.length !== 6) return null;
    const rgb = parseHex(hex);
    if (rgb.some((v) => Number.isNaN(v))) return null;
    return rgb;
  }

  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
    if (parts.length >= 3 && parts.every((p, i) => i > 2 || !Number.isNaN(p))) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}

/** Relative luminance 0..1 (sRGB-ish, good enough for light/dark detection). */
export function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isLightColor(input: string): boolean {
  const rgb = parseColor(input);
  if (!rgb) return false;
  return luminance(rgb) > 0.5;
}

/**
 * Read the orb's theme tokens off a themed element (defaults to the document
 * root, where the ThemeProvider applies them). Returns resolved color strings
 * plus an `isLight` flag derived from --q-bg luminance.
 */
export function readOrbTheme(el?: HTMLElement | null): OrbThemeTokens {
  const root =
    el || (typeof document !== "undefined" ? document.documentElement : null);
  const cs = root ? getComputedStyle(root) : null;

  const get = (name: string, fallback: string): string => {
    const v = cs?.getPropertyValue(name).trim();
    return v && v.length > 0 ? v : fallback;
  };

  const accent = get("--q-accent", FALLBACK_ACCENT);
  const bg = get("--q-bg", FALLBACK_BG);
  // --q-blue/--q-cyan make a nice "speaking" shift; fall back to accent.
  const speakAccent = get("--q-blue", get("--q-cyan", accent));
  // --q-warning gives the "thinking" warm tone; fall back to accent.
  const thinkAccent = get("--q-warning", accent);

  return {
    accent,
    bg,
    speakAccent,
    thinkAccent,
    isLight: isLightColor(bg),
  };
}
