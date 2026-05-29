import React, { useEffect, useRef, useState } from "react";
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
 * a Job. Uses quant's custom controls (FieldSelect / FieldToggle below) rather
 * than native <select>/<checkbox> so the editor matches the rest of the modal's
 * JetBrains Mono / lowercase / accent aesthetic.
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

          <FieldSelect
            testId={`schema-field-type-${i}`}
            value={f.type || "string"}
            options={TYPES}
            onChange={(v) => updateRow(i, { type: v })}
            width={92}
          />

          {kind === "input" && (
            <FieldToggle
              testId={`schema-field-required-${i}`}
              label="required"
              checked={!!f.required}
              onChange={(v) => updateRow(i, { required: v })}
            />
          )}

          {kind === "output" && (
            <FieldSelect
              testId={`schema-field-source-${i}`}
              value={f.source || "passthrough"}
              options={SOURCES}
              onChange={(v) => updateRow(i, { source: v })}
              width={116}
            />
          )}

          <button
            type="button"
            data-testid={`schema-field-delete-${i}`}
            onClick={() => removeRow(i)}
            title="delete field"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              flexShrink: 0,
              color: "var(--q-fg-secondary)",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-error)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-secondary)")}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
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

// --- Sub-components (mirror CreateJobModal's MiniSelect / ToggleSwitch so the
// contract editor uses quant's controls instead of native form elements) ---

function FieldSelect({
  testId,
  value,
  options,
  onChange,
  width,
}: {
  testId: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  width: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", width, flexShrink: 0 }}>
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        style={{
          width,
          height: 26,
          backgroundColor: "var(--q-bg-hover)",
          border: `1px solid ${open ? "var(--q-accent)" : "var(--q-border)"}`,
          color: "var(--q-accent)",
          fontSize: 11,
          fontFamily: font,
          padding: "0 8px",
          textAlign: "left",
          cursor: "pointer",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Cpath d='M0 2l4 4 4-4' fill='none' stroke='%236B7280' stroke-width='1.5'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
        }}
      >
        {value}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 0,
            zIndex: 60,
            backgroundColor: "var(--q-bg)",
            border: "1px solid var(--q-border)",
            width: "100%",
          }}
        >
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              data-testid={`${testId}-opt-${opt}`}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className="w-full flex items-center text-left"
              style={{
                height: 26,
                padding: "0 8px",
                gap: 6,
                fontFamily: font,
                fontSize: 11,
                color: opt === value ? "var(--q-accent)" : "var(--q-fg-dimmed)",
                backgroundColor: opt === value ? "var(--q-bg-hover)" : "transparent",
                border: "none",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (opt !== value)
                  e.currentTarget.style.backgroundColor = "var(--q-bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (opt !== value)
                  e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <span style={{ color: "var(--q-accent)", flexShrink: 0 }}>~</span>
              <span>{opt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldToggle({
  testId,
  label,
  checked,
  onChange,
}: {
  testId: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center" style={{ gap: 6, flexShrink: 0 }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        style={{
          width: 32,
          height: 18,
          borderRadius: 9,
          backgroundColor: checked ? "var(--q-accent)" : "var(--q-border)",
          border: "none",
          cursor: "pointer",
          position: "relative",
          transition: "background-color 150ms",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: "var(--q-fg)",
            position: "absolute",
            top: 2,
            left: checked ? 16 : 2,
            transition: "left 150ms",
          }}
        />
      </button>
      <span
        style={{
          fontFamily: font,
          fontSize: 11,
          color: "var(--q-fg-secondary)",
          userSelect: "none",
        }}
      >
        {label}
      </span>
    </div>
  );
}
