import { type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { VoiceOrb, type VoiceState } from "./VoiceOrb";
import RealVoiceOrb from "../components/VoiceOrb";
import { moBuzz } from "./primitives";

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
  active,
  dictating,
}: {
  state: VoiceState;
  accentHex: string;
  onExpand: () => void;
  onMic: () => void;
  /** When true (a voice session is attached), show the real WebGL orb. */
  active?: boolean;
  /** When true, push-to-talk dictation is streaming into the session input. */
  dictating?: boolean;
}) {
  const meta = VOICE_STATE_META[state] || VOICE_STATE_META.idle;
  const live = state === "listening" || state === "speaking";
  // The mic button drives dictation (STT into the chat input), separate from the
  // full voice conversation the body tap opens.
  const micActive = dictating || live;
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
        {active ? (
          <RealVoiceOrb state={state} size={30} />
        ) : (
          <VoiceOrb state={state} accent={accentHex} size={30} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", letterSpacing: "-0.01em" }}>Voice</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: dictating ? "var(--accent)" : meta.dot,
              boxShadow: dictating || live ? `0 0 6px ${dictating ? "var(--accent)" : meta.dot}` : "none",
            }}
          />
          <span style={{ fontSize: 11, color: "var(--fg-3)", textTransform: "capitalize" }}>
            {dictating ? "dictating…" : meta.label}
          </span>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          moBuzz();
          onMic();
        }}
        className="mo-tap"
        aria-label="Toggle dictation"
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
          background: micActive ? "var(--accent)" : "var(--panel-3)",
          color: micActive ? "var(--on-accent)" : "var(--fg-2)",
        }}
      >
        <Icon name={micActive ? "stop" : "mic"} size={18} />
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
 * transcript and mic controls. When `body` is absent (no active session), an
 * honest empty state renders instead — never mock content.
 */
export function VoiceSheet({
  open,
  onClose,
  onEnd,
  keepMounted,
  subtitle,
  body,
}: {
  open: boolean;
  onClose: () => void;
  /** Truly END the voice conversation (detach + close). Collapse (onClose) only hides the sheet. */
  onEnd?: () => void;
  /**
   * Keep the sheet's body MOUNTED (hidden) while collapsed, so the live
   * <VoicePane/> inside — audio service + voice bridge — survives a minimize
   * and the conversation keeps going. Without this, collapsing unmounts the
   * pane and tears the voice session down mid-conversation.
   */
  keepMounted?: boolean;
  state: VoiceState;
  accentHex: string;
  subtitle?: string;
  body?: ReactNode;
}) {
  if (!open && !keepMounted) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 320,
        display: open ? "flex" : "none",
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
            voice
          </div>
          <div style={{ fontSize: 13, color: "var(--fg-2)" }}>{subtitle || "quant"}</div>
        </div>
        {onEnd && body ? (
          <button
            onClick={onEnd}
            className="mo-tap"
            aria-label="End voice"
            style={{
              height: 36,
              padding: "0 14px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              background: "color-mix(in srgb, #e5484d 18%, var(--panel-2))",
              color: "#ff8589",
            }}
          >
            <Icon name="stop" size={14} />
            End
          </button>
        ) : null}
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
      {/* REAL voice pane (full-bleed): VoicePane owns its orb/transcript/controls.
          When absent (no active session), show an honest empty state — no mock. */}
      {body ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{body}</div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "24px",
            textAlign: "center",
          }}
        >
          <span
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              color: "var(--fg-3)",
            }}
          >
            <Icon name="mic" size={24} />
          </span>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)" }}>No session for voice</div>
          <div style={{ fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5, maxWidth: 260 }}>
            Open a session from ☰ first — voice attaches to the active session.
          </div>
        </div>
      )}
    </div>
  );
}
