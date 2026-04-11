import { useState } from "react";
import type { ChangelogEntry } from "../types";

const CATEGORY_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  features: { label: "new features", icon: "+", color: "var(--q-success)" },
  fixes: { label: "bug fixes", icon: "~", color: "var(--q-warning)" },
  improvements: { label: "improvements", icon: ">", color: "var(--q-accent)" },
  internal: { label: "internal", icon: "#", color: "var(--q-fg-muted)" },
};

interface Props {
  entries: ChangelogEntry[];
  currentVersion: string;
  onClose: () => void;
}

export function ChangelogModal({ entries, currentVersion, onClose }: Props) {
  const [expandedVersion, setExpandedVersion] = useState<string | null>(
    entries.length > 0 ? entries[0].version : null
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--q-modal-backdrop)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg flex flex-col"
        style={{
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: "'JetBrains Mono', monospace",
          maxHeight: "80vh",
        }}
      >
        {/* header */}
        <div
          className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: "1px solid var(--q-border)" }}
        >
          <h2 className="text-sm font-bold lowercase" style={{ color: "var(--q-fg)" }}>
            <span style={{ color: "var(--q-accent)" }}>{">"}</span> changelog
          </h2>
          <span
            className="text-[10px] px-2 py-0.5"
            style={{
              color: "var(--q-accent)",
              border: "1px solid var(--q-accent)",
            }}
          >
            {currentVersion}
          </span>
        </div>

        {/* scrollable entries */}
        <div className="flex-1 overflow-y-auto px-6 py-4" style={{ minHeight: 0 }}>
          {entries.map((entry) => {
            const isExpanded = expandedVersion === entry.version;
            const isCurrent = entry.version === currentVersion;

            return (
              <div key={entry.version} className="mb-1">
                <button
                  onClick={() => setExpandedVersion(isExpanded ? null : entry.version)}
                  className="w-full flex items-center gap-2 py-2 text-left text-xs transition-colors"
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--q-bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <span
                    className="text-[10px] w-3 shrink-0"
                    style={{ color: "var(--q-fg-muted)" }}
                  >
                    {isExpanded ? "v" : ">"}
                  </span>
                  <span
                    className="font-bold"
                    style={{ color: isCurrent ? "var(--q-accent)" : "var(--q-fg)" }}
                  >
                    {entry.version}
                  </span>
                  <span className="flex-1" />
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--q-fg-muted)" }}
                  >
                    {entry.date}
                  </span>
                  {isCurrent && (
                    <span
                      className="text-[8px] px-1"
                      style={{
                        color: "var(--q-accent)",
                        border: "1px solid var(--q-accent)",
                      }}
                    >
                      current
                    </span>
                  )}
                </button>

                {isExpanded && (
                  <div className="pl-5 pb-3">
                    {Object.entries(entry.changes).map(([category, items]) => {
                      const meta = CATEGORY_LABELS[category] ?? {
                        label: category,
                        icon: "-",
                        color: "var(--q-fg-secondary)",
                      };

                      return (
                        <div key={category} className="mb-2">
                          <div
                            className="text-[10px] lowercase mb-1 flex items-center gap-1"
                            style={{ color: meta.color }}
                          >
                            <span>{meta.icon}</span>
                            <span>{meta.label}</span>
                          </div>
                          {items.map((item, idx) => (
                            <div
                              key={idx}
                              className="text-[11px] pl-4 py-0.5 lowercase"
                              style={{ color: "var(--q-fg-secondary)" }}
                            >
                              {item}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div
                  className="mx-0"
                  style={{ borderBottom: "1px solid var(--q-border)" }}
                />
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div
          className="flex items-center justify-end px-6 py-3 shrink-0"
          style={{ borderTop: "1px solid var(--q-border)" }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{ color: "var(--q-fg-secondary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-secondary)")}
          >
            close
          </button>
        </div>
      </div>
    </div>
  );
}
