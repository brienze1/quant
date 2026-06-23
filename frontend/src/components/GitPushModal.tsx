import { useState, useEffect } from "react";
import * as api from "../api";
import { ModalShell, ModalCancel, ModalSubmit } from "./ModalShell";

interface Props {
  sessionId: string;
  currentBranch: string;
  onSubmit: () => void;
  onCancel: () => void;
}

export function GitPushModal({ sessionId, currentBranch, onSubmit, onCancel }: Props) {
  const [commits, setCommits] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getUnpushedCommits(sessionId)
      .then(setCommits)
      .catch((err) => setError(String(err)));
  }, [sessionId]);

  const nothingToPush = commits !== null && commits.length === 0;

  return (
    <ModalShell width={480} onClose={onCancel} align="center">
      <div style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <span className="mono" style={{ fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--fg-3)" }}>
            // git push
          </span>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 6 }}>
            branch: <span style={{ color: "var(--accent)" }}>{currentBranch}</span>
          </div>
        </div>

        <div
          className="scroll"
          style={{
            border: "1px solid var(--border-2)",
            borderRadius: 9,
            minHeight: 80,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {commits === null && !error && (
            <div className="mono" style={{ padding: "12px", fontSize: 10.5, color: "var(--fg-4)" }}>loading commits…</div>
          )}
          {error && (
            <div className="mono" style={{ padding: "12px", fontSize: 10.5, color: "var(--danger)" }}>{error}</div>
          )}
          {nothingToPush && (
            <div className="mono" style={{ padding: "12px", fontSize: 10.5, color: "var(--fg-4)" }}>
              no unpushed commits
            </div>
          )}
          {commits !== null && commits.length > 0 && commits.map((c, i) => {
            const spaceIdx = c.indexOf(" ");
            const hash = spaceIdx > 0 ? c.slice(0, spaceIdx) : c;
            const msg = spaceIdx > 0 ? c.slice(spaceIdx + 1) : "";
            return (
              <div
                key={i}
                className="mono"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "8px 12px",
                  fontSize: 11,
                  borderBottom: i < commits.length - 1 ? "1px solid var(--border-2)" : "none",
                }}
              >
                <span style={{ color: "var(--accent)", flex: "none" }}>{hash}</span>
                <span style={{ color: "var(--fg)" }}>{msg}</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14 }}>
          <ModalCancel onClick={onCancel} />
          <ModalSubmit onClick={onSubmit} disabled={nothingToPush}>
            push
          </ModalSubmit>
        </div>
      </div>
    </ModalShell>
  );
}
