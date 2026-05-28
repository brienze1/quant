import React, { useState } from "react";
import type { SchemaField } from "../types";

const TYPES = ["string", "number", "boolean", "object", "array"] as const;
const SOURCES = ["passthrough", "produced"] as const;
const font = "'JetBrains Mono', monospace";

interface Props {
  kind: "input" | "output";
  fields: SchemaField[];
  onChange: (next: SchemaField[]) => void;
}

/**
 * SchemaFieldEditor — per-row editor for the `inputs` or `outputs` array on
 * a Job. Modelled after the Shortcuts editor in Settings.tsx; uses the same
 * JetBrains Mono / lowercase aesthetic and css vars.
 *
 * For `kind="input"` the row shows: key | type | required toggle | x
 * For `kind="output"` the row shows: key | type | source select   | x
 *
 * issue #50: typed metadata pipeline contract editor.
 */
export function SchemaFieldEditor({ kind, fields, onChange }: Props) {
  const [newKey, setNewKey] = useState("");

  function updateRow(index: number, patch: Partial<SchemaField>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeRow(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  function addRow() {
    const key = newKey.trim();
    if (!key) return;
    const blank: SchemaField =
      kind === "input"
        ? { key, type: "string", required: false }
        : { key, type: "string", source: "passthrough" };
    onChange([...fields, blank]);
    setNewKey("");
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: "var(--q-bg-hover)",
    border: "1px solid var(--q-border)",
    color: "var(--q-fg)",
    fontSize: 11,
    fontFamily: font,
    padding: "4px 8px",
    outline: "none",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    color: "var(--q-accent)",
    cursor: "pointer",
  };

  return (
    <div
      data-testid={`schema-editor-${kind}`}
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      {fields.length === 0 && (
        <div
          style={{
            color: "var(--q-fg-muted)",
            fontSize: 10,
            fontFamily: font,
          }}
        >
          // no {kind === "input" ? "inputs" : "outputs"} declared
        </div>
      )}

      {fields.map((f, i) => (
        <div
          key={i}
          data-testid={`schema-field-row-${i}`}
          className="flex items-center"
          style={{ gap: 6 }}
        >
          <input
            data-testid={`schema-field-key-${i}`}
            value={f.key}
            onChange={(e) => updateRow(i, { key: e.target.value })}
            placeholder="key"
            style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
          />
          <select
            data-testid={`schema-field-type-${i}`}
            value={f.type || "string"}
            onChange={(e) => updateRow(i, { type: e.target.value })}
            style={{ ...selectStyle, width: 100 }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {kind === "input" && (
            <label
              data-testid={`schema-field-required-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontFamily: font,
                fontSize: 11,
                color: "var(--q-fg-secondary)",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={!!f.required}
                onChange={(e) => updateRow(i, { required: e.target.checked })}
              />
              required
            </label>
          )}

          {kind === "output" && (
            <select
              data-testid={`schema-field-source-${i}`}
              value={f.source || "passthrough"}
              onChange={(e) => updateRow(i, { source: e.target.value })}
              style={{ ...selectStyle, width: 120 }}
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            data-testid={`schema-field-delete-${i}`}
            onClick={() => removeRow(i)}
            style={{
              color: "var(--q-error)",
              fontSize: 11,
              fontFamily: font,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0 6px",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            x
          </button>
        </div>
      ))}

      <div
        className="flex items-center"
        style={{ gap: 6, marginTop: fields.length > 0 ? 4 : 0 }}
      >
        <input
          data-testid={`schema-field-new-key-${kind}`}
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="key"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addRow();
            }
          }}
          style={{ ...inputStyle, flex: 1, minWidth: 0 }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
        />
        <button
          type="button"
          data-testid={`schema-field-add-${kind}`}
          onClick={addRow}
          style={{
            color: "var(--q-fg-muted)",
            fontSize: 11,
            fontFamily: font,
            border: "1px dashed var(--q-border)",
            padding: "4px 10px",
            background: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--q-fg-secondary)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-muted)")}
        >
          + add field
        </button>
      </div>
    </div>
  );
}
