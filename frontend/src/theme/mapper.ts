import type { VSCodeTheme, ThemeColors } from "./types";
import { QUANT_DARK } from "./defaults";

/**
 * Maps VS Code theme `colors` keys to our internal ThemeColors.
 * Falls back to sensible defaults derived from the theme type.
 */
export function mapVSCodeTheme(theme: VSCodeTheme): ThemeColors {
  const c = theme.colors;
  const isDark = theme.type !== "light";

  const fallback = isDark ? QUANT_DARK.colors : LIGHT_FALLBACKS;

  const get = (keys: string[], fb: string): string => {
    for (const key of keys) {
      if (c[key]) return c[key];
    }
    return fb;
  };

  const editorBg = get(["editor.background"], fallback.bg);
  const editorFg = get(["editor.foreground"], fallback.fg);
  const sidebarBg = get(["sideBar.background"], editorBg);
  const inputBg = get(["input.background"], fallback.bgInput);
  const borderColor = get(["editorGroup.border", "panel.border", "sideBar.border"], fallback.border);
  const hoverBg = get(["list.hoverBackground"], fallback.bgHover);
  const activeBg = get(["list.activeSelectionBackground"], hoverBg);
  // Accent: derive from the most vibrant/colorful source available.
  // Many themes use muted grays for button.background and focusBorder,
  // so we prefer terminal green or link colors which tend to be more vibrant.
  const accentColor = pickAccent(c, fallback.accent);
  const buttonBg = get(["button.background"], accentColor);
  const errorFg = get(["errorForeground", "editorError.foreground"], fallback.error);
  const warningFg = get(["editorWarning.foreground"], fallback.warning);
  const descFg = get(["descriptionForeground"], isDark ? mixColors(editorFg, editorBg, 0.5) : mixColors(editorFg, editorBg, 0.4));

  return {
    bg: editorBg,
    bgSubtle: get(["editorWidget.background"], isDark ? lighten(editorBg, 0.02) : darken(editorBg, 0.02)),
    bgInput: inputBg,
    bgElevated: get(["editorGroupHeader.tabsBackground"], isDark ? lighten(editorBg, 0.05) : darken(editorBg, 0.03)),
    bgMenu: get(["menu.background", "dropdown.background"], isDark ? lighten(editorBg, 0.08) : darken(editorBg, 0.05)),
    bgSurface: sidebarBg !== editorBg ? sidebarBg : get(["panel.background"], isDark ? lighten(editorBg, 0.06) : darken(editorBg, 0.03)),
    bgHover: hoverBg,
    bgInset: activeBg,

    border: borderColor,
    borderLight: get(["input.border", "tab.border"], lighten(borderColor, 0.05)),

    fg: editorFg,
    fgSecondary: descFg,
    fgMuted: get(["tab.inactiveForeground"], isDark ? mixColors(editorFg, editorBg, 0.35) : mixColors(editorFg, editorBg, 0.5)),
    fgTertiary: get(["editorLineNumber.foreground"], isDark ? mixColors(editorFg, editorBg, 0.45) : mixColors(editorFg, editorBg, 0.55)),
    fgDimmed: get(["menu.foreground", "dropdown.foreground"], isDark ? mixColors(editorFg, editorBg, 0.7) : mixColors(editorFg, editorBg, 0.8)),

    accent: accentColor,
    accentHover: get(["button.hoverBackground"], darken(accentColor, 0.1)),
    accentBgFaint: hexWithAlpha(accentColor, 0.1),

    error: errorFg,
    errorLight: lighten(errorFg, 0.15),
    errorBg: hexWithAlpha(errorFg, 0.15),
    warning: warningFg,
    warningLight: lighten(warningFg, 0.15),
    warningBg: hexWithAlpha(warningFg, 0.1),
    warningBorder: darken(warningFg, 0.3),
    cyan: get(["terminal.ansiCyan"], fallback.cyan),
    blue: get(["terminal.ansiBlue"], fallback.blue),
    blueBright: get(["terminal.ansiBrightBlue"], fallback.blueBright),
    blueLight: lighten(get(["terminal.ansiBlue"], fallback.blue), 0.2),
    purple: get(["terminal.ansiBrightMagenta"], fallback.purple),
    purpleLight: lighten(get(["terminal.ansiBrightMagenta"], fallback.purple), 0.1),
    magenta: get(["terminal.ansiMagenta"], fallback.magenta),

    termBg: get(["terminal.background"], editorBg),
    termFg: get(["terminal.foreground"], editorFg),
    termCursor: get(["terminalCursor.foreground"], accentColor),
    termBlack: get(["terminal.ansiBlack"], fallback.termBlack),
    termRed: get(["terminal.ansiRed"], fallback.termRed),
    termGreen: get(["terminal.ansiGreen"], fallback.termGreen),
    termYellow: get(["terminal.ansiYellow"], fallback.termYellow),
    termBlue: get(["terminal.ansiBlue"], fallback.termBlue),
    termMagenta: get(["terminal.ansiMagenta"], fallback.termMagenta),
    termCyan: get(["terminal.ansiCyan"], fallback.termCyan),
    termWhite: get(["terminal.ansiWhite"], fallback.termWhite),
    termBrightBlack: get(["terminal.ansiBrightBlack"], fallback.termBrightBlack),
    termBrightRed: get(["terminal.ansiBrightRed"], fallback.termBrightRed),
    termBrightGreen: get(["terminal.ansiBrightGreen"], fallback.termBrightGreen),
    termBrightYellow: get(["terminal.ansiBrightYellow"], fallback.termBrightYellow),
    termBrightBlue: get(["terminal.ansiBrightBlue"], fallback.termBrightBlue),
    termBrightMagenta: get(["terminal.ansiBrightMagenta"], fallback.termBrightMagenta),
    termBrightCyan: get(["terminal.ansiBrightCyan"], fallback.termBrightCyan),
    termBrightWhite: get(["terminal.ansiBrightWhite"], fallback.termBrightWhite),

    diffChangedBg: get(["diffEditor.insertedTextBackground"], fallback.diffChangedBg),
    diffRemovedBg: get(["diffEditor.removedTextBackground"], fallback.diffRemovedBg),
    diffCharHighlight: get(["diffEditor.insertedTextBackground"], fallback.diffCharHighlight),
    diffRemovedText: fallback.diffRemovedText,
    diffRemovedGutter: fallback.diffRemovedGutter,

    scrollbarThumb: get(["scrollbarSlider.background"], fallback.scrollbarThumb),
    modalBackdrop: fallback.modalBackdrop,
    selectionBg: get(["editor.selectionBackground"], fallback.selectionBg),
  };
}

