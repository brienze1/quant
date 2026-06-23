import { useCallback, useEffect, useRef, useState } from "react";
import "./FilesPane.css";
import type { Session } from "../types";
import { FileTree } from "./FileTree";
import { PaneHeader } from "./PaneHeader";
import { IconButton } from "./IconButton";
import { Icon } from "./Icon";

const PANEL_WIDTH_KEY = "quant.filesPanel.width";
const PANEL_MIN = 200;
const PANEL_MAX = 480;
const PANEL_DEFAULT = 280;

interface Props {
  session: Session | null;
  activeFilePath: string | null;
  dirtyPaths: ReadonlySet<string>;
  onOpenFile: (path: string) => void;
  onPathDeleted: (path: string) => void;
  onPathRenamed: (oldPath: string, newPath: string) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}

// Right lateral panel: file tree for the session that owns the active tab.
export function FilesPanel({
  session,
  activeFilePath,
  dirtyPaths,
  onOpenFile,
  onPathDeleted,
  onPathRenamed,
  onClose,
  onError,
}: Props) {
  const sessionId = session?.id ?? null;
  const recentKey = sessionId ? "quant.files.recent." + sessionId : null;
  const [recent, setRecent] = useState<string[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Inline filter over the already-loaded tree. `query === null` => search closed.
  // `matchCount === -1` => filter inactive (no count chip / empty state).
  const [query, setQuery] = useState<string | null>(null);
  const [matchCount, setMatchCount] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const openSearch = () => setQuery((q) => (q === null ? "" : null));
  useEffect(() => {
    if (query !== null) searchRef.current?.focus();
  }, [query]);
  // Drop the filter whenever the active session changes.
  useEffect(() => {
    setQuery(null);
    setMatchCount(-1);
  }, [sessionId]);

  const filterTerm = (query ?? "").trim();
  const noMatches = filterTerm !== "" && matchCount === 0;

  useEffect(() => {
    if (!recentKey) {
      setRecent([]);
      return;
    }
    try {
      const list = JSON.parse(localStorage.getItem(recentKey) || "[]");
      setRecent(Array.isArray(list) ? list.slice(0, 10) : []);
    } catch {
      setRecent([]);
    }
  }, [recentKey]);

  // Persist inside the updater (not an effect) so a session switch never
  // writes the previous session's list under the new key.
  const updateRecent = useCallback(
    (fn: (prev: string[]) => string[]) => {
      if (!recentKey) return;
      setRecent((prev) => {
        const next = fn(prev);
        localStorage.setItem(recentKey, JSON.stringify(next));
        return next;
      });
    },
    [recentKey]
  );

  function handleOpenFile(path: string) {
    updateRecent((prev) => [path, ...prev.filter((p) => p !== path)].slice(0, 10));
    onOpenFile(path);
  }

  function handlePathDeleted(path: string) {
    updateRecent((prev) => prev.filter((p) => p !== path && !p.startsWith(path + "/")));
    onPathDeleted(path);
  }

  function handlePathRenamed(oldPath: string, newPath: string) {
    const remap = (p: string) =>
      p === oldPath ? newPath : p.startsWith(oldPath + "/") ? newPath + p.slice(oldPath.length) : p;
    updateRecent((prev) => prev.map(remap));
    onPathRenamed(oldPath, newPath);
  }

  // LEFT-edge resize (200–480px, persisted on mouseup).
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return stored >= PANEL_MIN && stored <= PANEL_MAX ? stored : PANEL_DEFAULT;
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isDragging.current || !panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      const w = Math.min(PANEL_MAX, Math.max(PANEL_MIN, rect.right - e.clientX));
      setWidth(w);
    }
    function handleMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth((w) => {
        localStorage.setItem(PANEL_WIDTH_KEY, String(w));
        return w;
      });
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <div ref={panelRef} className="files-panel" style={{ width }}>
      <div className="files-panel-resize" onMouseDown={handleResizeMouseDown} />

      <PaneHeader
        dot
        dotColor="var(--info)"
        eyebrow="files"
        sub={session ? session.name : undefined}
        actions={
          <>
            <select
              className="files-recent-select"
              value=""
              title="recent files"
              disabled={!session}
              onChange={(e) => {
                if (e.target.value) handleOpenFile(e.target.value);
              }}
            >
              <option value="" disabled style={{ backgroundColor: "var(--panel-3)" }}>
                recent
              </option>
              {recent.map((p) => (
                <option key={p} value={p} style={{ backgroundColor: "var(--panel-3)" }}>
                  {p}
                </option>
              ))}
            </select>
            <IconButton
              name="search"
              size={14}
              label="search files"
              active={query !== null}
              tone="var(--accent)"
              disabled={!session}
              onClick={openSearch}
            />
            <IconButton
              name="refresh"
              size={14}
              label="refresh tree"
              disabled={!session}
              onClick={() => setRefreshNonce((n) => n + 1)}
            />
            <IconButton name="panelRight" size={14} label="close files panel" onClick={onClose} />
          </>
        }
      />

      {session && query !== null && (
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "0 12px 8px",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: 30,
              padding: "0 10px",
              borderRadius: 8,
              background: "var(--panel-3)",
              border: "1px solid var(--border-2)",
            }}
          >
            <Icon name="search" size={13} color="var(--fg-4)" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery(null);
              }}
              placeholder="filter files…"
              spellCheck={false}
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                outline: "none",
                background: "transparent",
                color: "var(--fg)",
                fontFamily: "var(--mono)",
                fontSize: 12,
              }}
            />
            {filterTerm !== "" && (
              <span
                className="mono"
                style={{ flex: "none", fontSize: 10.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}
              >
                {matchCount < 0
                  ? ""
                  : matchCount === 0
                    ? "no matches"
                    : `${matchCount} match${matchCount === 1 ? "" : "es"}`}
              </span>
            )}
            <button
              onClick={() => setQuery(null)}
              title="close search"
              style={{
                flex: "none",
                display: "flex",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: 2,
                color: "var(--fg-4)",
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        </div>
      )}

      {session ? (
        <div className="files-panel-body" style={{ display: "flex", flexDirection: "column" }}>
          {/* Keep the tree mounted (display:none) when nothing matches so its
              loaded subtree state survives clearing the filter. */}
          <div style={{ flex: 1, minHeight: 0, display: noMatches ? "none" : "block" }}>
            <FileTree
              key={session.id}
              sessionId={session.id}
              openPath={activeFilePath}
              dirtyPaths={dirtyPaths}
              refreshNonce={refreshNonce}
              filter={query ?? ""}
              onOpen={handleOpenFile}
              onPathDeleted={handlePathDeleted}
              onPathRenamed={handlePathRenamed}
              onMatchCount={setMatchCount}
              onError={onError}
            />
          </div>
          {noMatches && (
            <div style={{ padding: "8px 16px", fontSize: 12, color: "var(--fg-4)" }}>
              no files match “{filterTerm}”.
            </div>
          )}
        </div>
      ) : (
        <div className="files-empty">open a session to browse its files</div>
      )}
    </div>
  );
}
