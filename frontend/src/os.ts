// Shared OS detection. Single source of truth so Settings install cards and the
// keybindings display formatter agree on the platform.

export type OS = "macos" | "windows" | "linux";

// getOS guesses the user's platform from the UA so install cards open on the
// right tab. Falls back to macOS (the primary dev target).
export function getOS(): OS {
  const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "").toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux") && !ua.includes("android")) return "linux";
  if (ua.includes("mac")) return "macos";
  return "macos";
}

// isMac reports whether the host is macOS, using navigator.platform (what the
// keybindings formatter has always relied on for the ⌘/Ctrl glyph swap).
export function isMac(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;
}
