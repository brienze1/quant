import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session, Config } from "../types";
import {
  DockTree,
  WidthHandle,
  reconcileTree,
  removeKey,
  insertBeside,
  insertRoot,
  setNodeWeights,
  ensureIds,
  keysOf,
  leaf,
  clamp,
  type DockNode,
  type DockZone,
  type DragHandle,
} from "../dock/DockTree";
import { PaneHeader } from "./PaneHeader";
import { IconButton } from "./IconButton";
import { FilesPanel } from "./FilesPanel";
import { TerminalPane } from "./TerminalPane";
import { MindmapPane } from "./MindmapPane";
import { VoicePane } from "./VoicePane";
import { FileTabPanel } from "./FileTabPanel";
import { CrewPane } from "./CrewPane";
import { CrewSessionPanel } from "./CrewSessionPanel";

/* ============================================================
   SessionDock — the right-hand drag-tileable dock.

   Hosts up to four secondary panes (files, terminal, mindmap,
   voice) as drag-and-drop tiles. The HEAVY panes (TerminalPane
   xterm, VoicePane audio/voice-bridge) MUST keep their React
   identity across re-tiles, so each pane is mounted EXACTLY ONCE
   here (stable parent, stable key) and createPortal'd into the
   DockTree leaf's [data-leaf-key] container. Re-tiling moves only
   the portal's DOM target; the pane instances never unmount.

   Tree + width are persisted per active session in localStorage.
   ============================================================ */

export type DockLeafKey = "files" | "terminal" | "mindmap" | "voice" | "crew";

/** A file tab detached from the center strip into the dock. Its dock leaf key
 *  is the file-tab id itself (always prefixed "file:"), so it can't collide
 *  with the fixed leaf keys above. */
export interface DetachedFile {
  key: string;
  sessionId: string;
  relPath: string;
}

/** A crew worker detached from the crew pane into its own dock panel. The
 *  leaf key is "crewSession:<workerSessionId>" (same dynamic-leaf mechanism
 *  as detached files: App pushes the key into `present`, we render it). */
export interface DetachedCrewWorker {
  key: string;
  session: Session;
}

const TREE_KEY = "quant.dockTree.";
const WIDTH_KEY = "quant.dockWidth.";
const DEFAULT_WIDTH = 460;
const MIN_WIDTH = 280;
/** dock may not exceed this fraction of the window width */
const MAX_WIDTH_FRAC = 0.6;

const dockWidthMax = () => Math.round(window.innerWidth * MAX_WIDTH_FRAC);

/** Build the default tree for a present set: panes stacked in a column. */
function defaultTree(present: string[]): DockNode | null {
  if (present.length === 0) return null;
  let t: DockNode = leaf(present[0]);
  for (let i = 1; i < present.length; i++) t = insertRoot(t, present[i], "col", false);
  return ensureIds(t);
}

function loadTree(sessionId: string, present: string[]): DockNode | null {
  try {
    const raw = localStorage.getItem(TREE_KEY + sessionId);
    if (raw) {
      const parsed = JSON.parse(raw) as DockNode;
      // Reconcile the stored tree against what's actually present now.
      return reconcileTree(parsed, present);
    }
  } catch {
    /* corrupt entry → fall through to default */
  }
  return defaultTree(present);
}

function loadWidth(sessionId: string): number {
  const v = Number(localStorage.getItem(WIDTH_KEY + sessionId));
  if (Number.isFinite(v) && v >= MIN_WIDTH) return clamp(v, MIN_WIDTH, dockWidthMax());
  return DEFAULT_WIDTH;
}

/** Fired after every re-tile / resize so panes that self-fit via ResizeObserver
 *  (xterm, mindmap fitView) settle immediately rather than on the next frame. */
function nudgePanes() {
  // Let the DOM reflow first, then ping.
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("terminal:refit"));
    window.dispatchEvent(new Event("mindmap:fit"));
  });
}

