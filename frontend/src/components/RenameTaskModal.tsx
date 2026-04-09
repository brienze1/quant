import { useState, useEffect, useRef } from "react";

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

  const inputStyle = {
    backgroundColor: "var(--q-bg-hover)",
    border: "1px solid var(--q-border)",
    color: "var(--q-fg)",
    fontFamily: "'JetBrains Mono', monospace",
    outline: "none",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--q-modal-backdrop)" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm p-6"
        style={{
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <label className="block text-[10px] mb-3 lowercase" style={{ color: "var(--q-fg-secondary)" }}>
          // rename task
        </label>
        <label className="block text-[10px] mb-1 lowercase" style={{ color: "var(--q-fg-secondary)" }}>
          name
        </label>
        <input
          ref={tagRef}
          type="text"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="w-full px-3 py-2 text-xs mb-4"
          style={inputStyle}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
        />
        <label className="block text-[10px] mb-1 lowercase" style={{ color: "var(--q-fg-secondary)" }}>
          description
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 text-xs mb-5"
          style={inputStyle}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
        />
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
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{ backgroundColor: "var(--q-accent)", color: "var(--q-bg)", fontWeight: 500 }}
          >
            rename
          </button>
        </div>
      </form>
    </div>
  );
}
