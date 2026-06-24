import React, { createContext, useContext, useCallback, useEffect, useState } from "react";
import type { ResolvedTheme, VSCodeTheme, ThemeColors } from "./types";
import {
  resolveTheme,
  getStoredThemeId,
  setStoredThemeId,
  importVSCodeTheme,
  deleteCustomTheme,
  getAllThemes,
  getStoredAccent,
  setStoredAccent,
  getStoredDensity,
  setStoredDensity,
} from "./store";
import type { Accent, Density } from "./store";

interface ThemeContextValue {
  theme: ResolvedTheme;
  themes: ResolvedTheme[];
  setTheme: (id: string) => void;
  importTheme: (json: VSCodeTheme) => ResolvedTheme;
  removeTheme: (id: string) => void;
  accent: Accent;
  setAccent: (accent: Accent) => void;
  density: Density;
  setDensity: (density: Density) => void;
  /** Flip dark/light by switching to a builtin theme of the opposite type. */
  toggleThemeType: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const CSS_VAR_MAP: Record<keyof ThemeColors, string> = {
  bg: "--q-bg",
  bgSubtle: "--q-bg-subtle",
  bgInput: "--q-bg-input",
  bgElevated: "--q-bg-elevated",
  bgMenu: "--q-bg-menu",
  bgSurface: "--q-bg-surface",
  bgHover: "--q-bg-hover",
  bgInset: "--q-bg-inset",
  border: "--q-border",
  borderLight: "--q-border-light",
  fg: "--q-fg",
  fgSecondary: "--q-fg-secondary",
  fgMuted: "--q-fg-muted",
  fgTertiary: "--q-fg-tertiary",
  fgDimmed: "--q-fg-dimmed",
  accent: "--q-accent",
  accentHover: "--q-accent-hover",
  accentBgFaint: "--q-accent-bg-faint",
  error: "--q-error",
  errorLight: "--q-error-light",
  errorBg: "--q-error-bg",
  warning: "--q-warning",
  warningLight: "--q-warning-light",
  warningBg: "--q-warning-bg",
  warningBorder: "--q-warning-border",
  cyan: "--q-cyan",
  blue: "--q-blue",
  blueBright: "--q-blue-bright",
  blueLight: "--q-blue-light",
  purple: "--q-purple",
  purpleLight: "--q-purple-light",
  magenta: "--q-magenta",
  termBg: "--q-term-bg",
  termFg: "--q-term-fg",
  termCursor: "--q-term-cursor",
  termBlack: "--q-term-black",
  termRed: "--q-term-red",
  termGreen: "--q-term-green",
  termYellow: "--q-term-yellow",
  termBlue: "--q-term-blue",
  termMagenta: "--q-term-magenta",
  termCyan: "--q-term-cyan",
  termWhite: "--q-term-white",
  termBrightBlack: "--q-term-bright-black",
  termBrightRed: "--q-term-bright-red",
  termBrightGreen: "--q-term-bright-green",
  termBrightYellow: "--q-term-bright-yellow",
  termBrightBlue: "--q-term-bright-blue",
  termBrightMagenta: "--q-term-bright-magenta",
  termBrightCyan: "--q-term-bright-cyan",
  termBrightWhite: "--q-term-bright-white",
  diffChangedBg: "--q-diff-changed-bg",
  diffRemovedBg: "--q-diff-removed-bg",
  diffCharHighlight: "--q-diff-char-highlight",
  diffRemovedText: "--q-diff-removed-text",
  diffRemovedGutter: "--q-diff-removed-gutter",
  scrollbarThumb: "--q-scrollbar-thumb",
  modalBackdrop: "--q-modal-backdrop",
  selectionBg: "--q-selection-bg",
};

// Accent hexes mirror the new design-system --accent values in style.css.
const ACCENT_HEX: Record<Accent, { base: string; hover: string }> = {
  emerald: { base: "#2ed3a0", hover: "#25b88a" },
  iris: { base: "#7b7bff", hover: "#6a68f2" },
  blue: { base: "#3a8bff", hover: "#2f78ec" },
};

// Bridge: new design-system tokens ← resolved ThemeColors. Lets an IMPORTED
// theme recolor the whole chrome (sidebar/buttons/empty-state/...), not just
// the legacy --q-* editor/terminal layer. The two builtins are tuned to match
// the static design CSS, so for them we leave these unset and let the static
// :root[data-theme] + data-accent rules win.
const BRIDGE_MAP: [string, keyof ThemeColors][] = [
  ["--bg", "bg"],
  ["--panel", "bgElevated"],
  ["--panel-2", "bgInput"],
  ["--panel-3", "bgHover"],
  ["--hover", "bgHover"],
  ["--active", "bgInset"],
  ["--border", "border"],
  ["--border-2", "borderLight"],
  ["--line", "borderLight"],
  ["--fg", "fg"],
  ["--fg-2", "fgTertiary"],
  ["--fg-3", "fgSecondary"],
  ["--fg-4", "fgMuted"],
];
// Accent-family vars driven inline for imported themes (removed for builtins).
const BRIDGE_ACCENT_VARS = ["--accent", "--accent-2", "--on-accent", "--accent-soft", "--accent-line"];

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Relative luminance (0=black, 1=white) for picking readable text on the accent.
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length < 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Apply theme + accent together so precedence is deterministic on every change.
function applyThemeToDOM(theme: ResolvedTheme, accent: Accent) {
  const root = document.documentElement;
  const colors = theme.colors;

  // Legacy --q-* layer (terminal / codemirror / diff) — always theme-driven.
  for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
    root.style.setProperty(cssVar, colors[key as keyof ThemeColors]);
  }
  root.setAttribute("data-theme-type", theme.type);
  root.setAttribute("data-theme", theme.type);
  root.setAttribute("data-accent", accent);

