import { useState } from "react";
import type { CreateTaskRequest, Repo } from "../types";
import { ModalShell, ModalTitle, Field, ModalInput, ModalSelect, ModalCancel, ModalSubmit } from "./ModalShell";

interface Props {
  repoId?: string;
  repoName?: string;
  repos?: Repo[];
  onSubmit: (req: CreateTaskRequest) => void;
  onCancel: () => void;
}

export function NewTaskModal({ repoId, repoName, repos, onSubmit, onCancel }: Props) {
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  // When no fixed repo is supplied, let the user pick one in-modal.
  const showRepoSelect = !repoId && !!repos && repos.length > 0;
  const [selectedRepoId, setSelectedRepoId] = useState(repoId ?? repos?.[0]?.id ?? "");

  const effectiveRepoId = repoId ?? selectedRepoId;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tag.trim() || !effectiveRepoId) return;
    onSubmit({
      repoId: effectiveRepoId,
      tag: tag.trim().toLowerCase(),
      name: name.trim().toLowerCase(),
    });
  }

  const canCreate = !!tag.trim() && !!effectiveRepoId;

  return (
    <ModalShell width={440} onClose={onCancel}>
      <form onSubmit={handleSubmit} style={{ padding: "22px 26px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
        <ModalTitle>new_task</ModalTitle>
        {showRepoSelect && (
          <Field label="repo">
            <ModalSelect
              value={selectedRepoId}
              onChange={setSelectedRepoId}
              options={repos!.map((r) => ({ value: r.id, label: `${r.name} (${r.path})` }))}
              placeholder="select a repo"
            />
          </Field>
        )}
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
        {!showRepoSelect && repoName && (
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