export interface SessionDockProps {
  /** the currently-active session — drives tree persistence + mindmap target */
  activeSession: Session | null;
  /** which leaves are currently open for the active session — the fixed pane
   *  keys (DockLeafKey) plus any detached file-tab ids ("file:…") */
  present: string[];

  /* ---- files leaf ---- */
  filesSession: Session | null;
  filesActiveFilePath: string | null;
  filesDirtyPaths: ReadonlySet<string>;
  onFilesOpenFile: (path: string) => void;
  onFilesPathDeleted: (path: string) => void;
  onFilesPathRenamed: (oldPath: string, newPath: string) => void;
  onFilesClose: () => void;
  onFilesError: (msg: string) => void;

  /* ---- terminal leaf (embedded terminal session) ---- */
  terminalSession: Session | null;
  termConfig: Config | null;
  onStart: (id: string, rows: number, cols: number) => void;
  onResume: (id: string, rows: number, cols: number) => void;
  onTerminalClose: () => void;

  /* ---- mindmap leaf ---- */
  mindmapSessionId: string | null;
  onMindmapClose: () => void;

  /* ---- voice leaf ---- */
  voiceSessionId: string | null;
  voiceSessionName: string;
  voiceIsActiveTab: boolean;
  onVoiceClose: () => void;

  /* ---- detached file leaves ("file:…") ---- */
  detachedFiles: DetachedFile[];
  onFileDirtyChange: (key: string, dirty: boolean) => void;
  onReattachFile: (key: string) => void;
  onCloseDetachedFile: (key: string) => void;

  /* ---- crew leaf + detached worker leaves ("crewSession:…") ---- */
  /** supervisor the crew pane targets (the active claude session), or null */
  crewSupervisor: Session | null;
  crewWorkers: Session[];
  crewQueuedCount: number;
  onCrewClose: () => void;
  onCrewSelectSession: (id: string) => void;
  onCrewDetachWorker: (id: string) => void;
  onCrewError: (msg: string) => void;
  detachedCrewWorkers: DetachedCrewWorker[];
  onCloseDetachedCrewWorker: (key: string) => void;
}

/* Marks the pane header as the drag grip. The DockTree drag is forwarded from
   the leaf SLOT via DOM event bubbling (see getSlotRef) — pointerdown on any
   element carrying data-dock-grip starts the tile drag. Spreading this onto
   PaneHeader also makes it render the grip glyph + grab cursor. */
const GRIP_PROPS: React.HTMLAttributes<HTMLDivElement> = { "data-dock-grip": "" } as React.HTMLAttributes<HTMLDivElement>;

