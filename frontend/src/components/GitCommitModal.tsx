import { useState, useEffect, useRef } from "react";
import { ModalShell, ModalInput, Toggle, ModalCancel, ModalSubmit } from "./ModalShell";

interface Props {
  sessionName: string;
  commitMessagePrefix: string;
  onSubmit: (message: string, pushAfter: boolean) => Promise<void>;
  onCancel: () => void;
}

export function GitCommitModal({ sessionName, commitMessagePrefix, onSubmit, onCancel }: Props) {
  const prefix = commitMessagePrefix.replace(/\{session\}/g, sessionName);
  const [message, setMessage] = useState("");
  const [pushAfter, setPushAfter] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed && !prefix) return;
    setError("");
    setLoading(true);
    try {
      await onSubmit(prefix + trimmed, pushAfter);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.replace(/^.*?: /, ""));
    } finally {
      setLoading(false);
    }
  }

  const fullMessage = prefix + message;
  const canCommit = !!fullMessage.trim() && !loading;

  return (
    <ModalShell width={480} onClose={onCancel} align="center">
      <form onSubmit={handleSubmit} style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--fg-3)" }}>
          // git commit
        </span>

        <div>
          {prefix && (
            <div
              className="mono"
              style={{
                padding: "7px 12px",
                fontSize: 12,
                color: "var(--fg-3)",
                background: "var(--panel-3)",
                border: "1px solid var(--border-2)",
                borderBottom: "none",
                borderRadius: "9px 9px 0 0",
              }}
            >
              {prefix}
            </div>
          )}
          <ModalInput
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="commit message"
            style={prefix ? { borderRadius: "0 0 9px 9px" } : undefined}
          />
        </div>

        {fullMessage.trim() && (
          <div
            className="mono"
            style={{
              padding: "9px 12px",
              fontSize: 10.5,
              lineHeight: 1.5,
              borderRadius: 9,
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-line)",
              color: "var(--accent)",
            }}
          >
            {fullMessage}
          </div>
        )}

        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
          onClick={() => setPushAfter((v) => !v)}
        >
          <span className="mono" style={{ fontSize: 11.5, color: "var(--fg)" }}>push after commit</span>
          <Toggle checked={pushAfter} onChange={setPushAfter} />
        </div>

        {error && (
          <div
            className="mono"
            style={{
              padding: "9px 12px",
              fontSize: 10.5,
              lineHeight: 1.5,
              borderRadius: 9,
              background: "color-mix(in srgb, var(--danger) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--danger) 45%, transparent)",
              color: "var(--danger)",
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14 }}>
          <ModalCancel onClick={onCancel} />
          <ModalSubmit type="submit" disabled={!canCommit}>
            {loading ? "…" : `commit${pushAfter ? " & push" : ""}`}
          </ModalSubmit>
        </div>
      </form>
    </ModalShell>
  );
}
