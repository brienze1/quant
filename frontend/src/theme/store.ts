import type { ResolvedTheme, VSCodeTheme } from "./types";
import { mapVSCodeTheme } from "./mapper";
import { BUILTIN_THEMES } from "./defaults";
import { PRESET_THEMES } from "./presets";

const STORAGE_KEY = "quant:theme-id";
const CUSTOM_THEMES_KEY = "quant:custom-themes";
const ACCENT_KEY = "quant:accent";
const DENSITY_KEY = "quant:density";

export function getStoredThemeId(): string {
  return localStorage.getItem(STORAGE_KEY) || "quant-dark";
}

export function setStoredThemeId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
}

export type Accent = "emerald" | "iris" | "blue";
export type Density = "cozy" | "compact";

export function getStoredAccent(): Accent {
  const v = localStorage.getItem(ACCENT_KEY);
  return v === "iris" || v === "blue" || v === "emerald" ? v : "emerald";
}

export function setStoredAccent(accent: Accent): void {
  localStorage.setItem(ACCENT_KEY, accent);
}

export function getStoredDensity(): Density {
  const v = localStorage.getItem(DENSITY_KEY);
  return v === "compact" || v === "cozy" ? v : "cozy";
}

export function setStoredDensity(density: Density): void {
  localStorage.setItem(DENSITY_KEY, density);
}

export function getCustomThemes(): ResolvedTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ResolvedTheme[];
  } catch {
    return [];
  }
}

export function saveCustomThemes(themes: ResolvedTheme[]): void {
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
}

export function getAllThemes(): ResolvedTheme[] {
  return [...BUILTIN_THEMES, ...PRESET_THEMES, ...getCustomThemes()];
}

export function importVSCodeTheme(json: VSCodeTheme): ResolvedTheme {
  const colors = mapVSCodeTheme(json);
  const id = `custom-${json.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const existing = getCustomThemes();
  const theme: ResolvedTheme = {
    id,
    name: json.name,
    type: json.type || "dark",
    colors,
    isBuiltin: false,
  };

  const filtered = existing.filter((t) => t.id !== id);
  filtered.push(theme);
  saveCustomThemes(filtered);

  return theme;
}

export function deleteCustomTheme(id: string): void {
  const themes = getCustomThemes().filter((t) => t.id !== id);
  saveCustomThemes(themes);
}

export function resolveTheme(id: string): ResolvedTheme {
  const all = getAllThemes();
  return all.find((t) => t.id === id) || BUILTIN_THEMES[0];
}
