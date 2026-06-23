import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_KEYBINDINGS,
  getActiveKeybindings,
  getStoredKeybindings,
  setStoredKeybindings,
  eventToKeyString,
  formatKeyCombo,
  findConflicts,
  type KeyBinding,
} from "../keybindings";
import { Button } from "./Button";

export function KeybindingsTab() {
  const [bindings, setBindings] = useState<KeyBinding[]>(getActiveKeybindings);
  const [recording, setRecording] = useState<string | null>(null);
  const conflicts = findConflicts(bindings);

  const save = useCallback((updated: KeyBinding[]) => {
    const overrides: Record<string, string> = {};
    for (const kb of updated) {
      const def = DEFAULT_KEYBINDINGS.find((d) => d.id === kb.id);
      if (def && def.keys !== kb.keys) {
        overrides[kb.id] = kb.keys;
      }
    }
    setStoredKeybindings(overrides);
    setBindings(updated);
  }, []);

  const resetOne = useCallback((id: string) => {
    const def = DEFAULT_KEYBINDINGS.find((d) => d.id === id);
    if (!def) return;
    const updated = bindings.map((kb) => (kb.id === id ? { ...kb, keys: def.keys } : kb));
    save(updated);
  }, [bindings, save]);

  const resetAll = useCallback(() => {
    setStoredKeybindings({});
    setBindings(getActiveKeybindings());
  }, []);

  const handleRecord = useCallback(
    (e: KeyboardEvent) => {
      if (!recording) return;

      // Ignore bare modifier presses
      if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return;

      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecording(null);
        return;
      }

      const newKeys = eventToKeyString(e);
      const updated = bindings.map((kb) =>
        kb.id === recording ? { ...kb, keys: newKeys } : kb,
      );
      save(updated);
      setRecording(null);
    },
    [recording, bindings, save],
  );

  useEffect(() => {
    if (!recording) return;
    window.addEventListener("keydown", handleRecord, true);
    return () => window.removeEventListener("keydown", handleRecord, true);
  }, [recording, handleRecord]);

  // Group by category
  const categories = [
    { key: "tabs", label: "Session Tabs" },
    { key: "session", label: "Session" },
    { key: "workspace", label: "Workspace" },
    { key: "theme", label: "Theme" },
    { key: "palette", label: "Command Palette" },
    { key: "voice", label: "Voice" },
  ] as const;

  const hasOverrides = Object.keys(getStoredKeybindings()).length > 0;

  return (
    <div>
      {/* Header with reset all */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
        <span style={{ color: "var(--fg-3)", fontSize: 12.5 }}>
          click a shortcut to record a new key combination. press esc to cancel.
        </span>
        {hasOverrides && (
          <Button variant="ghost" size="sm" onClick={resetAll}>
            reset all to defaults
          </Button>
        )}
      </div>

      {categories.map(({ key: cat, label }) => {
        const items = bindings.filter((kb) => kb.category === cat);
        if (items.length === 0) return null;

        return (
          <div key={cat} style={{ marginBottom: 26 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {items.map((kb) => {
                const isRecording = recording === kb.id;
                const defaultKb = DEFAULT_KEYBINDINGS.find((d) => d.id === kb.id);
                const isOverridden = defaultKb && defaultKb.keys !== kb.keys;
                const hasConflict = Array.from(conflicts.values()).some(
                  (ids) => ids.includes(kb.id) && ids.length > 1,
                );

                return (
                  <div
                    key={kb.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 12px",
                      borderRadius: 8,
                      background: isRecording ? "var(--hover)" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isRecording) e.currentTarget.style.background = "var(--hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isRecording) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span style={{ color: "var(--fg-2)", fontSize: 12.5, flex: 1 }}>{kb.label}</span>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {hasConflict && (
                        <span style={{ color: "var(--warn)", fontSize: 10 }}>conflict</span>
                      )}

                      {/* shortcut display / recording button */}
                      <button
                        onClick={() => setRecording(isRecording ? null : kb.id)}
                        className="mono"
                        style={{
                          minWidth: 110,
                          textAlign: "center",
                          padding: "4px 12px",
                          borderRadius: 7,
                          cursor: "pointer",
                          fontSize: 12,
                          background: isRecording ? "var(--accent-soft)" : "var(--panel-3)",
                          border: `1px solid ${isRecording ? "var(--accent)" : hasConflict ? "var(--warn)" : "var(--border-2)"}`,
                          color: isRecording ? "var(--accent)" : "var(--fg)",
                        }}
                      >
                        {isRecording ? "press keys…" : formatKeyCombo(kb.keys)}
                      </button>

                      {/* reset single */}
                      {isOverridden && (
                        <button
                          onClick={() => resetOne(kb.id)}
                          title={`reset to ${formatKeyCombo(defaultKb.keys)}`}
                          style={{
                            fontSize: 10,
                            color: "var(--fg-4)",
                            fontFamily: "var(--mono)",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: "2px 6px",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg)")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--fg-4)")}
                        >
                          reset
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
