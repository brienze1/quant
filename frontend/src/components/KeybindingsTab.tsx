import { useCallback, useEffect, useRef, useState } from "react";
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

const font = "'JetBrains Mono', monospace";

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
    <div style={{ fontFamily: font }}>
      {/* Header with reset all */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <p style={{ color: "var(--q-fg-secondary)", fontSize: 12, margin: 0 }}>
          click on a shortcut to record a new key combination. press Escape to cancel.
        </p>
        {hasOverrides && (
          <button
            onClick={resetAll}
            style={{
              padding: "4px 12px",
              backgroundColor: "transparent",
              border: "1px solid var(--q-border)",
              borderRadius: 4,
              color: "var(--q-fg-secondary)",
              fontSize: 11,
              fontFamily: font,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--q-error)";
              e.currentTarget.style.color = "var(--q-error)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--q-border)";
              e.currentTarget.style.color = "var(--q-fg-secondary)";
            }}
          >
            reset all to defaults
          </button>
        )}
      </div>

      {categories.map(({ key: cat, label }) => {
        const items = bindings.filter((kb) => kb.category === cat);
        if (items.length === 0) return null;

        return (
          <div key={cat} style={{ marginBottom: 28 }}>
            <h3 style={{ color: "var(--q-fg)", fontSize: 13, fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
              {label}
            </h3>
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
                      borderRadius: 4,
                      backgroundColor: isRecording ? "var(--q-bg-hover)" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isRecording) e.currentTarget.style.backgroundColor = "var(--q-bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isRecording) e.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    <span style={{ color: "var(--q-fg-secondary)", fontSize: 12, flex: 1 }}>
                      {kb.label}
                    </span>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {hasConflict && (
                        <span style={{ color: "var(--q-warning)", fontSize: 10 }}>
                          conflict
                        </span>
                      )}

                      {/* shortcut display / recording button */}
                      <button
                        onClick={() => setRecording(isRecording ? null : kb.id)}
                        style={{
                          padding: "3px 10px",
                          backgroundColor: isRecording ? "var(--q-accent-bg-faint)" : "var(--q-bg-input)",
                          border: `1px solid ${isRecording ? "var(--q-accent)" : hasConflict ? "var(--q-warning)" : "var(--q-border-light)"}`,
                          borderRadius: 4,
                          color: isRecording ? "var(--q-accent)" : "var(--q-fg)",
                          fontSize: 12,
                          fontFamily: font,
                          cursor: "pointer",
                          minWidth: 100,
                          textAlign: "center",
                        }}
                      >
                        {isRecording ? "press keys..." : formatKeyCombo(kb.keys)}
                      </button>

                      {/* reset single */}
                      {isOverridden && (
                        <button
                          onClick={() => resetOne(kb.id)}
                          title={`reset to ${formatKeyCombo(defaultKb.keys)}`}
                          style={{
                            padding: "2px 6px",
                            backgroundColor: "transparent",
                            border: "none",
                            color: "var(--q-fg-muted)",
                            fontSize: 10,
                            fontFamily: font,
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-muted)")}
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
