import { useEffect, useRef, useState } from "react";
import "./FilesPane.css";
import { readFile, readFileBase64, writeFile } from "../api";
import { fileKind, kindHasPreview } from "../fileKind";
import { CodeEditor } from "./CodeEditor";
import { MarkdownView } from "./MarkdownView";
import { ImageView } from "./ImageView";
import { HtmlView } from "./HtmlView";

// One open file tab. Panels stay mounted for every open file tab (App hides
// inactive ones) so drafts and cursor survive tab switches. There is NO dirty
// guard here: discard confirmation lives in App's tab-close path.
interface TextFile {
  type: "text";
  savedContent: string;
  draft: string;
  binary: boolean;
  tooLarge: boolean;
}

interface ImageFile {
  type: "image";
  dataUrl: string;
  size: number;
  tooLarge: boolean;
}

interface Props {
  sessionId: string;
  relPath: string;
  active: boolean;
  onDirtyChange: (dirty: boolean) => void;
}

export function FileTabPanel({ sessionId, relPath, active, onDirtyChange }: Props) {
  const kind = fileKind(relPath);
  const [file, setFile] = useState<TextFile | ImageFile | null>(null);
  const [viewMode, setViewMode] = useState<"preview" | "source">(
    kindHasPreview(kind) ? "preview" : "source"
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const dirty = file?.type === "text" && file.draft !== file.savedContent;
  const editable = file?.type === "text" && !file.binary && !file.tooLarge;

  useEffect(() => {
    if (kind === "image") {
      readFileBase64(sessionId, relPath)
        .then((r) =>
          setFile({
            type: "image",
            dataUrl: `data:${r.mime};base64,${r.contentBase64}`,
            size: r.size,
            tooLarge: r.tooLarge,
          })
        )
        .catch((err) => setErrorMsg(String(err)));
    } else {
      readFile(sessionId, relPath)
        .then((r) =>
          setFile({
            type: "text",
            savedContent: r.content,
            draft: r.content,
            binary: r.binary,
            tooLarge: r.tooLarge,
          })
        )
        .catch((err) => setErrorMsg(String(err)));
    }
  }, [sessionId, relPath, kind]);

  // Mirror dirty up (tab dot + close confirmation live in App).
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  function handleSave() {
    if (!file || file.type !== "text" || file.binary || file.tooLarge) return;
    if (file.draft === file.savedContent) return;
    const draft = file.draft;
    writeFile(sessionId, relPath, draft)
      .then(() => {
        setFile((prev) =>
          prev && prev.type === "text" ? { ...prev, savedContent: draft } : prev
        );
        setErrorMsg(null);
      })
      .catch((err) => setErrorMsg(String(err)));
  }

  // Cmd+S saves the ACTIVE tab only (every open panel stays mounted).
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  function renderContent() {
    if (!file) {
      return <div className="files-empty">{errorMsg ? "failed to load file." : "loading…"}</div>;
    }
    if (file.type === "image") {
      if (file.tooLarge) {
        return <div className="files-empty">image too large to preview (&gt; 10 MiB).</div>;
      }
      return <ImageView src={file.dataUrl} alt={relPath} size={file.size} />;
    }
    if (file.tooLarge) {
      return <div className="files-empty">file too large to open here (&gt; 2 MiB).</div>;
    }
    if (file.binary) {
      return <div className="files-empty">binary file — nothing to display.</div>;
    }
    if (viewMode === "preview") {
      // Previews render the DRAFT so unsaved edits show live.
      if (kind === "svg") {
        return (
          <ImageView
            src={"data:image/svg+xml;utf8," + encodeURIComponent(file.draft)}
            alt={relPath}
            size={file.draft.length}
          />
        );
      }
      if (kind === "html") return <HtmlView content={file.draft} />;
      if (kind === "markdown") return <MarkdownView content={file.draft} />;
    }
    return (
      <CodeEditor
        fileName={relPath}
        value={file.draft}
        onChange={(v) =>
          setFile((prev) => (prev && prev.type === "text" ? { ...prev, draft: v } : prev))
        }
        onSave={handleSave}
      />
    );
  }

  return (
    <div className="files-pane">
      <div className="files-toolbar">
        <span className="files-file-label" title={relPath}>
          {relPath}
          {dirty && <span className="files-dirty-dot" title="unsaved changes" />}
        </span>
        <div className="files-tool-spacer" />
        {kindHasPreview(kind) && (
          <div className="files-md-toggle">
            <button
              type="button"
              className={viewMode === "preview" ? "active" : ""}
              onClick={() => setViewMode("preview")}
            >
              preview
            </button>
            <button
              type="button"
              className={viewMode === "source" ? "active" : ""}
              onClick={() => setViewMode("source")}
            >
              source
            </button>
          </div>
        )}
        {editable && (
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
      </div>

      {errorMsg && (
        <div className="files-error" title="dismiss" onClick={() => setErrorMsg(null)}>
          {errorMsg}
        </div>
      )}

      <div className="files-content">{renderContent()}</div>
    </div>
  );
}
