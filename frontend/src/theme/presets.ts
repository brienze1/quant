import type { ResolvedTheme, VSCodeTheme } from "./types";
import { mapVSCodeTheme } from "./mapper";

// Bundled VS Code theme JSONs, pre-installed for every user (read-only, no
// delete button — see ThemeSettings.tsx). Loaded eagerly so they're available
// synchronously at first render (same as BUILTIN_THEMES).
const raw = import.meta.glob("./presets/*.json", { eager: true }) as Record<
  string,
  { default: { name?: string; type?: string; colors?: Record<string, string> } }
>;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function prettifyFilename(path: string): string {
  const base = path.split("/").pop()?.replace(/\.json$/, "") ?? path;
  return base
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildPresetTheme(path: string, json: { name?: string; type?: string; colors?: Record<string, string> }): ResolvedTheme {
  const name = json.name || prettifyFilename(path);
  const type = json.type === "light" || json.type === "hc" ? json.type : "dark";
  const vsTheme: VSCodeTheme = {
    name,
    type,
    colors: json.colors || {},
  };
  const colors = mapVSCodeTheme(vsTheme);

  return {
    // `preset-` namespace keeps these distinct from user imports (`custom-*`)
    // even if a user previously imported a theme with the same name.
    id: `preset-${slugify(name)}`,
    name,
    type,
    colors,
    isBuiltin: false,
    isPreset: true,
  };
}

const unsorted = Object.entries(raw).map(([path, mod]) => buildPresetTheme(path, mod.default));

// Dark themes first, then light; alphabetical within each group.
export const PRESET_THEMES: ResolvedTheme[] = unsorted.sort((a, b) => {
  if (a.type !== b.type) {
    if (a.type === "dark") return -1;
    if (b.type === "dark") return 1;
  }
  return a.name.localeCompare(b.name);
});
