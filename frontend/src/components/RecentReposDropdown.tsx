import { useCallback, useEffect, useRef, useState } from "react";
import type { Repo } from "../types";
import * as api from "../api";

const PAGE_SIZE = 20;

interface Props {
  workspaceId: string;
  anchorRect: DOMRect;
  onSelect: (repo: Repo) => void;
  onOpenNewPath: () => void;
  onClose: () => void;
}

function relativeTime(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const diff = Date.now() - then;
  const sec = Math.max(1, Math.floor(diff / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

export function RecentReposDropdown({
  workspaceId,
  anchorRect,
  onSelect,
  onOpenNewPath,
  onClose,
}: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [emptyChecked, setEmptyChecked] = useState(false);
  const [filterFocused, setFilterFocused] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const filtered = filter
    ? repos.filter((r) => {
        const q = filter.toLowerCase();
        return r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q);
      })
    : repos;

  // total entries in the keyboard-navigable list: filtered repos + "open new path" at bottom
  const totalEntries = filtered.length + 1;
  const openNewPathIndex = filtered.length;

  const loadPage = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const page = await api.listClosedReposByWorkspace(workspaceId, PAGE_SIZE, offsetRef.current);
      setRepos((prev) => [...prev, ...page]);
      offsetRef.current += page.length;
      if (page.length < PAGE_SIZE) setHasMore(false);
    } catch (err) {
      console.error("listClosedReposByWorkspace failed:", err);
      setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setLoading(false);
    }
  }, [workspaceId]);

  // initial load
  useEffect(() => {
    loadPage().then(() => setEmptyChecked(true));
  }, [loadPage]);

  // if the workspace has no closed repos at all, fall through to the OpenRepoModal directly
  useEffect(() => {
    if (emptyChecked && repos.length === 0) {
      onOpenNewPath();
    }
  }, [emptyChecked, repos.length, onOpenNewPath]);

  // close on outside click
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // focus filter input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  // scroll selected item into view
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const item = el.children[selectedIndex] as HTMLElement | undefined;
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    if (!hasMore || loadingMoreRef.current || filter) return;
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      loadPage();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % Math.max(totalEntries, 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + Math.max(totalEntries, 1)) % Math.max(totalEntries, 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex === openNewPathIndex) {
        onOpenNewPath();
        return;
      }
      const repo = filtered[selectedIndex];
      if (repo) onSelect(repo);
    }
  }

  // hide entire dropdown until we know whether there are repos to show.
  // if empty, the parent will switch to OpenRepoModal via onOpenNewPath.
  if (!emptyChecked || repos.length === 0) return null;

  // position the panel below the anchor button. Clamp to viewport.
  const PANEL_WIDTH = 380;
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - PANEL_WIDTH - 8));
  const top = anchorRect.bottom + 6;

  return (
    <div
      ref={containerRef}
      className="fixed"
      style={{
        left,
        top,
        width: PANEL_WIDTH,
        maxHeight: 380,
        zIndex: 240,
        display: "flex",
        flexDirection: "column",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "var(--shadow-pop)",
        animation: "fadeUp .12s ease",
        fontFamily: "var(--mono)",
      }}
      onKeyDown={handleKeyDown}
      data-testid="recent-repos-dropdown"
    >
      <div
        className="mono"
        style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-2)", fontSize: 12.5, color: "var(--fg)" }}
      >
        <span style={{ color: "var(--accent)" }}>&gt;</span> open_repo
      </div>

      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-2)" }}>
        <input
          ref={inputRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter recent repos…"
          spellCheck={false}
          className="mono"
          onFocus={() => setFilterFocused(true)}
          onBlur={() => setFilterFocused(false)}
          style={{
            width: "100%",
            height: 30,
            padding: "0 10px",
            borderRadius: 8,
            outline: "none",
            background: "var(--panel-3)",
            border: `1px solid ${filterFocused ? "var(--accent)" : "var(--border-2)"}`,
            color: "var(--fg)",
            fontSize: 12,
            boxSizing: "border-box",
          }}
        />
      </div>

      <div
        className="mono"
        style={{ padding: "8px 14px 4px", fontSize: 9.5, letterSpacing: "0.06em", color: "var(--fg-4)" }}
      >
        recent
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="scroll"
        style={{ flex: 1, overflowY: "auto", minHeight: 0, paddingBottom: 4 }}
      >
        {filtered.length === 0 ? (
          <div
            className="mono"
            style={{ padding: "16px 14px", textAlign: "center", fontSize: 11, color: "var(--fg-4)" }}
          >
            no repos match
          </div>
        ) : (
          filtered.map((repo, i) => {
            const selected = i === selectedIndex;
            return (
              <button
                key={repo.id}
                data-testid="recent-repo-item"
                onClick={() => onSelect(repo)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "7px 14px",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  background: selected ? "var(--hover)" : "transparent",
                  fontFamily: "var(--mono)",
                }}
              >
                <span style={{ color: "var(--accent)", flex: "none" }}>▸</span>
                <span
                  style={{
                    fontSize: 11.5,
                    color: "var(--fg)",
                    flex: "none",
                    maxWidth: "34%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {repo.name}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    color: "var(--fg-3)",
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {repo.path}
                </span>
                <span style={{ fontSize: 9.5, color: "var(--fg-4)", flex: "none" }}>
                  {relativeTime(repo.closedAt)}
                </span>
              </button>
            );
          })
        )}
        {loading && (
          <div
            className="mono"
            style={{ padding: "8px 14px", textAlign: "center", fontSize: 10, color: "var(--fg-4)" }}
          >
            loading…
          </div>
        )}
      </div>

      <button
        data-testid="open-new-path"
        onClick={() => {
          onOpenNewPath();
        }}
        onMouseEnter={() => setSelectedIndex(openNewPathIndex)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "9px 14px",
          borderTop: "1px solid var(--border-2)",
          background: selectedIndex === openNewPathIndex ? "var(--hover)" : "transparent",
          border: "none",
          borderTopWidth: 1,
          borderTopStyle: "solid",
          borderTopColor: "var(--border-2)",
          cursor: "pointer",
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          color: "var(--fg-3)",
          textAlign: "left",
        }}
      >
        <span style={{ color: "var(--accent)" }}>+</span>
        <span>open new path…</span>
      </button>
    </div>
  );
}
