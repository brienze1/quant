import { useState } from "react";
import type { CreateRepoRequest } from "../types";
import * as api from "../api";
import { ModalShell, ModalTitle, Field, ModalInput, ModalCancel, ModalSubmit } from "./ModalShell";

interface Props {
  onSubmit: (req: CreateRepoRequest) => void;
  onCancel: () => void;
}

export function OpenRepoModal({ onSubmit, onCancel }: Props) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");

  function autoName(p: string): string {
    const parts = p.replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || "";
  }

  function handlePathChange(value: string) {
    setPath(value);
    const parts = value.replace(/\/+$/, "").split("/");
    const basename = parts[parts.length - 1] || "";
    if (!name || name === autoName(path)) {
      setName(basename);
    }
  }

  async function handleBrowse() {
    try {
      const selected = await api.browseDirectory();
      if (selected) {
        handlePathChange(selected);
      }
    } catch (err) {
      console.error("browse failed:", err);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!path.trim()) return;
    onSubmit({
      name: (name.trim() || autoName(path.trim())).toLowerCase(),
      path: path.trim(),
    });
  }

  const canCreate = !!path.trim();

  return (
    <ModalShell width={460} onClose={onCancel}>
      <form onSubmit={handleSubmit} style={{ padding: "22px 26px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
        <ModalTitle>open_repo</ModalTitle>
        <Field label="path">
          <div style={{ display: "flex", gap: 8 }}>
            <ModalInput
              autoFocus
              value={path}
              onChange={(e) => handlePathChange(e.target.value)}
              placeholder="~/projects/my-app"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={handleBrowse}
              title="Browse…"
              style={{
                flex: "none",
                padding: "0 14px",
                height: 38,
                borderRadius: 9,
                cursor: "pointer",
                background: "var(--panel-3)",
                border: "1px solid var(--border-2)",
                color: "var(--fg-3)",
                fontFamily: "var(--mono)",
                fontSize: 12,
              }}
            >
              browse
            </button>
          </div>
        </Field>
        <Field label="name">
          <ModalInput value={name} onChange={(e) => setName(e.target.value)} placeholder="auto-filled from path" />
        </Field>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14, marginTop: 4 }}>
          <ModalCancel onClick={onCancel} />
          <ModalSubmit type="submit" disabled={!canCreate}>
            open
          </ModalSubmit>
        </div>
      </form>
    </ModalShell>
  );
}
