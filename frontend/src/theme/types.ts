/**
 * VS Code compatible theme format.
 * Users can import any VS Code .json theme file directly.
 */
export interface VSCodeTheme {
  name: string;
  type: "dark" | "light" | "hc";
  colors: Record<string, string>;
  tokenColors?: unknown[];
}

/**
 * Internal resolved theme with all required CSS variable values.
 * Missing VS Code keys are filled from defaults based on theme type.
 */
export interface ResolvedTheme {
  id: string;
  name: string;
  type: "dark" | "light" | "hc";
  colors: Required<ThemeColors>;
  isBuiltin: boolean;
}

export interface ThemeColors {
  // Backgrounds
  bg: string;
  bgSubtle: string;
  bgInput: string;
  bgElevated: string;
  bgMenu: string;
  bgSurface: string;
  bgHover: string;
  bgInset: string;

  // Borders
  border: string;
  borderLight: string;

  // Foreground
  fg: string;
  fgSecondary: string;
  fgMuted: string;
  fgTertiary: string;
  fgDimmed: string;

  // Accent
  accent: string;
  accentHover: string;
  accentBgFaint: string;

  // Status
  error: string;
  errorLight: string;
  errorBg: string;
  warning: string;
  warningLight: string;
  warningBg: string;
  warningBorder: string;
  cyan: string;
  blue: string;
  blueBright: string;
  blueLight: string;
  purple: string;
  purpleLight: string;
  magenta: string;

  // Terminal
  termBg: string;
  termFg: string;
  termCursor: string;
  termBlack: string;
  termRed: string;
  termGreen: string;
  termYellow: string;
  termBlue: string;
  termMagenta: string;
  termCyan: string;
  termWhite: string;
  termBrightBlack: string;
  termBrightRed: string;
  termBrightGreen: string;
  termBrightYellow: string;
  termBrightBlue: string;
  termBrightMagenta: string;
  termBrightCyan: string;
  termBrightWhite: string;

  // Diff
  diffChangedBg: string;
  diffRemovedBg: string;
  diffCharHighlight: string;
  diffRemovedText: string;
  diffRemovedGutter: string;

  // Misc
  scrollbarThumb: string;
  modalBackdrop: string;
  selectionBg: string;
}