// --- Color utilities ---

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

function darken(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function lighten(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

function hexWithAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function saturation(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

function pickAccent(c: Record<string, string>, fallback: string): string {
  const candidates = [
    c["terminal.ansiGreen"],
    c["terminal.ansiCyan"],
    c["terminal.ansiBlue"],
    c["editorLink.activeForeground"],
    c["focusBorder"],
    c["button.background"],
    c["list.highlightForeground"],
  ].filter(Boolean) as string[];

  if (candidates.length === 0) return fallback;

  // Pick the candidate with the highest saturation (most colorful)
  let best = candidates[0];
  let bestSat = saturation(best);
  for (let i = 1; i < candidates.length; i++) {
    const sat = saturation(candidates[i]);
    if (sat > bestSat) {
      best = candidates[i];
      bestSat = sat;
    }
  }

  // If the best candidate is still very desaturated, use fallback
  return bestSat > 0.2 ? best : fallback;
}

function mixColors(hex1: string, hex2: string, ratio: number): string {
  const [r1, g1, b1] = parseHex(hex1);
  const [r2, g2, b2] = parseHex(hex2);
  return toHex(
    r1 * ratio + r2 * (1 - ratio),
    g1 * ratio + g2 * (1 - ratio),
    b1 * ratio + b2 * (1 - ratio),
  );
}

const LIGHT_FALLBACKS: ThemeColors = {
  bg: "#FFFFFF",
  bgSubtle: "#F7F7F7",
  bgInput: "#FFFFFF",
  bgElevated: "#F3F3F3",
  bgMenu: "#F0F0F0",
  bgSurface: "#F5F5F5",
  bgHover: "#E8E8E8",
  bgInset: "#E0E0E0",

  border: "#D4D4D4",
  borderLight: "#E0E0E0",

  fg: "#333333",
  fgSecondary: "#666666",
  fgMuted: "#999999",
  fgTertiary: "#888888",
  fgDimmed: "#555555",

  accent: "#10B981",
  accentHover: "#059669",
  accentBgFaint: "rgba(16,185,129,0.1)",

  error: "#DC2626",
  errorLight: "#EF4444",
  errorBg: "rgba(220,38,38,0.1)",
  warning: "#D97706",
  warningLight: "#F59E0B",
  warningBg: "rgba(217,119,6,0.1)",
  warningBorder: "#92400E",
  cyan: "#0891B2",
  blue: "#2563EB",
  blueBright: "#3B82F6",
  blueLight: "#60A5FA",
  purple: "#7C3AED",
  purpleLight: "#8B5CF6",
  magenta: "#A855F7",

  termBg: "#FFFFFF",
  termFg: "#333333",
  termCursor: "#333333",
  termBlack: "#000000",
  termRed: "#CD3131",
  termGreen: "#00BC00",
  termYellow: "#949800",
  termBlue: "#0451A5",
  termMagenta: "#BC05BC",
  termCyan: "#0598BC",
  termWhite: "#555555",
  termBrightBlack: "#666666",
  termBrightRed: "#CD3131",
  termBrightGreen: "#14CE14",
  termBrightYellow: "#B5BA00",
  termBrightBlue: "#0451A5",
  termBrightMagenta: "#BC05BC",
  termBrightCyan: "#0598BC",
  termBrightWhite: "#A5A5A5",

  diffChangedBg: "#DDF4FF",
  diffRemovedBg: "#FFE0E0",
  diffCharHighlight: "#ACE5FF",
  diffRemovedText: "#B31D1D",
  diffRemovedGutter: "#CF2222",

  scrollbarThumb: "rgba(0,0,0,0.2)",
  modalBackdrop: "rgba(0,0,0,0.5)",
  selectionBg: "rgba(16,185,129,0.3)",
};
