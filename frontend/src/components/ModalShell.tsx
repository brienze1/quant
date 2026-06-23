import { forwardRef, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";

/* ============================================================
   Shared modal shell + form atoms — design system phase 5
   Faithful port of design_source/modals.jsx, tokenised.
   ============================================================ */

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface ModalShellProps {
  width?: number;
  onClose: () => void;
  children: ReactNode;
  /** vertical alignment of the panel: "top" (default) drops it from 9vh, "center" centers it */
  align?: "top" | "center";
}

/**
 * Backdrop + panel. Closes on backdrop mousedown and on Escape.
 * Stops mousedown propagation on the panel so inner clicks don't close.
 */
export function ModalShell({ width = 540, onClose, children, align = "top" }: ModalShellProps) {
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 220,
        display: "flex",
        justifyContent: "center",
        alignItems: align === "center" ? "center" : "flex-start",
        paddingTop: align === "center" ? 0 : "9vh",
        background: "var(--scrim)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        animation: reduced ? undefined : "fadeUp .15s ease",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: "94vw",
          maxHeight: "84vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "var(--shadow-pop)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ---- modal title ---- */
export function ModalTitle({ children }: { children: ReactNode }) {
  return (
    <h2
      className="mono"
      style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--fg)" }}
    >
      <span style={{ color: "var(--accent)" }}>&gt;</span> {children}
    </h2>
  );
}

/* ---- form atoms ---- */
export const jLabel: CSSProperties = {
  display: "block",
  marginBottom: 5,
  fontFamily: "var(--mono)",
  fontSize: 10,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--fg-3)",
};

const jInputBase: CSSProperties = {
  width: "100%",
  height: 38,
  boxSizing: "border-box",
  padding: "0 12px",
  borderRadius: 9,
  background: "var(--panel-3)",
  border: "1px solid var(--border-2)",
  color: "var(--fg)",
  fontFamily: "var(--mono)",
  fontSize: 12.5,
  outline: "none",
};

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <span style={jLabel}>
        {label}
        {hint && (
          <span style={{ color: "var(--fg-4)", textTransform: "none", letterSpacing: 0 }}>
            {" "}
            · {hint}
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

type ModalInputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const ModalInput = forwardRef<HTMLInputElement, ModalInputProps>(function ModalInput(props, ref) {
  const [f, setF] = useState(false);
  return (
    <input
      {...props}
      ref={ref}
      spellCheck={false}
      onFocus={(e) => {
        setF(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setF(false);
        props.onBlur?.(e);
      }}
      style={{
        ...jInputBase,
        borderColor: f ? "var(--accent)" : "var(--border-2)",
        ...(props.style || {}),
      }}
    />
  );
});

type ModalTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function ModalTextarea(props: ModalTextareaProps) {
  const [f, setF] = useState(false);
  return (
    <textarea
      {...props}
      spellCheck={false}
      onFocus={(e) => {
        setF(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setF(false);
        props.onBlur?.(e);
      }}
      style={{
        ...jInputBase,
        height: props.rows ? undefined : 96,
        padding: "9px 12px",
        resize: "vertical",
        lineHeight: 1.5,
        borderColor: f ? "var(--accent)" : "var(--border-2)",
        ...(props.style || {}),
      }}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function ModalSelect({
  value,
  options,
  onChange,
  width = "100%",
  placeholder,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  width?: number | string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const cur = options.find((o) => o.value === value);
  return (
    <div ref={ref} style={{ position: "relative", width }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          ...jInputBase,
          width,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          color: cur ? "var(--fg)" : "var(--fg-4)",
          borderColor: open ? "var(--accent)" : "var(--border-2)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {cur ? cur.label : placeholder ?? value}
        </span>
        <Icon name="chevronDown" size={13} color="var(--fg-4)" />
      </button>
      {open && (
        <div
          className="scroll"
          style={{
            position: "absolute",
            top: 42,
            left: 0,
            width: "100%",
            maxHeight: 200,
            overflowY: "auto",
            zIndex: 5,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: 5,
            boxShadow: "var(--shadow-pop)",
          }}
        >
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "7px 9px",
                  borderRadius: 7,
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  color: on ? "var(--accent)" : "var(--fg-2)",
                  background: on ? "var(--accent-soft)" : "transparent",
                }}
              >
                <span style={{ color: "var(--accent)", opacity: on ? 1 : 0 }}>~</span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const reduced = prefersReducedMotion();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 38,
        height: 22,
        borderRadius: 11,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        position: "relative",
        flex: "none",
        opacity: disabled ? 0.5 : 1,
        background: checked ? "var(--accent)" : "var(--border)",
        transition: reduced ? "none" : "background .15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 19 : 3,
          width: 16,
          height: 16,
          borderRadius: 8,
          background: "#fff",
          transition: reduced ? "none" : "left .15s",
          boxShadow: "0 1px 2px rgba(0,0,0,.3)",
        }}
      />
    </button>
  );
}

/* ---- advanced-section helpers ---- */
export function SectionRow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

export function AdvLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="mono"
      style={{ color: "var(--accent)", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}
    >
      {children}
    </span>
  );
}

export function AdvDivider() {
  return <div style={{ height: 1, background: "var(--border-2)" }} />;
}

/** Label + sub-description stack used on the left of an advanced SectionRow. */
export function RowLabel({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="mono" style={{ fontSize: 11.5, color: "var(--fg)" }}>
        {title}
      </span>
      {sub && (
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>
          {sub}
        </span>
      )}
    </div>
  );
}

/* ---- footer action buttons ---- */
export function ModalCancel({ onClick, children = "cancel" }: { onClick: () => void; children?: ReactNode }) {
  const [h, setH] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        height: 38,
        padding: "0 14px",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontFamily: "var(--mono)",
        fontSize: 12.5,
        color: h ? "var(--fg)" : "var(--fg-3)",
      }}
    >
      {children}
    </button>
  );
}

export function ModalSubmit({
  type = "button",
  disabled,
  onClick,
  children,
  tone = "accent",
}: {
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  /** "accent" (default), "warn", or "danger" */
  tone?: "accent" | "warn" | "danger";
}) {
  const bg = tone === "danger" ? "var(--danger)" : tone === "warn" ? "var(--warn)" : "var(--accent)";
  const fg = tone === "accent" ? "var(--on-accent)" : "var(--bg)";
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 38,
        padding: "0 22px",
        borderRadius: 9,
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "var(--mono)",
        fontSize: 12.5,
        fontWeight: 600,
        background: bg,
        color: fg,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}
