import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface SegmentedOption<T extends string = string> {
  value: T;
  label?: string;
  icon?: IconName | (string & {});
}

export interface SegmentedProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Segmented<T extends string = string>({ options, value, onChange }: SegmentedProps<T>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState({ left: 0, width: 0, ready: false });
  const reduced = prefersReducedMotion();

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const esc = window.CSS && window.CSS.escape ? window.CSS.escape(value) : value;
    const btn = wrap.querySelector<HTMLElement>(`[data-seg="${esc}"]`);
    if (btn) setInd({ left: btn.offsetLeft, width: btn.offsetWidth, ready: true });
  }, [value, options]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        display: "inline-flex",
        padding: 2,
        gap: 2,
        borderRadius: 9,
        background: "var(--panel-3)",
        border: "1px solid var(--border-2)",
      }}
    >
      {/* sliding selection pill */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 2,
          bottom: 2,
          left: ind.left,
          width: ind.width,
          borderRadius: 7,
          background: "var(--panel)",
          boxShadow: "0 1px 2px rgba(0,0,0,.18), inset 0 1px 0 var(--top-hi)",
          opacity: ind.ready ? 1 : 0,
          pointerEvents: "none",
          transition:
            ind.ready && !reduced
              ? "left .26s cubic-bezier(.34,1.2,.5,1), width .26s cubic-bezier(.34,1.2,.5,1)"
              : "none",
        }}
      />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            title={o.label || o.value}
            data-seg={o.value}
            style={{
              position: "relative",
              zIndex: 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: o.icon && !o.label ? "4px 7px" : "4px 10px",
              borderRadius: 7,
              cursor: "pointer",
              border: "none",
              fontSize: 11.5,
              fontWeight: 500,
              fontFamily: "var(--sans)",
              color: on ? "var(--fg)" : "var(--fg-3)",
              background: "transparent",
              boxShadow: "none",
              transition: reduced ? "none" : "color .22s ease",
            }}
          >
            {o.icon && <Icon name={o.icon} size={13} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
