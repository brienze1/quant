import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffFile } from "../types";
import * as api from "../api";

const LINE_HEIGHT = 20;
const FONT = "'JetBrains Mono', monospace";
const FONT_SIZE = 12;
const GUTTER_W = 48;
const MARKER_W = 14;

interface VisualRow {
  key: string;
  before: { num: number; content: string; type: "context" | "removed" } | null;
  after:  { num: number; content: string; type: "context" | "added"   } | null;
}

interface Hunk {
  oldStart: number;
  newStart: number;
  lines: Array<{ type: "removed" | "added" | "context"; content: string }>;
}

interface Props {
  sessionId: string;
  sessionName: string;
  commitMessagePrefix: string;
  onBack: () => void;
}

function parseHunks(rawDiff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const line of rawDiff.split("\n")) {
    if (line.startsWith("@@")) {
      if (cur) hunks.push(cur);
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) cur = { oldStart: parseInt(m[1], 10), newStart: parseInt(m[2], 10), lines: [] };
    } else if (cur) {
      if      (line.startsWith("-") && !line.startsWith("---")) cur.lines.push({ type: "removed", content: line.slice(1) });
      else if (line.startsWith("+") && !line.startsWith("+++")) cur.lines.push({ type: "added",   content: line.slice(1) });
      else if (line.startsWith(" "))                            cur.lines.push({ type: "context",  content: line.slice(1) });
    }
  }
  if (cur) hunks.push(cur);
  return hunks;
}

function buildVisualRows(beforeLines: string[], afterLines: string[], hunks: Hunk[]): VisualRow[] {
  const rows: VisualRow[] = [];
  let k = 0;
  let b = 0; // next beforeLines index (0-based)
  let a = 0; // next afterLines index (0-based)

  for (const hunk of hunks) {
    const bEnd = hunk.oldStart - 1; // exclusive (0-based)
    const aEnd = hunk.newStart - 1;
    // Context lines before this hunk
    while (b < bEnd && a < aEnd) {
      rows.push({ key: `c${k++}`,
        before: { num: b + 1, content: beforeLines[b] ?? "", type: "context" },
        after:  { num: a + 1, content: afterLines[a]  ?? "", type: "context" },
      });
      b++; a++;
    }
    // Hunk lines
    let bOff = hunk.oldStart - 1;
    let aOff = hunk.newStart - 1;
    let i = 0;
    while (i < hunk.lines.length) {
      if (hunk.lines[i].type === "context") {
        rows.push({ key: `hc${k++}`,
          before: { num: bOff + 1, content: hunk.lines[i].content, type: "context" },
          after:  { num: aOff + 1, content: hunk.lines[i].content, type: "context" },
        });
        bOff++; aOff++; i++;
      } else {
        const removed: typeof hunk.lines = [];
        const added:   typeof hunk.lines = [];
        while (i < hunk.lines.length && hunk.lines[i].type !== "context") {
          if (hunk.lines[i].type === "removed") removed.push(hunk.lines[i]);
          else                                  added.push(hunk.lines[i]);
          i++;
        }
        const max = Math.max(removed.length, added.length);
        for (let j = 0; j < max; j++) {
          const r = removed[j];
          const ad = added[j];
          rows.push({ key: `d${k++}`,
            before: r  ? { num: bOff + j + 1, content: r.content,  type: "removed" } : null,
            after:  ad ? { num: aOff + j + 1, content: ad.content, type: "added"   } : null,
          });
        }
        bOff += removed.length;
        aOff += added.length;
      }
    }
    b = bOff; a = aOff;
  }

  // Trailing context lines
  while (b < beforeLines.length && a < afterLines.length) {
    rows.push({ key: `t${k++}`,
      before: { num: b + 1, content: beforeLines[b], type: "context" },
      after:  { num: a + 1, content: afterLines[a],  type: "context" },
    });
    b++; a++;
  }
  return rows;
}

