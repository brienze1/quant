import { useState, useEffect, useRef } from "react";

interface Props {
  sessionName: string;
  commitMessagePrefix: string;
  onSubmit: (message: string, pushAfter: boolean) => void;
  onCancel: () => void;
}

const font = "'JetBrains Mono', monospace";

export function GitCommitModal({ sessionName, commitMessagePrefix, onSubmit, onCancel }: Props) {
  const prefix = commitMessagePrefix.replace(/\{\{session\}\}/g, sessionName);
  const [message, setMessage] = useState("");
  const [pushAfter, setPushAfter] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed && !prefix) return;
    onSubmit(prefix + trimmed, pushAfter);
  }

  const fullMessage = prefix + message;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full p-6"
        style={{
          maxWidth: 480,
          backgroundColor: "#0A0A0A",
          border: "1px solid #2a2a2a",
          fontFamily: font,
        }}
      >
        <label className="block text-[10px] mb-4 lowercase" style={{ color: "#6B7280" }}>
          // git commit
        </label>

        <div className="mb-4">
          {prefix && (
            <div
              className="px-3 py-1 text-xs mb-1"
              style={{ color: "#6B7280", backgroundColor: "#1F1F1F", border: "1px solid #2a2a2a", borderBottom: "none" }}
            >
              {prefix}
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="commit message"
            className="w-full px-3 py-2 text-xs"
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
        </div>

        {fullMessage.trim() && (
          <div className="mb-4 px-3 py-2 text-[10px]" style={{ backgroundColor: "#1F1F1F", border: "1px solid #2a2a2a", color: "#10B981" }}>
            {fullMessage}
          </div>
        )}

        <label
          className="flex items-center gap-2 mb-5 cursor-pointer"
          style={{ color: "#6B7280", fontSize: 11 }}
        >
          <input
            type="checkbox"
            checked={pushAfter}
            onChange={(e) => setPushAfter(e.target.checked)}
            style={{ accentColor: "#10B981" }}
          />
          push after commit
        </label>

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
            disabled={!fullMessage.trim()}
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{
              backgroundColor: fullMessage.trim() ? "#10B981" : "#1F1F1F",
              color: fullMessage.trim() ? "#0A0A0A" : "#4B5563",
              fontWeight: 500,
            }}
          >
            commit{pushAfter ? " & push" : ""}
          </button>
        </div>
      </form>
    </div>
  );
}
