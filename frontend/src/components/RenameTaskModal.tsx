import { useState, useEffect, useRef } from "react";
import { ModalShell, Field, ModalInput, ModalCancel, ModalSubmit } from "./ModalShell";

interface Props {
  currentTag: string;
  currentName: string;
  onSubmit: (newTag: string, newName: string) => void;
  onCancel: () => void;
}

export function RenameTaskModal({ currentTag, currentName, onSubmit, onCancel }: Props) {
  const [tag, setTag] = useState(currentTag);
  const [name, setName] = useState(currentName);
  const tagRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    tagRef.current?.focus();
    tagRef.current?.select();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTag = tag.trim();
    const trimmedName = name.trim();
    if (!trimmedTag) return;
    const tagChanged = trimmedTag !== currentTag;
    const nameChanged = trimmedName !== currentName;
    if (tagChanged || nameChanged) {
      onSubmit(trimmedTag, trimmedName);
    }
  }

  return (
    <ModalShell width={400} onClose={onCancel} align="center">
      <form onSubmit={handleSubmit} style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--fg-3)" }}>
          // rename task
        </span>
        <Field label="tag">
          <ModalInput ref={tagRef} type="text" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="PLT-123" />
        </Field>
        <Field label="name">
          <ModalInput type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="fix auth flow" />
        </Field>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14 }}>
          <ModalCancel onClick={onCancel} />
          <ModalSubmit type="submit" disabled={!tag.trim()}>rename</ModalSubmit>
        </div>
      </form>
    </ModalShell>
  );
}
