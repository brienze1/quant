import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/provider";
import type { ResolvedTheme } from "../theme/types";

interface Props {
  onClose: () => void;
}

const font = "var(--mono)";

export function ThemeQuickPicker({ onClose }: Props) {
  const { theme, themes, setTheme } = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(() =>
    themes.findIndex((t) => t.id === theme.id),
  );
  const originalThemeId = useRef(theme.id);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  const filtered = query
    ? themes.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
    : themes;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Live preview as user arrows through
  useEffect(() => {
    const t = filtered[selectedIndex];
    if (t) setTheme(t.id);
  }, [selectedIndex, filtered, setTheme]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const item = el.children[selectedIndex] as HTMLElement | undefined;
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const cancel = useCallback(() => {
    setTheme(originalThemeId.current);
    onClose();
  }, [setTheme, onClose]);

  const confirm = useCallback(() => {
    // Keep the currently previewed theme
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % Math.max(filtered.length, 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        confirm();
        return;
      }
    },
    [filtered, cancel, confirm],
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        justifyContent: "center",
        paddingTop: 80,
      }}
      onClick={cancel}
    >
      {/* backdrop */}
      <div style={{ position: "absolute", inset: 0, backgroundColor: "var(--scrim)" }} />

      {/* picker */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: 400,
          maxHeight: "50vh",
          backgroundColor: "var(--panel-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r2)",
          boxShadow: "var(--shadow-pop)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: font,
        }}
      >
        {/* search */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="select a theme..."
            style={{
              width: "100%",
              backgroundColor: "transparent",
              border: "none",
              outline: "none",
              color: "var(--fg)",
              fontFamily: font,
              fontSize: 14,
            }}
          />
        </div>

        {/* theme list */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "4px 0",
          }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: "12px 16px", color: "var(--fg-3)", fontSize: 12 }}>
              no matching themes
            </div>
          )}
          {filtered.map((t, i) => {
            const isSelected = i === selectedIndex;
            const isCurrent = t.id === originalThemeId.current;
            return (
              <div
                key={t.id}
                onClick={() => {
                  setSelectedIndex(i);
                  confirm();
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  padding: "8px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  backgroundColor: isSelected ? "var(--hover)" : "transparent",
                  color: isSelected ? "var(--fg)" : "var(--fg-2)",
                  fontSize: 13,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* color swatch */}
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      border: "1px solid var(--border-2)",
                      backgroundColor: t.colors.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: t.colors.accent }} />
                  </div>
                  <span>{t.name}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "var(--fg-3)" }}>
                    {t.type}
                  </span>
                  {isCurrent && (
                    <span style={{ fontSize: 10, color: "var(--accent)" }}>current</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div
          style={{
            padding: "8px 16px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            gap: 16,
            fontSize: 10,
            color: "var(--fg-3)",
          }}
        >
          <span>
            <kbd style={{ backgroundColor: "var(--panel-2)", padding: "1px 4px", borderRadius: 2, border: "1px solid var(--border-2)" }}>
              ↑↓
            </kbd>{" "}
            preview
          </span>
          <span>
            <kbd style={{ backgroundColor: "var(--panel-2)", padding: "1px 4px", borderRadius: 2, border: "1px solid var(--border-2)" }}>
              ↵
            </kbd>{" "}
            confirm
          </span>
          <span>
            <kbd style={{ backgroundColor: "var(--panel-2)", padding: "1px 4px", borderRadius: 2, border: "1px solid var(--border-2)" }}>
              esc
            </kbd>{" "}
            cancel
          </span>
        </div>
      </div>
    </div>
  );
}
