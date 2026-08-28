import { useState } from "react";
import type { Session } from "../types";
import { ModalShell } from "./ModalShell";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Pill } from "./Pill";

interface Props {
  session: Session;
  /** every active session, used to build the link list (this one excluded) */
  sessions: Session[];
  /** repo + task labels keyed by session id, for context in the list */
  contextBySession?: Record<string, string>;
  onSave: (mode: "both" | "out", peers: string[]) => void;
  onClose: () => void;
}

/**
 * Who this session may message, and whether it accepts messages back.
 *
 * Linking is an allowlist: with nothing linked the session may message any
 * session (the default), and linking one narrows it to its linked sessions.
 * Claude can change the same list from the quant MCP with link_session, which
 * is why it is shown here — so a human can see who a session talks to.
 */
export function SessionMessagingModal({ session, sessions, contextBySession, onSave, onClose }: Props) {
  const [mode, setMode] = useState<"both" | "out">(session.messagingMode === "out" ? "out" : "both");

  const others = sessions
    .filter((s) => s.id !== session.id && s.sessionType !== "terminal" && !s.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Links are only meaningful inside one workspace, so a stored peer that is no
  // longer listed (left over from before the boundary was enforced) is dropped
  // here — saving would otherwise be refused for a link the user cannot see or
  // untick. Skipped while the list is still empty so nothing is wiped on a
  // first render.
  const [peers, setPeers] = useState<string[]>(() => {
    const stored = session.messagingPeers ?? [];
    if (others.length === 0) return stored;
    const listed = new Set(others.map((s) => s.id));
    return stored.filter((id) => listed.has(id));
  });

  function togglePeer(id: string) {
    setPeers((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  return (
    <ModalShell width={520} onClose={onClose} align="center">
      <div style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--fg-3)" }}>
          // session messaging — {session.name}
        </span>
        {/* direction */}
        <div>
          <div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 6 }}>direction</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(
              [
                { value: "both", label: "in / out", hint: "sends messages and accepts them from other sessions" },
                { value: "out", label: "out only", hint: "sends messages; other sessions cannot message this one" },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "7px 10px",
                  borderRadius: 7,
                  cursor: "pointer",
                  border: `1px solid ${mode === opt.value ? "var(--accent)" : "var(--border-2)"}`,
                  background: mode === opt.value ? "var(--accent-soft)" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="messaging-mode"
                  checked={mode === opt.value}
                  onChange={() => setMode(opt.value)}
                  style={{ marginTop: 2 }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12, color: "var(--fg)" }}>{opt.label}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--fg-4)" }}>{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* links */}
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "var(--fg-3)" }}>linked sessions</span>
            <span style={{ fontSize: 10.5, color: "var(--fg-4)" }}>
              {peers.length === 0 ? "nothing linked — any session may be messaged" : `${peers.length} linked`}
            </span>
          </div>

          {others.length === 0 ? (
            <div className="mono" style={{ padding: "18px 12px", textAlign: "center", fontSize: 11, color: "var(--fg-4)" }}>
              no other active sessions.
            </div>
          ) : (
            <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
              {others.map((s) => {
                const checked = peers.includes(s.id);
                return (
                  <label
                    key={s.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 7,
                      cursor: "pointer",
                      background: checked ? "var(--accent-soft)" : "transparent",
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => togglePeer(s.id)} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "var(--fg)",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {s.name}
                      </span>
                      {contextBySession?.[s.id] && (
                        <span
                          className="mono"
                          style={{
                            display: "block",
                            fontSize: 9.5,
                            color: "var(--fg-4)",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {contextBySession[s.id]}
                        </span>
                      )}
                    </span>
                    {s.messagingMode === "out" && <Pill tone="warn">send-only</Pill>}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, color: "var(--fg-4)" }}>
          <Icon name="terminal" size={11} />
          this session can change its own links from the quant mcp (link_session / unlink_session).
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="subtle" size="sm" onClick={onClose}>
            cancel
          </Button>
          <Button size="sm" onClick={() => onSave(mode, peers)}>
            save
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
