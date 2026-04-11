// Keybinding system: types, defaults, storage, matching

export interface KeyBinding {
  id: string;
  label: string;
  category: "tabs" | "workspace" | "theme" | "palette" | "session";
  /** Key combo string, e.g. "Meta+]", "Meta+Shift+1" */
  keys: string;
}

/** All available action IDs */
export type KeyActionId =
  | "nextTab"
  | "prevTab"
  | "tab1" | "tab2" | "tab3" | "tab4" | "tab5" | "tab6" | "tab7" | "tab8" | "tab9"
  | "closeTab"
  | "stopSession"
  | "workspace1" | "workspace2" | "workspace3" | "workspace4" | "workspace5"
  | "workspace6" | "workspace7" | "workspace8" | "workspace9"
  | "themePicker"
  | "commandPalette";

export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // Session tabs
  { id: "nextTab", label: "Next tab", category: "tabs", keys: "Meta+]" },
  { id: "prevTab", label: "Previous tab", category: "tabs", keys: "Meta+[" },
  { id: "tab1", label: "Jump to tab 1", category: "tabs", keys: "Meta+1" },
  { id: "tab2", label: "Jump to tab 2", category: "tabs", keys: "Meta+2" },
  { id: "tab3", label: "Jump to tab 3", category: "tabs", keys: "Meta+3" },
  { id: "tab4", label: "Jump to tab 4", category: "tabs", keys: "Meta+4" },
  { id: "tab5", label: "Jump to tab 5", category: "tabs", keys: "Meta+5" },
  { id: "tab6", label: "Jump to tab 6", category: "tabs", keys: "Meta+6" },
  { id: "tab7", label: "Jump to tab 7", category: "tabs", keys: "Meta+7" },
  { id: "tab8", label: "Jump to tab 8", category: "tabs", keys: "Meta+8" },
  { id: "tab9", label: "Jump to tab 9", category: "tabs", keys: "Meta+9" },
  { id: "closeTab", label: "Close current tab", category: "tabs", keys: "Meta+w" },
  { id: "stopSession", label: "Stop active session", category: "session", keys: "Meta+Shift+w" },

  // Workspace (Ctrl+N avoids macOS Cmd+Shift+3/4/5 screenshot conflicts)
  { id: "workspace1", label: "Jump to workspace 1", category: "workspace", keys: "Ctrl+1" },
  { id: "workspace2", label: "Jump to workspace 2", category: "workspace", keys: "Ctrl+2" },
  { id: "workspace3", label: "Jump to workspace 3", category: "workspace", keys: "Ctrl+3" },
  { id: "workspace4", label: "Jump to workspace 4", category: "workspace", keys: "Ctrl+4" },
  { id: "workspace5", label: "Jump to workspace 5", category: "workspace", keys: "Ctrl+5" },
  { id: "workspace6", label: "Jump to workspace 6", category: "workspace", keys: "Ctrl+6" },
  { id: "workspace7", label: "Jump to workspace 7", category: "workspace", keys: "Ctrl+7" },
  { id: "workspace8", label: "Jump to workspace 8", category: "workspace", keys: "Ctrl+8" },
  { id: "workspace9", label: "Jump to workspace 9", category: "workspace", keys: "Ctrl+9" },

  // Theme
  { id: "themePicker", label: "Open theme picker", category: "theme", keys: "Meta+Shift+t" },

  // Command palette
  { id: "commandPalette", label: "Open command palette", category: "palette", keys: "Meta+k" },
];

const STORAGE_KEY = "quant:keybindings";

export function getStoredKeybindings(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setStoredKeybindings(overrides: Record<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

/** Merge defaults with user overrides */
export function getActiveKeybindings(): KeyBinding[] {
  const overrides = getStoredKeybindings();
  return DEFAULT_KEYBINDINGS.map((kb) => ({
    ...kb,
    keys: overrides[kb.id] ?? kb.keys,
  }));
}

/** Convert a KeyboardEvent to our key string format */
export function eventToKeyString(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey) parts.push("Meta");
  if (e.ctrlKey && !e.metaKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  let key = e.key;
  // Normalize number keys
  if (key >= "0" && key <= "9") {
    // good
  } else if (key === "[" || key === "]") {
    // good
  } else {
    key = key.toLowerCase();
  }

  // Don't add modifier keys as the main key
  if (!["Meta", "Control", "Shift", "Alt"].includes(e.key)) {
    parts.push(key);
  }

  return parts.join("+");
}

/** Format a key string for display (e.g. "Meta+Shift+1" -> "Cmd+Shift+1" on Mac) */
export function formatKeyCombo(keys: string): string {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  return keys
    .replace(/Meta/g, isMac ? "\u2318" : "Ctrl")
    .replace(/Shift/g, isMac ? "\u21E7" : "Shift")
    .replace(/Alt/g, isMac ? "\u2325" : "Alt")
    .replace(/\+/g, " ");
}

/** Check if a KeyboardEvent matches a key string */
export function matchesKeyBinding(e: KeyboardEvent, keys: string): boolean {
  return eventToKeyString(e) === keys;
}

/** Find which action (if any) matches the keyboard event */
export function findMatchingAction(e: KeyboardEvent, bindings: KeyBinding[]): KeyBinding | null {
  const pressed = eventToKeyString(e);
  return bindings.find((kb) => kb.keys === pressed) ?? null;
}

/** Detect conflicts: returns map of key string -> action IDs */
export function findConflicts(bindings: KeyBinding[]): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const kb of bindings) {
    const existing = byKey.get(kb.keys) || [];
    existing.push(kb.id);
    byKey.set(kb.keys, existing);
  }
  // Only return entries with conflicts
  const conflicts = new Map<string, string[]>();
  for (const [key, ids] of byKey) {
    if (ids.length > 1) conflicts.set(key, ids);
  }
  return conflicts;
}
