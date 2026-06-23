import { useState } from "react";
import type { CreateTaskRequest } from "../types";
import { ModalShell, ModalTitle, Field, ModalInput, ModalCancel, ModalSubmit } from "./ModalShell";

interface Props {
  repoId: string;
  repoName?: string;
  onSubmit: (req: CreateTaskRequest) => void;
  onCancel: () => void;
}

export function NewTaskModal({ repoId, repoName, onSubmit, onCancel }: Props) {
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tag.trim()) return;
    onSubmit({
      repoId,
      tag: tag.trim().toLowerCase(),
      name: name.trim().toLowerCase(),
    });
  }

  const canCreate = !!tag.trim();

  return (
    <ModalShell width={440} onClose={onCancel}>
      <form onSubmit={handleSubmit} style={{ padding: "22px 26px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
        <ModalTitle>new_task</ModalTitle>
        <Field label="tag">
          <ModalInput
            autoFocus
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="PLT-123"
          />
        </Field>
        <Field label="name">
          <ModalInput value={name} onChange={(e) => setName(e.target.value)} placeholder="fix auth flow" />
        </Field>
        {repoName && (
          <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>
            // repo: {repoName}
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14, marginTop: 4 }}>
          <ModalCancel onClick={onCancel} />
          <ModalSubmit type="submit" disabled={!canCreate}>
            create
          </ModalSubmit>
        </div>
      </form>
    </ModalShell>
  );
}