/* Pane chrome: grip header + close. */
function PaneShell({
  eyebrow,
  dotColor,
  sub,
  onClose,
  closeLabel,
  leadingActions,
  children,
}: {
  eyebrow: string;
  dotColor: string;
  sub?: string;
  onClose: () => void;
  closeLabel: string;
  /** extra header actions rendered left of the close button (e.g. reattach) */
  leadingActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="panel"
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <PaneHeader
        dot
        dotColor={dotColor}
        eyebrow={eyebrow}
        sub={sub}
        grip={GRIP_PROPS}
        actions={
          <>
            {leadingActions}
            <IconButton name="x" size={13} label={closeLabel} onClick={onClose} />
          </>
        }
      />
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}

export function SessionDock(props: SessionDockProps) {
  const {
    activeSession,
    present,
    filesSession,
    filesActiveFilePath,
    filesDirtyPaths,
    onFilesOpenFile,
    onFilesPathDeleted,
    onFilesPathRenamed,
    onFilesClose,
    onFilesError,
    terminalSession,
    termConfig,
    onStart,
    onResume,
    onTerminalClose,
    mindmapSessionId,
    onMindmapClose,
    voiceSessionId,
    voiceSessionName,
    voiceIsActiveTab,
    onVoiceClose,
    detachedFiles,
    onFileDirtyChange,
    onReattachFile,
    onCloseDetachedFile,
    crewSupervisor,
    crewWorkers,
    crewQueuedCount,
    onCrewClose,
    onCrewSelectSession,
    onCrewDetachWorker,
    onCrewError,
    detachedCrewWorkers,
    onCloseDetachedCrewWorker,
  } = props;

  // The dock's persistence/identity is keyed to the active session when there is
  // one. When there is NO active session (e.g. a file tab is the active tab, or
  // voice is pinned to a background session), fall back to the files-panel
  // session or the pinned voice session so files/voice still render and the tree
  // persists under a stable key.
  const sessionId = activeSession?.id ?? filesSession?.id ?? voiceSessionId ?? null;

  // --- tree + width state, hydrated per active session -----------------------
  const [tree, setTree] = useState<DockNode | null>(null);
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);

  // Track the last session we hydrated for, so prop-driven `present` changes
  // (open/close) reconcile in place rather than re-reading localStorage.
  const hydratedFor = useRef<string | null>(null);

  // Hydrate on active-session change.
  useEffect(() => {
    if (!sessionId) {
      setTree(null);
      hydratedFor.current = null;
      return;
    }
    setTree(loadTree(sessionId, present));
    setWidth(loadWidth(sessionId));
    hydratedFor.current = sessionId;
    nudgePanes();
    // present intentionally excluded — reconciliation on present changes is the
    // separate effect below; here we only react to the session swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Reconcile the tree whenever the present set changes for the SAME session
  // (a pane opened or closed). reconcileTree inserts/removes leaves.
  const presentKey = present.join("|");
  useEffect(() => {
    if (!sessionId || hydratedFor.current !== sessionId) return;
    setTree((prev) => reconcileTree(prev, present));
    nudgePanes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentKey, sessionId]);

  // Persist tree + width (per session) on change.
  useEffect(() => {
    if (!sessionId || hydratedFor.current !== sessionId) return;
    try {
      if (tree) localStorage.setItem(TREE_KEY + sessionId, JSON.stringify(tree));
      else localStorage.removeItem(TREE_KEY + sessionId);
    } catch {
      /* quota — ignore */
    }
  }, [tree, sessionId]);

  useEffect(() => {
    if (!sessionId || hydratedFor.current !== sessionId) return;
    try {
      localStorage.setItem(WIDTH_KEY + sessionId, String(Math.round(width)));
    } catch {
      /* ignore */
    }
  }, [width, sessionId]);

  // Clamp width if the window shrinks.
  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w, MIN_WIDTH, dockWidthMax()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // --- DockTree callbacks ----------------------------------------------------
  const onMove = useCallback((dragKey: string, targetKey: string, zone: DockZone) => {
    setTree((prev) => {
      if (!prev) return prev;
      const without = removeKey(prev, dragKey);
      if (!without) return prev;
      const dir = zone === "left" || zone === "right" ? "row" : "col";
      const before = zone === "left" || zone === "top";
      return ensureIds(insertBeside(without, targetKey, dragKey, dir, before));
    });
    nudgePanes();
  }, []);

  const onMoveRoot = useCallback((dragKey: string, zone: DockZone) => {
    setTree((prev) => {
      if (!prev) return prev;
      const without = removeKey(prev, dragKey);
      const dir = zone === "left" || zone === "right" ? "row" : "col";
      const before = zone === "left" || zone === "top";
      return ensureIds(insertRoot(without, dragKey, dir, before));
    });
    nudgePanes();
  }, []);

  const onWeights = useCallback((nodeId: string, w: number[]) => {
    setTree((prev) => setNodeWeights(prev, nodeId, w));
    nudgePanes();
  }, []);

  // --- reverse-portal keep-alive ---------------------------------------------
  // Each pane lives in a STABLE detached <div> container, created once per key.
  // The pane is portaled into that container ONCE (container identity never
  // changes → React never remounts the pane). On every re-tile, the leaf slot's
  // ref appendChild's the stable container into the new slot — a DOM move, which
  // React is oblivious to. So xterm scrollback + the voice bridge survive.
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const getContainer = useCallback((key: string) => {
    let c = containersRef.current.get(key);
    if (!c) {
      c = document.createElement("div");
      c.style.cssText = "flex:1 1 0;min-width:0;min-height:0;display:flex";
      containersRef.current.set(key, c);
    }
    return c;
  }, []);

  // The DockTree drag handle for each leaf, refreshed every render. Read at
  // EVENT time (not render time) by the native pointerdown listener below.
  const handlesRef = useRef<Map<string, DragHandle>>(new Map());

  // Stable per-key slot-ref: (1) appendChild the stable container into the slot,
  // and (2) attach a NATIVE pointerdown listener. Native is REQUIRED: the pane
  // (incl. its grip header) is portaled into the container, so React-synthetic
  // events from it propagate up the REACT tree (the portal's parent), NOT to
  // this slot. Native DOM bubbling, however, DOES follow header→container→slot,
  // so a native listener here catches grip drags. Stable identity also avoids
  // the detach/reattach-every-render infinite loop.
  const slotRefCache = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());
  const getSlotRef = useCallback(
    (key: string) => {
      let cb = slotRefCache.current.get(key);
      if (!cb) {
        let bound: HTMLDivElement | null = null;
        const onDown = (e: PointerEvent) => {
          if (!(e.target as HTMLElement).closest("[data-dock-grip]")) return;
          const h = handlesRef.current.get(key);
          if (!h) return;
          e.preventDefault(); // suppress text selection while dragging a tile
          h.onPointerDown(e as unknown as React.PointerEvent);
        };
        cb = (slot: HTMLDivElement | null) => {
          if (slot) {
            const c = getContainer(key);
            if (c.parentNode !== slot) slot.appendChild(c);
            if (bound !== slot) {
              bound?.removeEventListener("pointerdown", onDown);
              slot.addEventListener("pointerdown", onDown);
              bound = slot;
            }
          } else {
            bound?.removeEventListener("pointerdown", onDown);
            bound = null;
          }
        };
        slotRefCache.current.set(key, cb);
      }
      return cb;
    },
    [getContainer]
  );

  const renderItem = useCallback(
    (key: string, handle: DragHandle) => {
      handlesRef.current.set(key, handle);
      return <div ref={getSlotRef(key)} style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }} />;
    },
    [getSlotRef]
  );

  // Keys currently in the tree (what we should portal). Derived from the tree so
  // a pane only portals once it actually has a leaf + target.
  const treeKeys = useMemo(() => (tree ? keysOf(tree) : []), [tree]);

  // --- the actual pane elements (mounted ONCE here, stable keys) -------------
  // Each is created unconditionally when its data is available so React keeps
  // the instance mounted regardless of which DOM target the portal points at.
  const paneFor = (key: string): React.ReactNode => {
    switch (key) {
      case "files":
        return (
          <PaneShell
            eyebrow="files"
            dotColor="var(--accent)"
            onClose={onFilesClose}
            closeLabel="Close files"
          >
            <FilesPanel
              session={filesSession}
              activeFilePath={filesActiveFilePath}
              dirtyPaths={filesDirtyPaths}
              onOpenFile={onFilesOpenFile}
              onPathDeleted={onFilesPathDeleted}
              onPathRenamed={onFilesPathRenamed}
              onClose={onFilesClose}
              onError={onFilesError}
            />
          </PaneShell>
        );
      case "terminal":
        return terminalSession ? (
          <PaneShell
            eyebrow="terminal"
            dotColor="var(--info)"
            sub={terminalSession.name}
            onClose={onTerminalClose}
            closeLabel="Close terminal"
          >
            <TerminalPane
              session={terminalSession}
              isArchived={false}
              onStart={onStart}
              onResume={onResume}
              termConfig={termConfig}
              autoScroll={true}
              onAutoScrollChange={() => {}}
            />
          </PaneShell>
        ) : null;
      case "mindmap":
        return mindmapSessionId ? (
          <PaneShell
            eyebrow="mindmap"
            dotColor="var(--info)"
            onClose={onMindmapClose}
            closeLabel="Close mindmap"
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
              <MindmapPane sessionId={mindmapSessionId} />
            </div>
          </PaneShell>
        ) : null;
      case "voice":
        return voiceSessionId ? (
          <PaneShell
            eyebrow="voice"
            dotColor="var(--purple)"
            sub={voiceSessionName + (voiceIsActiveTab ? "" : " · background")}
            onClose={onVoiceClose}
            closeLabel="Close voice"
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
              <VoicePane sessionId={voiceSessionId} />
            </div>
          </PaneShell>
        ) : null;
      case "crew":
        return crewSupervisor ? (
          <PaneShell
            eyebrow="crew"
            dotColor="var(--ok)"
            sub={crewSupervisor.name}
            onClose={onCrewClose}
            closeLabel="Close crew"
          >
            <CrewPane
              supervisor={crewSupervisor}
              workers={crewWorkers}
              queuedCount={crewQueuedCount}
              onSelectSession={onCrewSelectSession}
              onDetachWorker={onCrewDetachWorker}
              onError={onCrewError}
            />
          </PaneShell>
        ) : null;
      default: {
        // Detached crew worker ("crewSession:<workerSessionId>") — the same
        // dynamic-leaf mechanism as detached files below.
        if (key.startsWith("crewSession:")) {
          const wRow = detachedCrewWorkers.find((d) => d.key === key);
          if (!wRow) return null;
          return (
            <PaneShell
              eyebrow="session"
              dotColor="var(--info)"
              sub={wRow.session.name}
              onClose={() => onCloseDetachedCrewWorker(key)}
              closeLabel="Close worker panel"
              leadingActions={
                <IconButton
                  name="terminal"
                  size={13}
                  label="Open as tab"
                  onClick={() => onCrewSelectSession(wRow.session.id)}
                />
              }
            >
              <CrewSessionPanel
                session={wRow.session}
                termConfig={termConfig}
                onStart={onStart}
                onResume={onResume}
                onError={onCrewError}
              />
            </PaneShell>
          );
        }
        // Detached file tab ("file:<sessionId>:<relPath>").
        if (key.startsWith("file:")) {
          const f = detachedFiles.find((d) => d.key === key);
          if (!f) return null;
          const base = f.relPath.split("/").pop() || f.relPath;
          return (
            <PaneShell
              eyebrow="file"
              dotColor="var(--warn)"
              sub={base}
              onClose={() => onCloseDetachedFile(key)}
              closeLabel="Close file"
              leadingActions={
                <IconButton
                  name="cornerUpLeft"
                  size={13}
                  label="Reattach to tab"
                  onClick={() => onReattachFile(key)}
                />
              }
            >
              <FileTabPanel
                sessionId={f.sessionId}
                relPath={f.relPath}
                active
                onDirtyChange={(dirty) => onFileDirtyChange(key, dirty)}
              />
            </PaneShell>
          );
        }
        return null;
      }
    }
  };

  // Nothing to show → render nothing (no width handle, no dock).
  if (!tree || treeKeys.length === 0) return null;

  const onWidthDelta = (d: number) => {
    // Handle sits on the LEFT edge of the dock; dragging right shrinks it.
    setWidth((w) => clamp(w - d, MIN_WIDTH, dockWidthMax()));
    nudgePanes();
  };

  return (
    <>
      <WidthHandle onDelta={onWidthDelta} />
      <div
        className="flex min-h-0"
        style={{
          width,
          flex: "none",
          fontFamily: "var(--sans)",
          display: "flex",
        }}
      >
        <DockTree
          tree={tree}
          onMove={onMove}
          onMoveRoot={onMoveRoot}
          onWeights={onWeights}
          renderItem={renderItem}
        />
      </div>

      {/* Pane instances: each portaled into its STABLE container (never changes),
          so re-tiling (which only appendChild's the container into a new slot)
          never remounts the pane → xterm scrollback + voice bridge survive. */}
      {treeKeys.map((key) => createPortal(paneFor(key), getContainer(key), key))}
    </>
  );
}
