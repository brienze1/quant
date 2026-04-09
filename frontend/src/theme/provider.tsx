import React, { createContext, useContext, useCallback, useEffect, useState } from "react";
import type { ResolvedTheme, VSCodeTheme, ThemeColors } from "./types";
import { resolveTheme, getStoredThemeId, setStoredThemeId, importVSCodeTheme, deleteCustomTheme, getAllThemes } from "./store";

interface ThemeContextValue {
  theme: ResolvedTheme;
  themes: ResolvedTheme[];
  setTheme: (id: string) => void;
  importTheme: (json: VSCodeTheme) => ResolvedTheme;
  removeTheme: (id: string) => void;
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

function applyThemeToDOM(theme: ResolvedTheme) {
  const root = document.documentElement;
  const colors = theme.colors;

  for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
    root.style.setProperty(cssVar, colors[key as keyof ThemeColors]);
  }

  root.setAttribute("data-theme-type", theme.type);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState(getStoredThemeId);
  const [themes, setThemes] = useState(getAllThemes);
  const [version, setVersion] = useState(0);
  const theme = resolveTheme(themeId);

  useEffect(() => {
    // Always read fresh from storage in case the same theme ID was re-imported with new colors
    applyThemeToDOM(resolveTheme(themeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId, version]);

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

  return (
    <ThemeContext.Provider value={{ theme, themes, setTheme: setThemeCb, importTheme: importThemeCb, removeTheme: removeThemeCb }}>
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
