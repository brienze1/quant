import type { ResolvedTheme } from "./types";

// Quant Dark — the legacy --q-* palette is aligned to the new design-system
// tokens (--bg/--panel/--fg/--border/--accent in style.css) so migrated chrome
// and legacy surfaces (terminal/editor/diff) read as ONE coherent dark theme.
export const QUANT_DARK: ResolvedTheme = {
  id: "quant-dark",
  name: "Quant Dark",
  type: "dark",
  isBuiltin: true,
  colors: {
    bg: "#0b0c0e",        // --bg
    bgSubtle: "#0e1012",
    bgInput: "#1a1d20",   // --panel-2
    bgElevated: "#131517", // --panel
    bgMenu: "#16181b",
    bgSurface: "#1a1d20", // --panel-2
    bgHover: "#212529",   // --panel-3
    bgInset: "#212529",

    border: "#25282c",      // ~ --border  (rgba(255,255,255,.09) on --bg)
    borderLight: "#2f3338", // stronger divider

    fg: "#ecedef",          // --fg
    fgSecondary: "#6a7079", // --fg-3
    fgMuted: "#474d55",     // --fg-4 (faintest)
    fgTertiary: "#9aa0a7",  // --fg-2 (most prominent secondary)
    fgDimmed: "#c2c6cb",

    accent: "#2ed3a0",      // --accent (emerald)
    accentHover: "#25b88a", // --accent-2
    accentBgFaint: "rgba(46,211,160,0.12)",

    error: "#f5736a",       // --danger
    errorLight: "#f88c84",
    errorBg: "rgba(245,115,106,0.15)",
    warning: "#f0b13f",     // --warn
    warningLight: "#f6c468",
    warningBg: "#1a1407",
    warningBorder: "#7a5a16",
    cyan: "#22c3d6",
    blue: "#4f8dfb",        // --info
    blueBright: "#3a7df0",
    blueLight: "#7fb0ff",
    purple: "#a98bff",      // --purple
    purpleLight: "#bda5ff",
    magenta: "#cf6fd6",

    termBg: "#0b0c0e",
    termFg: "#ecedef",
    termCursor: "#2ed3a0",
    termBlack: "#0b0c0e",
    termRed: "#f5736a",
    termGreen: "#2ed3a0",
    termYellow: "#f0b13f",
    termBlue: "#4f8dfb",
    termMagenta: "#a98bff",
    termCyan: "#22c3d6",
    termWhite: "#ecedef",
    termBrightBlack: "#474d55",
    termBrightRed: "#f88c84",
    termBrightGreen: "#34d399",
    termBrightYellow: "#f6c468",
    termBrightBlue: "#7fb0ff",
    termBrightMagenta: "#bda5ff",
    termBrightCyan: "#5ad7e6",
    termBrightWhite: "#ffffff",

    diffChangedBg: "#1B2A40",
    diffRemovedBg: "#2D0E0E",
    diffCharHighlight: "#2A4A70",
    diffRemovedText: "#FCA5A5",
    diffRemovedGutter: "#7F1D1D",

    scrollbarThumb: "rgba(255,255,255,0.3)",
    modalBackdrop: "rgba(0,0,0,0.7)",
    selectionBg: "rgba(46,185,138,0.3)",
  },
};

// Quant Light — mirrors the new Apple-light design tokens so toggling to light
// re-skins the WHOLE IDE consistently (no more Solarized clash on legacy panes).
export const QUANT_LIGHT: ResolvedTheme = {
  id: "quant-light",
  name: "Quant Light",
  type: "light",
  isBuiltin: true,
  colors: {
    bg: "#eef0f3",         // --bg
    bgSubtle: "#e7e9ed",
    bgInput: "#ffffff",    // --panel
    bgElevated: "#ffffff", // --panel
    bgMenu: "#ffffff",
    bgSurface: "#f5f6f8",  // --panel-2
    bgHover: "#eceef1",    // --panel-3
    bgInset: "#e6e8ec",

    border: "#dce0e5",      // ~ --border  (rgba(0,0,0,.10) on light)
    borderLight: "#e7eaee", // ~ --border-2

    fg: "#1b1d20",          // --fg
    fgSecondary: "#5b616a", // --fg-2
    fgMuted: "#b6bcc4",     // --fg-4 (faintest)
    fgTertiary: "#8b929b",  // --fg-3
    fgDimmed: "#3a3f45",    // most prominent secondary

    accent: "#1fb98a",      // emerald, darkened for contrast on white
    accentHover: "#179a72",
    accentBgFaint: "rgba(46,211,160,0.14)",

    error: "#e5484d",
    errorLight: "#ef5350",
    errorBg: "rgba(229,72,77,0.1)",
    warning: "#b7791f",
    warningLight: "#d99a2b",
    warningBg: "rgba(183,121,31,0.1)",
    warningBorder: "#d9a441",
    cyan: "#0e9c95",
    blue: "#2f6fed",
    blueBright: "#2563eb",
    blueLight: "#5a9bf5",
    purple: "#6a5bf0",
    purpleLight: "#8273f2",
    magenta: "#c2389a",

    termBg: "#ffffff",
    termFg: "#1b1d20",
    termCursor: "#1fb98a",
    termBlack: "#1b1d20",
    termRed: "#d1453b",
    termGreen: "#1a9e6a",
    termYellow: "#b7791f",
    termBlue: "#2f6fed",
    termMagenta: "#c2389a",
    termCyan: "#0e9c95",
    termWhite: "#6b727b",
    termBrightBlack: "#8b929b",
    termBrightRed: "#e5484d",
    termBrightGreen: "#1fb98a",
    termBrightYellow: "#d99a2b",
    termBrightBlue: "#5a9bf5",
    termBrightMagenta: "#8273f2",
    termBrightCyan: "#14b3aa",
    termBrightWhite: "#1b1d20",

    diffChangedBg: "#dbeafe",
    diffRemovedBg: "#fde2e2",
    diffCharHighlight: "#bcd9fb",
    diffRemovedText: "#b42318",
    diffRemovedGutter: "#f0a8a8",

    scrollbarThumb: "rgba(0,0,0,0.22)",
    modalBackdrop: "rgba(20,22,26,0.28)",
    selectionBg: "rgba(31,185,138,0.22)",
  },
};

export const BUILTIN_THEMES: ResolvedTheme[] = [QUANT_DARK, QUANT_LIGHT];
