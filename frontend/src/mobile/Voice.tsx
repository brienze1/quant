import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { VoiceOrb, type VoiceState } from "./VoiceOrb";
import { moBuzz } from "./primitives";

export type TranscriptLine = { who: "you" | "quant"; text: string };

export const VOICE_STATE_META: Record<VoiceState, { label: string; dot: string }> = {
  idle: { label: "tap to speak", dot: "var(--fg-4)" },
  listening: { label: "listening", dot: "var(--accent)" },
  thinking: { label: "thinking", dot: "var(--info)" },
  speaking: { label: "speaking", dot: "var(--purple)" },
};

/** Persistent mini-player that sits just above the tab bar. */
export function VoiceMini({
  state,
  accentHex,
  onExpand,
  onMic,
}: {
  state: VoiceState;
  accentHex: string;
  onExpand: () => void;
  onMic: () => void;
}) {
  const meta = VOICE_STATE_META[state] || VOICE_STATE_META.idle;
  const live = state === "listening" || state === "speaking";
  return (
    <div
      onClick={onExpand}
      className="mo-tap"
      style={{
        flex: "none",
        margin: "0 10px 8px",
        display: "flex",
        alignItems: "center",
        gap: 11,
        height: 52,
        padding: "0 8px 0 12px",
        borderRadius: 15,
        cursor: "pointer",
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        boxShadow: "0 1px 2px rgba(0,0,0,.2), inset 0 1px 0 var(--top-hi)",
      }}
    >
      <div style={{ width: 30, height: 30, flex: "none", position: "relative" }}>
        <VoiceOrb state={state} accent={accentHex} size={30} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", letterSpacing: "-0.01em" }}>Voice</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: meta.dot,
              boxShadow: live ? `0 0 6px ${meta.dot}` : "none",
            }}
          />
          <span style={{ fontSize: 11, color: "var(--fg-3)", textTransform: "capitalize" }}>{meta.label}</span>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          moBuzz();
          onMic();
        }}
        className="mo-tap"
        aria-label="Toggle mic"
        style={{
          width: 40,
          height: 40,
          flex: "none",
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: live ? "var(--accent)" : "var(--panel-3)",
          color: live ? "var(--on-accent)" : "var(--fg-2)",
        }}
      >
        <Icon name={live ? "stop" : "mic"} size={18} />
      </button>
      <span style={{ display: "flex", color: "var(--fg-4)", paddingRight: 2 }}>
        <Icon name="chevronRight" size={16} style={{ transform: "rotate(-90deg)" }} />
      </span>
    </div>
  );
}

/**
 * Full-screen voice sheet. When `body` is provided (the REAL <VoicePane/>), it is
 * rendered full-bleed under the header — VoicePane brings its own orb, live
 * transcript and mic controls, so the scripted orb/transcript/controls below are
 * skipped. When `body` is absent, the self-contained scripted orb + transcript +
 * controls render as a stand-alone fallback.
 */
export function VoiceSheet({
  open,
  onClose,
  state,
  accentHex,
  transcript,
  onMic,
  subtitle,
  body,
}: {
  open: boolean;
  onClose: () => void;
  state: VoiceState;
  accentHex: string;
  transcript: TranscriptLine[];
  onMic: () => void;
  subtitle?: string;
  body?: ReactNode;
}) {
  const scRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, open]);
  if (!open) return null;
  const meta = VOICE_STATE_META[state] || VOICE_STATE_META.idle;
  const live = state === "listening" || state === "speaking";
  const orbSize = Math.min(260, (typeof innerWidth !== "undefined" ? innerWidth : 360) * 0.62);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 320,
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(120% 80% at 50% 8%, color-mix(in srgb, var(--accent) 10%, var(--bg)) 0%, var(--bg) 60%)",
        paddingTop: "var(--safe-t)",
        animation: "moFadeIn .22s ease",
      }}
    >
      {/* top */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px 4px 18px" }}>
        <div style={{ flex: 1 }}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--fg-3)",
              fontWeight: 600,
            }}
          >
            voice · jarvis
          </div>
          <div style={{ fontSize: 13, color: "var(--fg-2)" }}>{subtitle || "quant"}</div>
        </div>
        <button
          onClick={onClose}
          className="mo-tap"
          aria-label="Collapse"
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            background: "var(--panel-2)",
            color: "var(--fg-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="chevronDown" size={20} />
        </button>
      </div>
      {/* REAL voice pane (full-bleed): VoicePane owns its orb/transcript/controls */}
      {body ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{body}</div>
      ) : (
      <>
      {/* orb */}
      <div
        style={{
          flex: "2 1 0",
          minHeight: 200,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          position: "relative",
        }}
      >
        <VoiceOrb state={state} accent={accentHex} size={orbSize} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: meta.dot,
              boxShadow: live ? `0 0 8px ${meta.dot}` : "none",
            }}
          />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)", textTransform: "capitalize" }}>
            {meta.label}
          </span>
        </div>
      </div>
      {/* transcript */}
      <div
        ref={scRef}
        className="mo-scroll"
        style={{
          flex: "3 1 0",
          minHeight: 0,
          overflowY: "auto",
          padding: "8px 18px 6px",
          display: "flex",
          flexDirection: "column",
          gap: 13,
        }}
      >
        {transcript.map((l, i) => (
          <div key={i} className="mo-msg-in" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span
              className="mono"
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: l.who === "you" ? "var(--accent)" : "var(--info)",
              }}
            >
              {l.who}
            </span>
            <span style={{ fontSize: 15, lineHeight: 1.5, color: l.who === "you" ? "var(--fg)" : "var(--fg-2)" }}>
              {l.text}
            </span>
          </div>
        ))}
      </div>
      {/* controls */}
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 26,
          padding: "12px 0 calc(20px + var(--safe-b))",
        }}
      >
        <button
          className="mo-tap"
          aria-label="Keyboard"
          style={{
            width: 52,
            height: 52,
            borderRadius: 999,
            border: "1px solid var(--border)",
            cursor: "pointer",
            background: "var(--panel-2)",
            color: "var(--fg-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="keyboard" size={20} />
        </button>
        <button
          onClick={() => {
            moBuzz(12);
            onMic();
          }}
          className="mo-tap"
          aria-label="Talk"
          style={{
            width: 78,
            height: 78,
            borderRadius: 999,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: live ? "var(--accent)" : "var(--panel-2)",
            color: live ? "var(--on-accent)" : "var(--fg)",
            border: live ? "none" : "1px solid var(--border)",
            boxShadow: live
              ? "0 0 0 6px var(--accent-soft), 0 8px 24px -6px var(--accent)"
              : "var(--shadow-panel)",
          }}
        >
          <Icon name={live ? "stop" : "mic"} size={30} />
        </button>
        <button
          className="mo-tap"
          aria-label="End"
          onClick={onClose}
          style={{
            width: 52,
            height: 52,
            borderRadius: 999,
            border: "1px solid color-mix(in srgb, var(--danger) 40%, var(--border))",
            cursor: "pointer",
            background: "color-mix(in srgb, var(--danger) 12%, transparent)",
            color: "var(--danger)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="x" size={20} />
        </button>
      </div>
      </>
      )}
    </div>
  );
}
