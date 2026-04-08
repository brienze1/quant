import { useState, useEffect } from "react";
import * as api from "../api";

interface Props {
  sessionId: string;
  currentBranch: string;
  onSubmit: () => void;
  onCancel: () => void;
}

const font = "'JetBrains Mono', monospace";

export function GitPushModal({ sessionId, currentBranch, onSubmit, onCancel }: Props) {
  const [commits, setCommits] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getUnpushedCommits(sessionId)
      .then(setCommits)
      .catch((err) => setError(String(err)));
  }, [sessionId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--q-modal-backdrop)" }}>
      <div
        className="w-full p-6"
        style={{
          maxWidth: 480,
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: font,
        }}
      >
        <label className="block text-[10px] mb-1 lowercase" style={{ color: "var(--q-fg-secondary)" }}>
          // git push
        </label>
        <div className="text-[10px] mb-4" style={{ color: "var(--q-fg-muted)" }}>
          branch: <span style={{ color: "var(--q-accent)" }}>{currentBranch}</span>
        </div>

        <div
          className="mb-5"
          style={{
            border: "1px solid var(--q-border)",
            minHeight: 80,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {commits === null && !error && (
            <div className="px-3 py-3 text-[10px]" style={{ color: "var(--q-fg-muted)" }}>loading commits...</div>
          )}
          {error && (
            <div className="px-3 py-3 text-[10px]" style={{ color: "var(--q-error)" }}>{error}</div>
          )}
          {commits !== null && commits.length === 0 && (
            <div className="px-3 py-3 text-[10px]" style={{ color: "var(--q-fg-muted)" }}>
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
                className="flex items-start gap-3 px-3 py-2 text-[11px]"
                style={{ borderBottom: i < commits.length - 1 ? "1px solid var(--q-border)" : "none" }}
              >
                <span style={{ color: "var(--q-accent)", flexShrink: 0 }}>{hash}</span>
                <span style={{ color: "var(--q-fg)" }}>{msg}</span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{ color: "var(--q-fg-secondary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-secondary)")}
          >
            cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={commits !== null && commits.length === 0}
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{
              backgroundColor: commits !== null && commits.length === 0 ? "var(--q-bg-hover)" : "var(--q-accent)",
              color: commits !== null && commits.length === 0 ? "var(--q-fg-muted)" : "var(--q-bg)",
              fontWeight: 500,
            }}
          >
            push
          </button>
        </div>
      </div>
    </div>
  );
}
