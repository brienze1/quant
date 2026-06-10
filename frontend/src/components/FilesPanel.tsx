import { useCallback, useEffect, useRef, useState } from "react";
import "./FilesPane.css";
import type { Session } from "../types";
import { FileTree } from "./FileTree";

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

      <div className="files-panel-header">
        <span className="files-panel-label">// files</span>
        {session && (
          <span className="files-panel-session" title={session.name}>
            {session.name}
          </span>
        )}
        <div className="files-tool-spacer" />
        <button
          type="button"
          className="files-tool-btn"
          title="refresh tree"
          disabled={!session}
          onClick={() => setRefreshNonce((n) => n + 1)}
        >
          ↻
        </button>
        <select
          className="files-recent-select"
          value=""
          title="recent files"
          disabled={!session}
          onChange={(e) => {
            if (e.target.value) handleOpenFile(e.target.value);
          }}
        >
          <option value="" disabled style={{ backgroundColor: "var(--q-bg)" }}>
            recent
          </option>
          {recent.map((p) => (
            <option key={p} value={p} style={{ backgroundColor: "var(--q-bg)" }}>
              {p}
            </option>
          ))}
        </select>
        <button type="button" className="files-tool-btn" title="close files panel" onClick={onClose}>
          »
        </button>
      </div>

      {session ? (
        <div className="files-panel-body">
          <FileTree
            key={session.id}
            sessionId={session.id}
            openPath={activeFilePath}
            dirtyPaths={dirtyPaths}
            refreshNonce={refreshNonce}
            onOpen={handleOpenFile}
            onPathDeleted={handlePathDeleted}
            onPathRenamed={handlePathRenamed}
            onError={onError}
          />
        </div>
      ) : (
        <div className="files-empty">open a session to browse its files</div>
      )}
    </div>
  );
}
