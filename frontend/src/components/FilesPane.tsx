import { useCallback, useEffect, useRef, useState } from "react";
import "./FilesPane.css";
import { readFile, writeFile } from "../api";
import { FileTree } from "./FileTree";
import { CodeEditor } from "./CodeEditor";
import { MarkdownView } from "./MarkdownView";
import { ConfirmModal } from "./ConfirmModal";

// Single open file: one-dimensional dirty state (draft vs savedContent).
interface OpenFile {
  path: string;
  savedContent: string;
  draft: string;
  binary: boolean;
  tooLarge: boolean;
}

type PendingAction = { type: "open"; path: string } | { type: "close" };

const TREE_WIDTH_KEY = "quant.files.treeWidth";
const TREE_MIN = 160;
const TREE_MAX = 480;

function isMarkdown(path: string): boolean {
  const p = path.toLowerCase();
  return p.endsWith(".md") || p.endsWith(".markdown");
}

export function FilesPane({ sessionId }: { sessionId: string }) {
  const recentKey = "quant.files.recent." + sessionId;
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [mdMode, setMdMode] = useState<"rendered" | "source">("rendered");
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const list = JSON.parse(localStorage.getItem(recentKey) || "[]");
      return Array.isArray(list) ? list.slice(0, 10) : [];
    } catch {
      return [];
    }
  });
  // Dirty guard: the navigation we'll perform once the user confirms discard.
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const [treeWidth, setTreeWidth] = useState(() => {
    const stored = Number(localStorage.getItem(TREE_WIDTH_KEY));
    return stored >= TREE_MIN && stored <= TREE_MAX ? stored : 220;
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const isDraggingTree = useRef(false);

  const dirty = !!openFile && openFile.draft !== openFile.savedContent;
  const md = !!openFile && isMarkdown(openFile.path);

  useEffect(() => {
    localStorage.setItem(recentKey, JSON.stringify(recent));
  }, [recentKey, recent]);

  // Exit fullscreen on Escape (same pattern as MindmapPane).
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // Tree|content divider drag (160–480px, persisted).
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingTree.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isDraggingTree.current || !bodyRef.current) return;
      const rect = bodyRef.current.getBoundingClientRect();
      const w = Math.min(TREE_MAX, Math.max(TREE_MIN, e.clientX - rect.left));
      setTreeWidth(w);
    }
    function handleMouseUp() {
      if (!isDraggingTree.current) return;
      isDraggingTree.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setTreeWidth((w) => {
        localStorage.setItem(TREE_WIDTH_KEY, String(w));
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

  function pushRecent(path: string) {
    setRecent((prev) => [path, ...prev.filter((p) => p !== path)].slice(0, 10));
  }

  function loadFile(path: string) {
    readFile(sessionId, path)
      .then((r) => {
        setOpenFile({
          path,
          savedContent: r.content,
          draft: r.content,
          binary: r.binary,
          tooLarge: r.tooLarge,
        });
        setMdMode("rendered");
        pushRecent(path);
        setErrorMsg(null);
      })
      .catch((err) => setErrorMsg(String(err)));
  }

  // All opens go through the dirty guard.
  function openPath(path: string) {
    if (openFile && openFile.path === path) return;
    if (dirty) {
      setPending({ type: "open", path });
      return;
    }
    loadFile(path);
  }

  function closeFile() {
    if (dirty) {
      setPending({ type: "close" });
      return;
    }
    setOpenFile(null);
  }

  function confirmPending() {
    const action = pending;
    setPending(null);
    if (!action) return;
    if (action.type === "open") loadFile(action.path);
    else setOpenFile(null);
  }

  function handleSave() {
    if (!openFile || openFile.binary || openFile.tooLarge) return;
    if (openFile.draft === openFile.savedContent) return;
    const { path, draft } = openFile;
    writeFile(sessionId, path, draft)
      .then(() => {
        setOpenFile((prev) =>
          prev && prev.path === path ? { ...prev, savedContent: draft } : prev
        );
        setErrorMsg(null);
      })
      .catch((err) => setErrorMsg(String(err)));
  }

  function handlePathDeleted(path: string) {
    setRecent((prev) => prev.filter((p) => p !== path && !p.startsWith(path + "/")));
    setOpenFile((prev) =>
      prev && (prev.path === path || prev.path.startsWith(path + "/")) ? null : prev
    );
  }

  // Renames keep the draft: the content is intact on disk, only the path moved.
  function handlePathRenamed(oldPath: string, newPath: string) {
    const remap = (p: string) =>
      p === oldPath ? newPath : p.startsWith(oldPath + "/") ? newPath + p.slice(oldPath.length) : p;
    setRecent((prev) => prev.map(remap));
    setOpenFile((prev) => (prev ? { ...prev, path: remap(prev.path) } : prev));
  }

  const onError = useCallback((msg: string) => setErrorMsg(msg), []);

  return (
    <div
      className={"files-pane" + (fullscreen ? " files-pane--fullscreen" : "")}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          handleSave();
        }
      }}
    >
      <div className="files-toolbar">
        <button
          type="button"
          className="files-tool-btn"
          title="refresh tree"
          onClick={() => setRefreshNonce((n) => n + 1)}
        >
          ↻
        </button>
        <select
          className="files-recent-select"
          value=""
          title="recent files"
          onChange={(e) => {
            if (e.target.value) openPath(e.target.value);
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
        {openFile && (
          <span className="files-file-label" title={openFile.path}>
            {openFile.path}
            {dirty && <span className="files-dirty-dot" title="unsaved changes" />}
          </span>
        )}
        <div className="files-tool-spacer" />
        {md && (
          <div className="files-md-toggle">
            <button
              type="button"
              className={mdMode === "rendered" ? "active" : ""}
              onClick={() => setMdMode("rendered")}
            >
              rendered
            </button>
            <button
              type="button"
              className={mdMode === "source" ? "active" : ""}
              onClick={() => setMdMode("source")}
            >
              source
            </button>
          </div>
        )}
        {openFile && (
          <button
            type="button"
            className="files-tool-btn"
            disabled={!dirty}
            title="save (mod-s)"
            onClick={handleSave}
          >
            save
          </button>
        )}
        {openFile && (
          <button type="button" className="files-tool-btn" title="close file" onClick={closeFile}>
            ×
          </button>
        )}
        <button
          type="button"
          className="files-tool-btn"
          title="Fullscreen (Esc to exit)"
          onClick={() => setFullscreen((v) => !v)}
        >
          {fullscreen ? "🗗" : "⛶"}
        </button>
      </div>

      {errorMsg && (
        <div className="files-error" title="dismiss" onClick={() => setErrorMsg(null)}>
          {errorMsg}
        </div>
      )}

      <div ref={bodyRef} className="files-body">
        <div className="files-tree" style={{ width: treeWidth }}>
          <FileTree
            sessionId={sessionId}
            openPath={openFile?.path ?? null}
            dirty={dirty}
            refreshNonce={refreshNonce}
            onOpen={openPath}
            onPathDeleted={handlePathDeleted}
            onPathRenamed={handlePathRenamed}
            onError={onError}
          />
        </div>
        <div className="files-divider" onMouseDown={handleDividerMouseDown} />
        <div className="files-content">
          {!openFile ? (
            <div className="files-empty">select a file from the tree to view or edit it.</div>
          ) : openFile.tooLarge ? (
            <div className="files-empty">file too large to open here (&gt; 2 MiB).</div>
          ) : openFile.binary ? (
            <div className="files-empty">binary file — nothing to display.</div>
          ) : md && mdMode === "rendered" ? (
            // Rendered mode shows the DRAFT so unsaved edits preview live.
            <MarkdownView content={openFile.draft} />
          ) : (
            <CodeEditor
              fileName={openFile.path}
              value={openFile.draft}
              onChange={(v) => setOpenFile((prev) => (prev ? { ...prev, draft: v } : prev))}
              onSave={handleSave}
            />
          )}
        </div>
      </div>

      {pending && (
        <ConfirmModal
          message={`discard unsaved changes to ${openFile?.path}?`}
          confirmLabel="discard"
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
