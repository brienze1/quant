import { useState, useEffect } from "react";
import type { Session, ExternalSession } from "../types";
import * as api from "../api";

const font = "'JetBrains Mono', monospace";

export const CLAUDE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

// List of adoptable claude conversations for a directory plus a paste-an-id
// input. A pasted valid UUID takes precedence over the list selection.
export function ClaudeSessionPicker({
  directory,
  selectedId,
  onSelect,
  pastedId,
  onPaste,
  disabled,
}: {
  directory: string;
  selectedId: string;
  onSelect: (id: string) => void;
  pastedId: string;
  onPaste: (v: string) => void;
  disabled?: boolean;
}) {
  const [list, setList] = useState<ExternalSession[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setList(null);
    setLoadError(null);
    if (!directory) {
      setList([]);
      return;
    }
    let cancelled = false;
    api.listAdoptableSessions(directory)
      .then((r) => { if (!cancelled) setList(r); })
      .catch((err) => { if (!cancelled) { setList([]); setLoadError(String(err)); } });
    return () => { cancelled = true; };
  }, [directory]);

  const pasted = pastedId.trim();
  const pastedValid = CLAUDE_UUID_RE.test(pasted);

  return (
    <div className="flex flex-col gap-2" style={{ opacity: disabled ? 0.4 : 1 }}>
      <div style={{ border: "1px solid var(--q-border)", maxHeight: 180, overflowY: "auto" }}>
        {list === null && !loadError && (
          <div className="px-3 py-2 text-[10px]" style={{ color: "var(--q-fg-muted)", fontFamily: font }}>
            loading...
          </div>
        )}
        {loadError && (
          <div className="px-3 py-2 text-[10px]" style={{ color: "var(--q-error)", fontFamily: font }}>
            {loadError}
          </div>
        )}
        {list !== null && !loadError && list.length === 0 && (
          <div className="px-3 py-2 text-[10px]" style={{ color: "var(--q-fg-muted)", fontFamily: font }}>
            no untracked claude sessions found for this repo's directory
          </div>
        )}
        {list?.map((s, i) => {
          const selected = !pastedValid && selectedId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(selected ? "" : s.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
              style={{
                fontFamily: font,
                fontSize: 11,
                color: selected ? "var(--q-accent)" : "var(--q-fg)",
                backgroundColor: selected ? "var(--q-bg-hover)" : "transparent",
                border: "none",
                borderBottom: i < (list?.length ?? 0) - 1 ? "1px solid var(--q-border)" : "none",
                cursor: disabled ? "default" : "pointer",
              }}
              onMouseEnter={(e) => {
                if (!selected && !disabled) e.currentTarget.style.backgroundColor = "var(--q-bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (!selected) e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <span style={{ color: "var(--q-accent)", flexShrink: 0 }}>{selected ? "(x)" : "( )"}</span>
              <span style={{ flexShrink: 0 }}>{s.id.slice(0, 8)}</span>
              <span
                className="flex-1 overflow-hidden whitespace-nowrap"
                style={{ textOverflow: "ellipsis", color: "var(--q-fg-secondary)" }}
              >
                {s.firstMessage || "(no messages)"}
              </span>
              <span style={{ color: "var(--q-fg-muted)", fontSize: 9, flexShrink: 0 }}>
                {relativeTime(s.modTime)}
              </span>
            </button>
          );
        })}
      </div>

      <label className="block">
        <span className="text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)", fontFamily: font }}>
          or paste a session id
        </span>
        <input
          value={pastedId}
          onChange={(e) => onPaste(e.target.value)}
          disabled={disabled}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          className="mt-1 block w-full px-3 py-2 text-xs focus:outline-none"
          style={{
            backgroundColor: "var(--q-bg)",
            border: "1px solid var(--q-border)",
            color: "var(--q-fg)",
            fontFamily: font,
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
        />
        {pasted !== "" && !pastedValid && (
          <span className="block mt-1 text-[9px]" style={{ color: "var(--q-warning)", fontFamily: font }}>
            not a valid session id (expects a uuid)
          </span>
        )}
      </label>
    </div>
  );
}

interface Props {
  session: Session;
  onDone: () => void;
  onCancel: () => void;
}

export function ChangeSessionIdModal({ session, onDone, onCancel }: Props) {
  const [selectedId, setSelectedId] = useState("");
  const [pastedId, setPastedId] = useState("");
  const [detach, setDetach] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const directory = session.worktreePath || session.directory;
  const pasted = pastedId.trim();
  const pastedValid = CLAUDE_UUID_RE.test(pasted);
  const chosenId = detach ? "" : pastedValid ? pasted.toLowerCase() : selectedId;
  const canSubmit = detach || chosenId !== "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.setClaudeSessionId(session.id, chosenId);
      onDone();
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--q-modal-backdrop)" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md p-6 max-h-[90vh] flex flex-col gap-4 overflow-y-auto"
        style={{
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: font,
        }}
      >
        <label className="block text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>
          // change claude session id
        </label>

        <div className="text-[10px]" style={{ color: "var(--q-fg-muted)" }}>
          current:{" "}
          <span style={{ color: session.claudeConvId ? "var(--q-accent)" : "var(--q-fg-muted)" }}>
            {session.claudeConvId || "none"}
          </span>
        </div>

        <ClaudeSessionPicker
          directory={directory}
          selectedId={selectedId}
          onSelect={setSelectedId}
          pastedId={pastedId}
          onPaste={setPastedId}
          disabled={detach}
        />

        <button
          type="button"
          onClick={() => setDetach(!detach)}
          className="flex items-center gap-2 text-left"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          <span style={{ color: "var(--q-accent)", fontSize: 11, fontFamily: font }}>
            {detach ? "(x)" : "( )"}
          </span>
          <span style={{ color: detach ? "var(--q-accent)" : "var(--q-fg)", fontSize: 11, fontFamily: font }}>
            detach — start a fresh conversation next run
          </span>
        </button>

        {error && (
          <div
            className="px-3 py-2 text-[10px]"
            style={{
              color: "var(--q-error)",
              backgroundColor: "var(--q-error-bg)",
              border: "1px solid var(--q-border)",
            }}
          >
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
            disabled={!canSubmit || submitting}
            className="px-4 py-2 text-xs lowercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: "var(--q-accent)", color: "var(--q-bg)", fontWeight: 500 }}
          >
            {submitting ? "saving..." : detach ? "detach" : "attach"}
          </button>
        </div>
      </form>
    </div>
  );
}
