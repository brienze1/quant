import { useState } from "react";
import type { ChangelogEntry } from "../types";
import { Pill } from "./Pill";
import { ModalShell, ModalTitle, ModalCancel } from "./ModalShell";

const CATEGORY_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  features: { label: "new features", icon: "+", color: "var(--ok)" },
  fixes: { label: "bug fixes", icon: "~", color: "var(--warn)" },
  improvements: { label: "improvements", icon: ">", color: "var(--accent)" },
  internal: { label: "internal", icon: "#", color: "var(--fg-3)" },
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
    <ModalShell width={540} onClose={onClose}>
      {/* header */}
      <div
        className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <ModalTitle>changelog</ModalTitle>
        <Pill tone="accent">{currentVersion}</Pill>
      </div>

      {/* scrollable entries */}
      <div className="flex-1 overflow-y-auto px-6 py-4" style={{ minHeight: 0, fontFamily: "var(--mono)" }}>
          {entries.map((entry) => {
            const isExpanded = expandedVersion === entry.version;
            const isCurrent = entry.version === currentVersion;

            return (
              <div key={entry.version} className="mb-1">
                <button
                  onClick={() => setExpandedVersion(isExpanded ? null : entry.version)}
                  className="w-full flex items-center gap-2 py-2 text-left text-xs transition-colors"
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <span
                    className="text-[10px] w-3 shrink-0"
                    style={{ color: "var(--fg-3)" }}
                  >
                    {isExpanded ? "v" : ">"}
                  </span>
                  <span
                    className="font-bold"
                    style={{ color: isCurrent ? "var(--accent)" : "var(--fg)" }}
                  >
                    {entry.version}
                  </span>
                  <span className="flex-1" />
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--fg-3)" }}
                  >
                    {entry.date}
                  </span>
                  {isCurrent && <Pill tone="accent">current</Pill>}
                </button>

                {isExpanded && (
                  <div className="pl-5 pb-3">
                    {Object.entries(entry.changes).map(([category, items]) => {
                      const meta = CATEGORY_LABELS[category] ?? {
                        label: category,
                        icon: "-",
                        color: "var(--fg-2)",
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
                              style={{ color: "var(--fg-2)" }}
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
                  style={{ borderBottom: "1px solid var(--border)" }}
                />
              </div>
            );
          })}
      </div>

      {/* footer */}
      <div
        className="flex items-center justify-end px-6 py-3 shrink-0"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <ModalCancel onClick={onClose}>close</ModalCancel>
      </div>
    </ModalShell>
  );
}
