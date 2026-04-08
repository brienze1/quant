import { useState } from "react";
import type { CreateRepoRequest } from "../types";
import * as api from "../api";

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

  const inputStyle = {
    backgroundColor: "var(--q-bg)",
    border: "1px solid var(--q-border)",
    color: "var(--q-fg)",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--q-modal-backdrop)" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md p-6"
        style={{
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <h2 className="text-sm font-bold lowercase mb-4" style={{ color: "var(--q-fg)" }}>
          <span style={{ color: "var(--q-accent)" }}>{">"}</span> open_repo
        </h2>

        <label className="block mb-3">
          <span className="text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>path</span>
          <div className="flex gap-2 mt-1">
            <input
              autoFocus
              value={path}
              onChange={(e) => handlePathChange(e.target.value)}
              placeholder="~/projects/my-app"
              className="flex-1 px-3 py-2 text-xs focus:outline-none"
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
            />
            <button
              type="button"
              onClick={handleBrowse}
              className="px-3 py-2 text-xs lowercase transition-colors shrink-0"
              style={{
                border: "1px solid var(--q-border)",
                color: "var(--q-fg-secondary)",
                backgroundColor: "var(--q-bg)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--q-accent)";
                e.currentTarget.style.color = "var(--q-accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--q-border)";
                e.currentTarget.style.color = "var(--q-fg-secondary)";
              }}
            >
              browse
            </button>
          </div>
        </label>

        <label className="block mb-5">
          <span className="text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="auto-filled from path"
            className="mt-1 block w-full px-3 py-2 text-xs focus:outline-none"
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
          />
        </label>

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
            disabled={!path.trim()}
            className="px-4 py-2 text-xs lowercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: "var(--q-accent)",
              color: "var(--q-bg)",
              fontWeight: 500,
            }}
          >
            open
          </button>
        </div>
      </form>
    </div>
  );
}
