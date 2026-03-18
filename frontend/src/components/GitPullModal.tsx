import { useState, useEffect, useRef } from "react";

interface Props {
  currentBranch: string;
  onSubmit: (branch: string) => void;
  onCancel: () => void;
}

const font = "'JetBrains Mono', monospace";

const COMMON_BRANCHES = ["main", "master", "develop", "dev"];

export function GitPullModal({ currentBranch, onSubmit, onCancel }: Props) {
  const [branch, setBranch] = useState(currentBranch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = branch.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  const suggestions = COMMON_BRANCHES.filter(
    (b) => b !== currentBranch && b !== branch.trim()
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full p-6"
        style={{
          maxWidth: 400,
          backgroundColor: "#0A0A0A",
          border: "1px solid #2a2a2a",
          fontFamily: font,
        }}
      >
        <label className="block text-[10px] mb-1 lowercase" style={{ color: "#6B7280" }}>
          // git pull origin
        </label>
        <div className="text-[10px] mb-4" style={{ color: "#4B5563" }}>
          current branch: <span style={{ color: "#10B981" }}>{currentBranch}</span>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="branch name"
          className="w-full px-3 py-2 text-xs mb-3"
          style={{
            backgroundColor: "#1F1F1F",
            border: "1px solid #2a2a2a",
            color: "#FAFAFA",
            fontFamily: font,
            outline: "none",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
        />

        {suggestions.length > 0 && (
          <div className="flex gap-2 mb-4">
            {[currentBranch, ...suggestions].map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBranch(b)}
                className="px-2 py-1 text-[10px] lowercase transition-colors"
                style={{
                  backgroundColor: branch === b ? "#10B981" : "#1F1F1F",
                  color: branch === b ? "#0A0A0A" : "#6B7280",
                  border: "1px solid #2a2a2a",
                  fontFamily: font,
                }}
                onMouseEnter={(e) => { if (branch !== b) e.currentTarget.style.color = "#FAFAFA"; }}
                onMouseLeave={(e) => { if (branch !== b) e.currentTarget.style.color = "#6B7280"; }}
              >
                {b}
              </button>
            ))}
          </div>
        )}

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
            disabled={!branch.trim()}
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{
              backgroundColor: branch.trim() ? "#10B981" : "#1F1F1F",
              color: branch.trim() ? "#0A0A0A" : "#4B5563",
              fontWeight: 500,
            }}
          >
            pull
          </button>
        </div>
      </form>
    </div>
  );
}