function statusColor(s: string) {
  switch (s) {
    case "A": return "var(--q-accent)";
    case "D": return "var(--q-error)";
    case "R": return "var(--q-warning)";
    case "?": return "var(--q-fg-secondary)";
    default:  return "var(--q-blue-light)";
  }
}

// Returns [start, end) range in `a` that differs from `b` (common prefix/suffix trimmed).
function findChangedRange(a: string, b: string): [number, number] {
  let s = 0;
  const min = Math.min(a.length, b.length);
  while (s < min && a[s] === b[s]) s++;
  let ae = a.length, be = b.length;
  while (ae > s && be > s && a[ae - 1] === b[be - 1]) { ae--; be--; }
  return [s, ae];
}

// Renders `content` with the [start,end) range highlighted. Text is transparent when used as bg overlay.
function DiffChars({ content, other, highlightBg, transparent }: { content: string; other: string; highlightBg: string; transparent?: boolean }) {
  const [s, e] = findChangedRange(content, other);
  const clr = transparent ? "transparent" : undefined;
  if (s >= e) return <>{content}</>;
  return (
    <>
      <span style={{ color: clr }}>{content.slice(0, s)}</span>
      <span style={{ backgroundColor: highlightBg, color: clr, borderRadius: 2 }}>{content.slice(s, e)}</span>
      <span style={{ color: clr }}>{content.slice(e)}</span>
    </>
  );
}

