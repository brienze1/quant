import { useState } from "react";
import { terminalIO } from "../terminal/terminalInput";
import { moBuzz } from "./primitives";

/**
 * MoKeyBar — an on-screen key bar for the mobile terminal. A phone keyboard has
 * no Esc / Tab / arrow keys, so these send the raw control sequences straight to
 * the PTY via `terminalIO.sendInput` (the same channel xterm's onData uses).
 *
 * Ctrl is a sticky modifier: tap it, then tap a letter to send Ctrl+<letter>
 * (e.g. Ctrl+C). It auto-clears after one key.
 */
type KeySpec = { label: string; seq: string } | { label: string; ctrl: true };

const KEYS: KeySpec[] = [
  { label: "esc", seq: "\x1b" },
  { label: "tab", seq: "\t" },
  { label: "enter", seq: "\r" },
  { label: "ctrl", ctrl: true },
  { label: "↑", seq: "\x1b[A" },
  { label: "↓", seq: "\x1b[B" },
  { label: "←", seq: "\x1b[D" },
  { label: "→", seq: "\x1b[C" },
];

export function MoKeyBar({ sessionId }: { sessionId: string }) {
  const [ctrl, setCtrl] = useState(false);

  const send = (seq: string) => {
    moBuzz(6);
    if (ctrl) {
      // Map a printable letter to its Ctrl code (Ctrl+A = 0x01 … Ctrl+Z = 0x1a).
      const ch = seq.length === 1 ? seq.toLowerCase() : "";
      if (ch >= "a" && ch <= "z") {
        terminalIO.sendInput(sessionId, String.fromCharCode(ch.charCodeAt(0) - 96));
      } else {
        terminalIO.sendInput(sessionId, seq);
      }
      setCtrl(false);
      return;
    }
    terminalIO.sendInput(sessionId, seq);
  };

  return (
    <div
      className="mo-scroll"
      style={{
        flex: "none",
        display: "flex",
        gap: 6,
        padding: "6px 10px",
        overflowX: "auto",
        borderTop: "1px solid var(--border-2)",
        background: "var(--panel)",
      }}
    >
      {KEYS.map((k) => {
        const active = "ctrl" in k && ctrl;
        return (
          <button
            key={k.label}
            onClick={() => {
              if ("ctrl" in k) {
                moBuzz(6);
                setCtrl((v) => !v);
              } else {
                send(k.seq);
              }
            }}
            className="mo-tap"
            style={{
              flex: "0 0 auto",
              minWidth: 44,
              height: 38,
              padding: "0 12px",
              borderRadius: 9,
              border: "1px solid var(--border-2)",
              cursor: "pointer",
              background: active ? "var(--accent)" : "var(--panel-2)",
              color: active ? "var(--on-accent)" : "var(--fg-2)",
              fontFamily: "var(--mono)",
              fontSize: 14,
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {k.label}
          </button>
        );
      })}
    </div>
  );
}
