import { useState } from "react";
import type { CreateTaskRequest } from "../types";

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

  const inputStyle: React.CSSProperties = {
    backgroundColor: "var(--q-bg)",
    border: "1px solid var(--q-border)",
    color: "var(--q-fg)",
    fontFamily: "'JetBrains Mono', monospace",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--q-modal-backdrop)" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md p-8"
        style={{
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <h2 className="text-sm font-bold lowercase mb-5" style={{ color: "var(--q-fg)" }}>
          <span style={{ color: "var(--q-accent)" }}>{">"}</span> new_task
        </h2>

        <label className="block mb-4">
          <span className="text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>tag</span>
          <input
            autoFocus
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="PLT-123"
            className="mt-1 block w-full px-3 py-2 text-xs focus:outline-none"
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
          />
        </label>

        <label className="block mb-4">
          <span className="text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="fix auth flow"
            className="mt-1 block w-full px-3 py-2 text-xs focus:outline-none"
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
          />
        </label>

        {repoName && (
          <p
            className="mb-5 text-[10px]"
            style={{ color: "var(--q-fg-muted)", fontFamily: "'IBM Plex Mono', monospace" }}
          >
            // repo: {repoName}
          </p>
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
            disabled={!tag.trim()}
            className="px-4 py-2 text-xs lowercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: "var(--q-accent)",
              color: "var(--q-bg)",
              fontWeight: 500,
            }}
          >
            create
          </button>
        </div>
      </form>
    </div>
  );
}