export function DiffView({ sessionId, sessionName, commitMessagePrefix, onBack }: Props) {
  const [files, setFiles]             = useState<DiffFile[]>([]);
  const [checkedPaths, setCheckedPaths] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<DiffFile | null>(null);

  const [rawDiff,       setRawDiff]       = useState("");
  const [beforeContent, setBeforeContent] = useState("");
  const [currentContent, setCurrentContent] = useState("");

  const prefix = commitMessagePrefix.replace(/\{session\}/g, sessionName);
  const [commitMessage, setCommitMessage] = useState("");
  const [pushAfter,  setPushAfter]  = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState("");

  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingDiff,  setLoadingDiff]  = useState(false);

  const [sidebarWidth,   setSidebarWidth]   = useState(280);
  const [fileListFlex,   setFileListFlex]   = useState(0.6);
  const [beforePanelFlex, setBeforePanelFlex] = useState(0.5);

  const sidebarRef       = useRef<HTMLDivElement>(null);
  const diffAreaRef      = useRef<HTMLDivElement>(null);
  const beforeScrollRef  = useRef<HTMLDivElement>(null);
  const afterTextareaRef = useRef<HTMLTextAreaElement>(null);
  const afterGutterRef   = useRef<HTMLDivElement>(null);
  const afterBgRef       = useRef<HTMLDivElement>(null);
  const saveTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncing        = useRef(false);

  // ── Derived ──────────────────────────────────────────────────────────────

  const beforeLines  = useMemo(() => beforeContent  ? beforeContent.split("\n")  : [], [beforeContent]);
  const afterLines   = useMemo(() => currentContent ? currentContent.split("\n") : [], [currentContent]);
  const hunks        = useMemo(() => parseHunks(rawDiff), [rawDiff]);
  const visualRows   = useMemo(() => buildVisualRows(beforeLines, afterLines, hunks), [beforeLines, afterLines, hunks]);

  const diffCount = useMemo(() => visualRows.filter(
    r => r.before?.type === "removed" || r.after?.type === "added"
  ).length, [visualRows]);

  // Scroll-sync maps:
  // textareaToVisualRow[tLine] = visual row index for textarea line tLine
  // visualToTextareaLine[vRow] = textarea line index (null = spacer row)
  const { t2v, v2t, numAfterSpacers } = useMemo(() => {
    const t2v: number[]          = [];
    const v2t: (number | null)[] = [];
    let tLine = 0, spacers = 0;
    for (let v = 0; v < visualRows.length; v++) {
      if (visualRows[v].after !== null) {
        t2v.push(v);
        v2t.push(tLine++);
      } else {
        v2t.push(null);
        spacers++;
      }
    }
    return { t2v, v2t, numAfterSpacers: spacers };
  }, [visualRows]);

  // ── Scroll sync ──────────────────────────────────────────────────────────

  function syncFromAfter(scrollTop: number, scrollLeft: number) {
    if (isSyncing.current) return;
    isSyncing.current = true;
    const tLine = Math.floor(scrollTop / LINE_HEIGHT);
    const offset = scrollTop % LINE_HEIGHT;
    const vRow = t2v[Math.min(tLine, t2v.length - 1)] ?? 0;
    const visualTop = vRow * LINE_HEIGHT + offset;
    if (afterGutterRef.current)  afterGutterRef.current.scrollTop  = visualTop;
    if (afterBgRef.current)    { afterBgRef.current.scrollTop = visualTop; afterBgRef.current.scrollLeft = scrollLeft; }
    if (beforeScrollRef.current) { beforeScrollRef.current.scrollTop = visualTop; beforeScrollRef.current.scrollLeft = scrollLeft; }
    requestAnimationFrame(() => { isSyncing.current = false; });
  }

  function syncFromBefore(scrollTop: number, scrollLeft: number) {
    if (isSyncing.current) return;
    isSyncing.current = true;
    const vRow = Math.min(Math.floor(scrollTop / LINE_HEIGHT), v2t.length - 1);
    const offset = scrollTop % LINE_HEIGHT;
    let tLine = v2t[vRow];
    if (tLine === null) {
      for (let v = vRow + 1; v < v2t.length; v++) {
        if (v2t[v] !== null) { tLine = v2t[v]; break; }
      }
    }
    const textareaTop = tLine !== null ? tLine * LINE_HEIGHT + offset : 0;
    if (afterTextareaRef.current) { afterTextareaRef.current.scrollTop = textareaTop; afterTextareaRef.current.scrollLeft = scrollLeft; }
    if (afterGutterRef.current)  afterGutterRef.current.scrollTop  = scrollTop;
    if (afterBgRef.current)    { afterBgRef.current.scrollTop = scrollTop; afterBgRef.current.scrollLeft = scrollLeft; }
    requestAnimationFrame(() => { isSyncing.current = false; });
  }

  // ── Load files ────────────────────────────────────────────────────────────

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const list = await api.gitDiffFiles(sessionId);
      setFiles(list ?? []);
      setCheckedPaths(new Set((list ?? []).map(f => f.path)));
      if (list?.length) setSelectedFile(list[0]);
    } catch (err) { console.error(err); }
    finally { setLoadingFiles(false); }
  }, [sessionId]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  useEffect(() => {
    const id = "diff-scroll-style";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      .diff-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
      .diff-scroll::-webkit-scrollbar-track { background: transparent; }
      .diff-scroll::-webkit-scrollbar-thumb { background: var(--q-border); border-radius: 3px; }
      .diff-scroll::-webkit-scrollbar-thumb:hover { background: var(--q-fg-muted); }
      .diff-scroll::-webkit-scrollbar-corner { background: var(--q-bg); }
    `;
    document.head.appendChild(s);
  }, []);

  // ── Load diff for selected file ───────────────────────────────────────────

  useEffect(() => {
    if (!selectedFile) { setRawDiff(""); setBeforeContent(""); setCurrentContent(""); return; }
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    let cancelled = false;
    setLoadingDiff(true);
    (async () => {
      try {
        const [diff, current, before] = await Promise.all([
          api.gitDiffFile(sessionId, selectedFile.path),
          api.gitGetFileContent(sessionId, selectedFile.path, "current"),
          api.gitGetFileContent(sessionId, selectedFile.path, "head"),
        ]);
        if (cancelled) return;
        setRawDiff(diff); setCurrentContent(current); setBeforeContent(before);
      } catch (err) { console.error(err); }
      finally { if (!cancelled) setLoadingDiff(false); }
    })();
    return () => { cancelled = true; };
  }, [sessionId, selectedFile]);

  // ── Editing ───────────────────────────────────────────────────────────────

  function handleContentChange(value: string) {
    setCurrentContent(value);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!selectedFile) return;
    const filePath = selectedFile.path;
    saveTimerRef.current = setTimeout(async () => {
      try {
        await api.gitSaveFileContent(sessionId, filePath, value);
        setRawDiff(await api.gitDiffFile(sessionId, filePath));
      } catch (err) { console.error(err); }
    }, 600);
  }

  // ── Checkboxes ────────────────────────────────────────────────────────────

  const allChecked  = files.length > 0 && checkedPaths.size === files.length;
  const someChecked = checkedPaths.size > 0 && !allChecked;

  function toggleAll() { allChecked ? setCheckedPaths(new Set()) : setCheckedPaths(new Set(files.map(f => f.path))); }
  function toggleFile(path: string) {
    setCheckedPaths(prev => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n; });
  }

  // ── Commit ────────────────────────────────────────────────────────────────

  async function handleCommit() {
    const msg = (prefix + commitMessage).trim();
    if (!msg || checkedPaths.size === 0) return;
    setCommitError(""); setCommitting(true);
    try {
      await api.gitCommitFiles(sessionId, msg, files.filter(f => checkedPaths.has(f.path)).map(f => f.path));
      if (pushAfter) await api.gitPush(sessionId);
      onBack();
    } catch (err: unknown) {
      setCommitError((err instanceof Error ? err.message : String(err)).replace(/^.*?: /, ""));
    } finally { setCommitting(false); }
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  function onSidebarResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX, startW = sidebarWidth;
    const move = (ev: MouseEvent) => setSidebarWidth(Math.min(500, Math.max(200, startW + ev.clientX - startX)));
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  }

  function onFileListResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY, startF = fileListFlex, h = sidebarRef.current?.clientHeight ?? 900;
    const move = (ev: MouseEvent) => setFileListFlex(Math.min(0.85, Math.max(0.15, startF + (ev.clientY - startY) / h)));
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  }

  function onBeforeResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX, startF = beforePanelFlex, w = diffAreaRef.current?.clientWidth ?? 1000;
    const move = (ev: MouseEvent) => setBeforePanelFlex(Math.min(0.85, Math.max(0.15, startF + (ev.clientX - startX) / w)));
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ backgroundColor: "var(--q-bg)", fontFamily: FONT }}>

      {/* ── SIDEBAR ───────────────────────────────────────────────────────── */}
      <div ref={sidebarRef} className="flex flex-col h-full relative"
        style={{ width: sidebarWidth, minWidth: sidebarWidth, borderRight: "1px solid var(--q-border)" }}>

        <button onClick={onBack} className="flex items-center gap-2 px-4 w-full text-left flex-shrink-0"
          style={{ height: 48, borderBottom: "1px solid var(--q-border)", backgroundColor: "transparent" }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = "var(--q-bg-hover)"}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--q-fg-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
          </svg>
          <span style={{ color: "var(--q-fg)", fontSize: 13, fontWeight: 700 }}>&gt; git diff</span>
        </button>

        <div className="flex items-center gap-2 px-4 flex-shrink-0"
          style={{ height: 32, borderBottom: "1px solid var(--q-border)", cursor: "pointer" }} onClick={toggleAll}>
          <div style={{ width: 14, height: 14, backgroundColor: "var(--q-bg)", border: `1px solid ${allChecked || someChecked ? "var(--q-accent)" : "var(--q-fg-secondary)"}`, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {allChecked  && <span style={{ color: "var(--q-accent)", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>x</span>}
            {someChecked && <span style={{ color: "var(--q-accent)", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>−</span>}
          </div>
          <span style={{ color: "var(--q-fg-secondary)", fontSize: 11 }}>{loadingFiles ? "loading..." : `${checkedPaths.size} of ${files.length} files`}</span>
        </div>

        <div className="overflow-y-auto flex-shrink-0" style={{ height: `calc(${fileListFlex * 100}% - 86px)` }}>
          {files.map(file => {
            const isSelected = selectedFile?.path === file.path;
            const isChecked = checkedPaths.has(file.path);
            return (
              <div key={file.path} className="flex items-center gap-2 px-3"
                style={{ height: 32, cursor: "pointer", backgroundColor: isSelected ? "var(--q-bg-hover)" : "transparent", borderBottom: "1px solid var(--q-bg-surface)" }}
                onClick={() => setSelectedFile(file)}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = "var(--q-bg-menu)"; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = "transparent"; }}>
                <div style={{ width: 14, height: 14, backgroundColor: "var(--q-bg)", border: `1px solid ${isChecked ? "var(--q-accent)" : "var(--q-fg-secondary)"}`, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                  onClick={e => { e.stopPropagation(); toggleFile(file.path); }}>
                  {isChecked && <span style={{ color: "var(--q-accent)", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>x</span>}
                </div>
                <span style={{ color: statusColor(file.status), fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{file.status}</span>
                <span style={{ color: isSelected ? "var(--q-fg)" : "var(--q-fg-tertiary)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={file.path}>{file.path}</span>
              </div>
            );
          })}
          {!loadingFiles && files.length === 0 && (
            <div className="flex items-center justify-center h-16"><span style={{ color: "var(--q-fg-muted)", fontSize: 11 }}>no changes</span></div>
          )}
        </div>

        <div style={{ height: 6, cursor: "row-resize", backgroundColor: "var(--q-bg)", borderTop: "1px solid var(--q-border)", borderBottom: "1px solid var(--q-border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          onMouseDown={onFileListResizeStart}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = "var(--q-bg-hover)"}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = "var(--q-bg)"}>
          <div style={{ width: 32, height: 2, borderRadius: 1, backgroundColor: "var(--q-fg-muted)" }} />
        </div>

        <div className="flex flex-col gap-3 p-3 overflow-y-auto" style={{ flex: 1, minHeight: 0 }}>
          <label style={{ color: "var(--q-fg-secondary)", fontSize: 10 }}>// commit message</label>
          {prefix && <div className="px-2 py-1" style={{ color: "var(--q-fg-secondary)", fontSize: 10, backgroundColor: "var(--q-bg-hover)", border: "1px solid var(--q-border)" }}>{prefix}</div>}
          <textarea value={commitMessage} onChange={e => setCommitMessage(e.target.value)}
            placeholder="describe your changes..." rows={4}
            style={{ backgroundColor: "var(--q-bg-hover)", border: "1px solid var(--q-border)", color: "var(--q-fg)", fontFamily: FONT, fontSize: 11, padding: "6px 8px", resize: "none", outline: "none", width: "100%", boxSizing: "border-box" }}
            onFocus={e => e.currentTarget.style.borderColor = "var(--q-accent)"}
            onBlur={e => e.currentTarget.style.borderColor = "var(--q-border)"} />
          <div className="flex items-center gap-2 cursor-pointer" style={{ color: "var(--q-fg-secondary)", fontSize: 11 }} onClick={() => setPushAfter(v => !v)}>
            <div style={{ width: 14, height: 14, backgroundColor: "var(--q-bg)", border: `1px solid ${pushAfter ? "var(--q-accent)" : "var(--q-fg-secondary)"}`, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {pushAfter && <span style={{ color: "var(--q-accent)", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>x</span>}
            </div>
            push after commit
          </div>
          {commitError && <div className="px-2 py-2" style={{ fontSize: 10, backgroundColor: "var(--q-bg-hover)", border: "1px solid var(--q-error)", color: "var(--q-error)" }}>{commitError}</div>}
          <button disabled={committing || !(prefix + commitMessage).trim() || checkedPaths.size === 0} onClick={handleCommit}
            style={{ width: "100%", padding: "8px 0", fontSize: 12, fontFamily: FONT, fontWeight: 600,
              backgroundColor: (prefix + commitMessage).trim() && checkedPaths.size > 0 && !committing ? "var(--q-accent)" : "var(--q-bg-hover)",
              color: (prefix + commitMessage).trim() && checkedPaths.size > 0 && !committing ? "var(--q-bg)" : "var(--q-fg-muted)",
              border: "none", cursor: "pointer", outline: "none" }}>
            {committing ? "..." : `commit${pushAfter ? " & push" : ""}`}
          </button>
        </div>

        <div style={{ position: "absolute", top: 0, right: -3, width: 6, height: "100%", cursor: "col-resize", zIndex: 10 }} onMouseDown={onSidebarResizeStart} />
      </div>

      {/* ── DIFF CONTENT ──────────────────────────────────────────────────── */}
      <div ref={diffAreaRef} className="flex flex-col flex-1 min-w-0 overflow-hidden">

        <div className="flex items-center gap-3 px-4 flex-shrink-0"
          style={{ height: 40, borderBottom: "1px solid var(--q-border)", backgroundColor: "var(--q-bg-subtle)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--q-fg-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
          </svg>
          <span style={{ color: "var(--q-fg)", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selectedFile ? selectedFile.path : "select a file"}
          </span>
          {selectedFile && diffCount > 0 && (
            <span style={{ fontSize: 10, color: "var(--q-accent)", backgroundColor: "var(--q-accent-bg-faint)", border: "1px solid var(--q-accent)", padding: "1px 8px", flexShrink: 0 }}>
              {diffCount} {diffCount === 1 ? "change" : "changes"}
            </span>
          )}
        </div>

        {selectedFile ? (
          <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* ── BEFORE panel (full HEAD content, spacers for added blocks) ── */}
            <div className="flex flex-col overflow-hidden" style={{ flex: beforePanelFlex, minWidth: 0, borderRight: "1px solid var(--q-border)" }}>
              <div className="flex items-center gap-2 px-4 flex-shrink-0"
                style={{ height: 32, borderBottom: "1px solid var(--q-border)", backgroundColor: "var(--q-bg-subtle)" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--q-error)" }} />
                <span style={{ color: "var(--q-fg-secondary)", fontSize: 11 }}>before</span>
              </div>
              <div ref={beforeScrollRef} className="flex-1 overflow-auto diff-scroll"
                style={{ backgroundColor: "var(--q-bg)" }}
                onScroll={e => syncFromBefore(e.currentTarget.scrollTop, e.currentTarget.scrollLeft)}>
                {loadingDiff ? (
                  <div className="flex items-center justify-center h-full"><span style={{ color: "var(--q-fg-muted)", fontSize: 11 }}>loading...</span></div>
                ) : visualRows.length > 0 ? (
                  <div style={{ minWidth: "max-content" }}>
                    {visualRows.map(row => {
                      const cell = row.before;
                      const isSpacer = cell === null;
                      const isChanged = !isSpacer && cell.type === "removed" && row.after !== null;
                      const isRemoved = !isSpacer && cell.type === "removed" && row.after === null;
                      const bg     = isSpacer ? "var(--q-bg-elevated)" : isChanged ? "var(--q-diff-changed-bg)" : isRemoved ? "var(--q-diff-removed-bg)" : "transparent";
                      const numClr = isChanged ? "var(--q-blue-bright)" : isRemoved ? "var(--q-diff-removed-gutter)" : "var(--q-fg-muted)";
                      const mrkClr = isChanged ? "var(--q-blue-light)" : isRemoved ? "var(--q-error)" : "transparent";
                      const mrkSym = isChanged ? "~" : isRemoved ? "−" : " ";
                      const txtClr = isRemoved ? "var(--q-diff-removed-text)" : "var(--q-fg-tertiary)";
                      return (
                        <div key={row.key} style={{ display: "flex", height: LINE_HEIGHT, backgroundColor: bg }}>
                          <span style={{ width: GUTTER_W, minWidth: GUTTER_W, paddingRight: 8, textAlign: "right", color: numClr, fontSize: 11, fontFamily: FONT, lineHeight: `${LINE_HEIGHT}px`, userSelect: "none", borderRight: "1px solid var(--q-bg-surface)", flexShrink: 0 }}>
                            {isSpacer ? "" : cell.num}
                          </span>
                          <span style={{ width: MARKER_W, minWidth: MARKER_W, textAlign: "center", color: mrkClr, fontSize: 11, fontFamily: FONT, lineHeight: `${LINE_HEIGHT}px`, userSelect: "none", flexShrink: 0 }}>
                            {mrkSym}
                          </span>
                          {!isSpacer && (
                            <div style={{ margin: 0, padding: "0 8px", color: txtClr, fontSize: FONT_SIZE, lineHeight: `${LINE_HEIGHT}px`, fontFamily: FONT, whiteSpace: "pre", flex: 1, overflow: "hidden" }}>
                              {isChanged
                                ? <DiffChars content={cell.content} other={row.after!.content} highlightBg="var(--q-diff-char-highlight)" />
                                : cell.content}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full"><span style={{ color: "var(--q-fg-muted)", fontSize: 11 }}>new file</span></div>
                )}
              </div>
            </div>

            {/* Panel resize */}
            <div style={{ width: 6, cursor: "col-resize", backgroundColor: "var(--q-bg)", borderLeft: "1px solid var(--q-border)", borderRight: "1px solid var(--q-border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
              onMouseDown={onBeforeResizeStart}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = "var(--q-bg-hover)"}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = "var(--q-bg)"}>
              <div style={{ width: 2, height: 32, borderRadius: 1, backgroundColor: "var(--q-fg-muted)" }} />
            </div>

            {/* ── AFTER panel (editable textarea + aligned gutter/bg) ─────── */}
            <div className="flex flex-col overflow-hidden" style={{ flex: 1 - beforePanelFlex, minWidth: 0, position: "relative" }}>
              <div className="flex items-center gap-2 px-4 flex-shrink-0"
                style={{ height: 32, borderBottom: "1px solid var(--q-border)", backgroundColor: "var(--q-bg-subtle)" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--q-accent)" }} />
                <span style={{ color: "var(--q-fg)", fontSize: 11, fontWeight: 500 }}>current version</span>
                <span style={{ marginLeft: "auto", color: "var(--q-fg-muted)", fontSize: 10 }}>editable</span>
              </div>

              {loadingDiff ? (
                <div className="flex flex-1 items-center justify-center"><span style={{ color: "var(--q-fg-muted)", fontSize: 11 }}>loading...</span></div>
              ) : (
                <div className="flex flex-1 min-h-0 overflow-hidden" style={{ position: "relative", backgroundColor: "var(--q-bg)" }}>

                  {/* Gutter: line numbers + spacers, synced via scrollTop */}
                  <div ref={afterGutterRef}
                    style={{ width: GUTTER_W + MARKER_W, minWidth: GUTTER_W + MARKER_W, overflow: "hidden", borderRight: "1px solid var(--q-bg-surface)", flexShrink: 0, backgroundColor: "var(--q-bg)" }}>
                    {visualRows.map(row => {
                      const cell = row.after;
                      const isSpacer = cell === null;
                      const isChanged = !isSpacer && cell.type === "added" && row.before !== null;
                      const isAdded   = !isSpacer && cell.type === "added" && row.before === null;
                      const gutterBg  = isSpacer ? "var(--q-bg-elevated)" : "transparent";
                      const numClr    = isChanged ? "var(--q-blue-bright)" : isAdded ? "var(--q-accent-hover)" : "var(--q-fg-muted)";
                      const mrkClr    = isChanged ? "var(--q-blue-light)" : isAdded ? "var(--q-accent)" : "transparent";
                      const mrkSym    = isChanged ? "~" : isAdded ? "+" : " ";
                      return (
                        <div key={row.key} style={{ display: "flex", height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px`, backgroundColor: gutterBg }}>
                          <span style={{ flex: 1, textAlign: "right", paddingRight: 6, color: numClr, fontSize: 11, fontFamily: FONT, userSelect: "none" }}>
                            {isSpacer ? "" : cell.num}
                          </span>
                          <span style={{ width: MARKER_W, textAlign: "center", color: mrkClr, fontSize: 11, fontFamily: FONT, userSelect: "none" }}>
                            {mrkSym}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Code area */}
                  <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

                    {/* Background highlights + spacers, synced via scrollTop */}
                    <div ref={afterBgRef}
                      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0, minWidth: "max-content" }}>
                      {visualRows.map(row => {
                        const cell = row.after;
                        const isSpacer  = cell === null;
                        const isChanged = !isSpacer && cell.type === "added" && row.before !== null;
                        const isAdded   = !isSpacer && cell.type === "added" && row.before === null;
                        const bg = isSpacer ? "var(--q-bg-elevated)" : isChanged ? "var(--q-diff-changed-bg)" : isAdded ? "var(--q-accent-bg-faint)" : "transparent";
                        return (
                          <div key={row.key} style={{ height: LINE_HEIGHT, backgroundColor: bg, position: isChanged ? "relative" : undefined }}>
                            {isChanged && (
                              <div style={{ position: "absolute", top: 0, left: 8, right: 0, bottom: 0, fontFamily: FONT, fontSize: FONT_SIZE, whiteSpace: "pre", lineHeight: `${LINE_HEIGHT}px`, pointerEvents: "none" }}>
                                <DiffChars content={cell!.content} other={row.before!.content} highlightBg="var(--q-diff-char-highlight)" transparent />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Textarea: raw content without spacers.
                        padding-bottom extends scroll range to match visual row height. */}
                    <textarea
                      ref={afterTextareaRef}
                      value={currentContent}
                      onChange={e => handleContentChange(e.target.value)}
                      spellCheck={false}
                      wrap="off"
                      className="diff-scroll"
                      style={{
                        position: "absolute", inset: 0,
                        width: "100%", height: "100%",
                        backgroundColor: "transparent",
                        color: "var(--q-fg-tertiary)",
                        fontFamily: FONT, fontSize: FONT_SIZE,
                        lineHeight: `${LINE_HEIGHT}px`,
                        padding: `0 8px ${numAfterSpacers * LINE_HEIGHT}px 8px`,
                        border: "none", outline: "none", resize: "none",
                        boxSizing: "border-box",
                        tabSize: 2,
                        zIndex: 1,
                        caretColor: "var(--q-accent)",
                        overflowX: "auto",
                        whiteSpace: "pre",
                      }}
                      onScroll={e => syncFromAfter(e.currentTarget.scrollTop, e.currentTarget.scrollLeft)}
                    />
                  </div>
                </div>
              )}

              {/* ── Scroll indicator strip (IntelliJ-style change map) ── */}
              {visualRows.length > 0 && (
                <div style={{ position: "absolute", top: 32, right: 0, bottom: 0, width: 7, backgroundColor: "var(--q-bg-subtle)", zIndex: 30, pointerEvents: "none" }}>
                  {visualRows.map((row, i) => {
                    const isChanged = row.before !== null && row.after !== null && row.before.type !== "context";
                    const isAdded   = row.before === null && row.after !== null;
                    const isRemoved = row.before !== null && row.after === null && row.before.type === "removed";
                    if (!isChanged && !isAdded && !isRemoved) return null;
                    const color = isChanged ? "var(--q-blue)" : isAdded ? "var(--q-accent)" : "var(--q-error)";
                    const pct = (i / visualRows.length) * 100;
                    const h = Math.max(2, 100 / visualRows.length);
                    return <div key={row.key} style={{ position: "absolute", top: `${pct}%`, height: `${h}%`, minHeight: 2, left: 1, right: 1, backgroundColor: color, borderRadius: 1 }} />;
                  })}
                </div>
              )}
            </div>

          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <span style={{ color: "var(--q-fg-muted)", fontSize: 12 }}>
              {loadingFiles ? "loading changes..." : files.length === 0 ? "no changes detected" : "select a file to view its diff"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
