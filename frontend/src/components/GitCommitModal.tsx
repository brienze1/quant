import { useState, useEffect, useRef } from "react";

interface Props {
  sessionName: string;
  commitMessagePrefix: string;
  onSubmit: (message: string, pushAfter: boolean) => Promise<void>;
  onCancel: () => void;
}

const font = "'JetBrains Mono', monospace";

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--q-modal-backdrop)" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full p-6"
        style={{
          maxWidth: 480,
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: font,
        }}
      >
        <label className="block text-[10px] mb-4 lowercase" style={{ color: "var(--q-fg-secondary)" }}>
          // git commit
        </label>

        <div className="mb-4">
          {prefix && (
            <div
              className="px-3 py-1 text-xs mb-1"
              style={{ color: "var(--q-fg-secondary)", backgroundColor: "var(--q-bg-hover)", border: "1px solid var(--q-border)", borderBottom: "none" }}
            >
              {prefix}
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="commit message"
            className="w-full px-3 py-2 text-xs"
            style={{
              backgroundColor: "var(--q-bg-hover)",
              border: "1px solid var(--q-border)",
              color: "var(--q-fg)",
              fontFamily: font,
              outline: "none",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
          />
        </div>

        {fullMessage.trim() && (
          <div className="mb-4 px-3 py-2 text-[10px]" style={{ backgroundColor: "var(--q-bg-hover)", border: "1px solid var(--q-border)", color: "var(--q-accent)" }}>
            {fullMessage}
          </div>
        )}

        <div
          className="flex items-center gap-2 mb-5 cursor-pointer"
          style={{ color: "var(--q-fg-secondary)", fontSize: 11, fontFamily: font }}
          onClick={() => setPushAfter((v) => !v)}
        >
          <div
            style={{
              width: 14,
              height: 14,
              backgroundColor: "var(--q-bg)",
              border: `1px solid ${pushAfter ? "var(--q-accent)" : "var(--q-border)"}`,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {pushAfter && (
              <span style={{ color: "var(--q-accent)", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>x</span>
            )}
          </div>
          push after commit
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 text-[10px]" style={{ backgroundColor: "var(--q-bg-hover)", border: "1px solid var(--q-error)", color: "var(--q-error)", fontFamily: font }}>
            {error}
          </div>
        )}

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
            type="submit"
            disabled={!fullMessage.trim() || loading}
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{
              backgroundColor: fullMessage.trim() && !loading ? "var(--q-accent)" : "var(--q-bg-hover)",
              color: fullMessage.trim() && !loading ? "var(--q-bg)" : "var(--q-fg-muted)",
              fontWeight: 500,
            }}
          >
            {loading ? "..." : `commit${pushAfter ? " & push" : ""}`}
          </button>
        </div>
      </form>
    </div>
  );
}
