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
    backgroundColor: "#1F1F1F",
    border: "1px solid #2a2a2a",
    color: "#FAFAFA",
    fontFamily: "'JetBrains Mono', monospace",
    outline: "none",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm p-6"
        style={{
          backgroundColor: "#0A0A0A",
          border: "1px solid #2a2a2a",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <label className="block text-[10px] mb-3 lowercase" style={{ color: "#6B7280" }}>
          // rename task
        </label>
        <label className="block text-[10px] mb-1 lowercase" style={{ color: "#6B7280" }}>
          name
        </label>
        <input
          ref={tagRef}
          type="text"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="w-full px-3 py-2 text-xs mb-4"
          style={inputStyle}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
        />
        <label className="block text-[10px] mb-1 lowercase" style={{ color: "#6B7280" }}>
          description
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 text-xs mb-5"
          style={inputStyle}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
        />
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{ color: "#6B7280" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
          >
            cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{ backgroundColor: "#10B981", color: "#0A0A0A", fontWeight: 500 }}
          >
            rename
          </button>
        </div>
      </form>
    </div>
  );
}
