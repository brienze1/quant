import { useState, useEffect, useRef, useCallback } from "react";
import * as api from "../api";

interface Props {
  sessionId: string;
  currentBranch: string;
  onSubmit: (branch: string) => void;
  onCancel: () => void;
}

const font = "'JetBrains Mono', monospace";
const MAX_HEIGHT = 200;

export function GitPullModal({ sessionId, currentBranch, onSubmit, onCancel }: Props) {
  const [branch, setBranch] = useState(currentBranch);
  const [branches, setBranches] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [thumb, setThumb] = useState({ show: false, height: 0, top: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const updateThumb = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const ratio = el.clientHeight / el.scrollHeight;
    setThumb({
      show: ratio < 1,
      height: Math.max(ratio * el.clientHeight, 24),
      top: (el.scrollTop / el.scrollHeight) * el.clientHeight,
    });
  }, []);

  useEffect(() => {
    api.listBranches(sessionId)
      .then((list) => {
        setBranches(list);
        if (list.length > 0 && list.includes(currentBranch)) {
          setBranch(currentBranch);
        } else if (list.length > 0) {
          setBranch(list[0]);
        }
      })
      .catch(() => {
        setBranches([currentBranch]);
      });
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    // recalculate thumb once list has rendered
    setTimeout(updateThumb, 0);
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, updateThumb]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!branch) return;
    onSubmit(branch);
  }

  const displayBranches = branches.length > 0 ? branches : [currentBranch];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--q-modal-backdrop)" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full p-6"
        style={{
          maxWidth: 400,
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: font,
        }}
      >
        <label className="block text-[10px] mb-1 lowercase" style={{ color: "var(--q-fg-secondary)" }}>
          // git pull origin
        </label>
        <div className="text-[10px] mb-4" style={{ color: "var(--q-fg-muted)" }}>
          current branch: <span style={{ color: "var(--q-accent)" }}>{currentBranch}</span>
        </div>

        <div ref={wrapRef} style={{ position: "relative", marginBottom: 20 }}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            style={{
              width: "100%",
              height: 32,
              backgroundColor: "var(--q-bg-input)",
              border: `1px solid ${open ? "var(--q-accent)" : "var(--q-border)"}`,
              color: "var(--q-fg)",
              fontSize: 12,
              fontFamily: font,
              padding: "0 12px",
              textAlign: "left",
              cursor: "pointer",
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Cpath d='M0 2l4 4 4-4' fill='none' stroke='%236B7280' stroke-width='1.5'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 12px center",
            }}
          >
            {branch}
          </button>
          {open && (
            <div style={{ position: "absolute", top: 36, left: 0, zIndex: 50, width: "100%", backgroundColor: "var(--q-bg)", border: "1px solid var(--q-border)" }}>
              {/* scroll container wider than box so native scrollbar hides off-screen */}
              <div style={{ position: "relative", overflow: "hidden", maxHeight: MAX_HEIGHT }}>
                <div
                  ref={listRef}
                  onScroll={updateThumb}
                  style={{ maxHeight: MAX_HEIGHT, overflowY: "scroll", width: "calc(100% + 20px)", paddingRight: "20px" }}
                >
                  {displayBranches.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => { setBranch(b); setOpen(false); }}
                      className="w-full flex items-center text-left"
                      style={{
                        height: 28,
                        padding: "0 12px",
                        gap: 8,
                        fontFamily: font,
                        fontSize: 11,
                        color: b === branch ? "var(--q-accent)" : "var(--q-fg-dimmed)",
                        backgroundColor: b === branch ? "var(--q-bg-hover)" : "transparent",
                        border: "none",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { if (b !== branch) e.currentTarget.style.backgroundColor = "var(--q-bg-hover)"; }}
                      onMouseLeave={(e) => { if (b !== branch) e.currentTarget.style.backgroundColor = "transparent"; }}
                    >
                      <span style={{ color: "var(--q-accent)", flexShrink: 0 }}>~</span>
                      <span style={{ marginLeft: 8 }}>{b}</span>
                    </button>
                  ))}
                </div>
                {/* custom scrollbar overlay */}
                {thumb.show && (
                  <>
                    <div style={{ position: "absolute", right: 0, top: 0, width: 4, height: "100%", backgroundColor: "var(--q-bg)", pointerEvents: "none" }} />
                    <div style={{ position: "absolute", right: 0, top: thumb.top, width: 4, height: thumb.height, backgroundColor: "var(--q-scrollbar-thumb)", borderRadius: 2, pointerEvents: "none" }} />
                  </>
                )}
              </div>
            </div>
          )}
        </div>

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
            disabled={!branch}
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{
              backgroundColor: branch ? "var(--q-accent)" : "var(--q-bg-hover)",
              color: branch ? "var(--q-bg)" : "var(--q-fg-muted)",
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