  if (theme.isBuiltin) {
    // Static design CSS owns the new tokens; the accent picker owns the accent.
    // Clear any inline bridge values left over from a previously-active import.
    for (const [v] of BRIDGE_MAP) root.style.removeProperty(v);
    for (const v of BRIDGE_ACCENT_VARS) root.style.removeProperty(v);
    // Keep the legacy --q-* accent (editor cursor/selection) in sync with the
    // picked accent so both token layers agree across the whole IDE.
    const { base, hover } = ACCENT_HEX[accent];
    root.style.setProperty("--q-accent", base);
    root.style.setProperty("--q-accent-hover", hover);
    root.style.setProperty("--q-accent-bg-faint", hexToRgba(base, 0.12));
    root.style.setProperty("--q-term-cursor", base);
    root.style.setProperty("--q-selection-bg", hexToRgba(base, 0.3));
  } else {
    // Imported VS Code theme: drive the WHOLE chrome from its palette.
    for (const [v, key] of BRIDGE_MAP) root.style.setProperty(v, colors[key]);
    const acc = colors.accent;
    root.style.setProperty("--accent", acc);
    root.style.setProperty("--accent-2", colors.accentHover);
    root.style.setProperty("--on-accent", luminance(acc) < 0.5 ? "#ffffff" : "#04231a");
    root.style.setProperty("--accent-soft", hexToRgba(acc, 0.16));
    root.style.setProperty("--accent-line", hexToRgba(acc, 0.45));
    // Legacy accent stays the theme's own (already set in the --q-* loop above).
  }
}

function applyDensityToDOM(density: Density) {
  document.documentElement.setAttribute("data-density", density);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState(getStoredThemeId);
  const [themes, setThemes] = useState(getAllThemes);
  const [version, setVersion] = useState(0);
  const [accent, setAccentState] = useState<Accent>(getStoredAccent);
  const [density, setDensityState] = useState<Density>(getStoredDensity);
  const theme = resolveTheme(themeId);

  useEffect(() => {
    // Always read fresh from storage in case the same theme ID was re-imported
    // with new colors. Theme + accent are applied together for deterministic
    // precedence (imported theme drives the accent; builtins use the picker).
    applyThemeToDOM(resolveTheme(themeId), accent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId, version, accent]);

  useEffect(() => {
    applyDensityToDOM(density);
  }, [density]);

  const setThemeCb = useCallback((id: string) => {
    setStoredThemeId(id);
    setThemeId(id);
  }, []);

  const importThemeCb = useCallback((json: VSCodeTheme) => {
    const imported = importVSCodeTheme(json);
    setThemes(getAllThemes());
    setStoredThemeId(imported.id);
    setThemeId(imported.id);
    setVersion((v) => v + 1);
    return imported;
  }, []);

  const removeThemeCb = useCallback((id: string) => {
    deleteCustomTheme(id);
    setThemes(getAllThemes());
    if (themeId === id) {
      setStoredThemeId("quant-dark");
      setThemeId("quant-dark");
    }
  }, [themeId]);

  const setAccentCb = useCallback((a: Accent) => {
    setStoredAccent(a);
    setAccentState(a);
  }, []);

  const setDensityCb = useCallback((d: Density) => {
    setStoredDensity(d);
    setDensityState(d);
  }, []);

  const toggleThemeType = useCallback(() => {
    const current = resolveTheme(themeId);
    const target = current.type === "dark" ? "light" : "dark";
    const next = getAllThemes().find((t) => t.type === target);
    if (next) {
      setStoredThemeId(next.id);
      setThemeId(next.id);
    }
  }, [themeId]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        themes,
        setTheme: setThemeCb,
        importTheme: importThemeCb,
        removeTheme: removeThemeCb,
        accent,
        setAccent: setAccentCb,
        density,
        setDensity: setDensityCb,
        toggleThemeType,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

export { CSS_VAR_MAP };
