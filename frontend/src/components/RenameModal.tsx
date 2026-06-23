import { useState, useEffect, useRef } from "react";
import { ModalShell, ModalInput, ModalCancel, ModalSubmit } from "./ModalShell";

interface Props {
  currentName: string;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}

export function RenameModal({ currentName, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed && trimmed !== currentName) {
      onSubmit(trimmed);
    }
  }

  return (
    <ModalShell width={400} onClose={onCancel} align="center">
      <form onSubmit={handleSubmit} style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--fg-3)" }}>
          // rename
        </span>
        <ModalInput
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14 }}>
          <ModalCancel onClick={onCancel} />
          <ModalSubmit type="submit" disabled={!name.trim() || name.trim() === currentName}>rename</ModalSubmit>
        </div>
      </form>
    </ModalShell>
  );
}
