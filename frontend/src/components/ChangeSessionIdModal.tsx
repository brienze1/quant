import { useState, useEffect } from "react";
import type { Session, ExternalSession } from "../types";
import * as api from "../api";
import { ModalShell, Field, ModalInput, ModalCancel, ModalSubmit } from "./ModalShell";

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

function PickerRow({
  s,
  selected,
  disabled,
  notLast,
  onClick,
}: {
  s: ExternalSession;
  selected: boolean;
  disabled?: boolean;
  notLast: boolean;
  onClick: () => void;
}) {
  const [h, setH] = useState(false);
  const bg = selected ? "var(--accent-soft)" : h && !disabled ? "var(--hover)" : "transparent";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        textAlign: "left",
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: selected ? "var(--accent)" : "var(--fg)",
        background: bg,
        border: "none",
        borderBottom: notLast ? "1px solid var(--border-2)" : "none",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <span style={{ color: "var(--accent)", flex: "none" }}>{selected ? "(x)" : "( )"}</span>
      <span style={{ flex: "none" }}>{s.id.slice(0, 8)}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg-3)" }}>
        {s.firstMessage || "(no messages)"}
      </span>
      <span style={{ color: "var(--fg-4)", fontSize: 9.5, flex: "none" }}>{relativeTime(s.modTime)}</span>
    </button>
  );
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
    <div style={{ display: "flex", flexDirection: "column", gap: 13, opacity: disabled ? 0.4 : 1 }}>
      <div
        className="scroll"
        style={{ border: "1px solid var(--border-2)", borderRadius: 9, maxHeight: 180, overflowY: "auto" }}
      >
        {list === null && !loadError && (
          <div className="mono" style={{ padding: "8px 12px", fontSize: 10, color: "var(--fg-4)" }}>
            loading…
          </div>
        )}
        {loadError && (
          <div className="mono" style={{ padding: "8px 12px", fontSize: 10, color: "var(--danger)" }}>
            {loadError}
          </div>
        )}
        {list !== null && !loadError && list.length === 0 && (
          <div className="mono" style={{ padding: "8px 12px", fontSize: 10, color: "var(--fg-4)" }}>
            no untracked claude sessions found for this repo's directory
          </div>
        )}
        {list?.map((s, i) => {
          const selected = !pastedValid && selectedId === s.id;
          return (
            <PickerRow
              key={s.id}
              s={s}
              selected={selected}
              disabled={disabled}
              notLast={i < (list?.length ?? 0) - 1}
              onClick={() => onSelect(selected ? "" : s.id)}
            />
          );
        })}
      </div>

      <Field label="or paste a session id">
        <ModalInput
          value={pastedId}
          onChange={(e) => onPaste(e.target.value)}
          disabled={disabled}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
        {pasted !== "" && !pastedValid && (
          <span className="mono" style={{ display: "block", marginTop: 5, fontSize: 9.5, color: "var(--warn)" }}>
            not a valid session id (expects a uuid)
          </span>
        )}
      </Field>
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
    <ModalShell width={460} onClose={onCancel}>
      <form
        onSubmit={handleSubmit}
        className="scroll"
        style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}
      >
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--fg-3)" }}>
          // change claude session id
        </span>

        <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>
          current:{" "}
          <span style={{ color: session.claudeConvId ? "var(--accent)" : "var(--fg-4)" }}>
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
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            textAlign: "left",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          <span className="mono" style={{ color: "var(--accent)", fontSize: 11 }}>{detach ? "(x)" : "( )"}</span>
          <span className="mono" style={{ color: detach ? "var(--accent)" : "var(--fg)", fontSize: 11 }}>
            detach — start a fresh conversation next run
          </span>
        </button>

        {error && (
          <div
            className="mono"
            style={{
              padding: "9px 12px",
              fontSize: 10,
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
          <ModalSubmit type="submit" disabled={!canSubmit || submitting}>
            {submitting ? "saving…" : detach ? "detach" : "attach"}
          </ModalSubmit>
        </div>
      </form>
    </ModalShell>
  );
}
