import React, { useRef, useState, useEffect } from "react";

/* ============================================================
   Recursive split-tree tiling dock — faithful TypeScript port
   of the design prototype (design_source/layout.jsx).

   Pointer-based drag-and-drop (works in sandboxed iframes and
   over child iframes, unlike native HTML5 drag-and-drop).

   NOTE FOR INTEGRATORS:
   - While a drag is active, `document.body` gets the class
     `rd-dragging`. Add a CSS rule for it if needed, e.g. to
     disable iframe pointer-events during a drag:
         body.rd-dragging iframe { pointer-events: none; }
     (No global CSS is injected by this module.)
   - Hit-testing depends on the `[data-leaf-key]` attribute:
     each leaf's rendered pane must sit inside a wrapper carrying
     `data-leaf-key`. `DockTree` (via `TreeLeaf`) provides that
     wrapper itself, so `renderItem` does NOT need to add one.
   - The visuals use CSS custom properties such as `var(--accent)`,
     which the app's style.css already defines.
   ============================================================ */

/* ---- exported types ---- */

export type DockNode =
  | { t: "leaf"; k: string }
  | { t: "split"; dir: "row" | "col"; items: DockNode[]; w: number[]; id?: string };

export type DockZone = "left" | "right" | "top" | "bottom";

/** The object passed to `renderItem(key, handle)`. Spread `handle`
 *  onto the draggable element to make a pane draggable. */
export type DragHandle = {
  onPointerDown: (e: React.PointerEvent) => void;
};

/* ---- internal over-state shape ---- */
type OverState =
  | { kind: "leaf"; key: string; zone: DockZone }
  | { kind: "root"; zone: DockZone }
  | null;

/* measure an element's box, live */
export const useElSize = <T extends HTMLElement = HTMLDivElement>(): [
  React.RefObject<T>,
  { w: number; h: number }
] => {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
};

/* pointer-drag helper → reports incremental dx/dy */
const startDrag =
  (onMove: (dx: number, dy: number) => void, onEnd?: () => void) =>
  (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    let last = { x: e.clientX, y: e.clientY };
    const mv = (ev: PointerEvent) => {
      onMove(ev.clientX - last.x, ev.clientY - last.y);
      last = { x: ev.clientX, y: ev.clientY };
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      onEnd && onEnd();
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      (e.currentTarget as HTMLElement)?.dataset?.cur || "";
  };

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/* a draggable divider between two flex children */
export const Gutter: React.FC<{
  dir: "row" | "col";
  onDelta: (d: number) => void;
}> = ({ dir, onDelta }) => {
  const vertical = dir === "row"; // row layout → vertical gutter (drag horizontally)
  const [h, setH] = useState(false);
  return (
    <div
      data-cur={vertical ? "col-resize" : "row-resize"}
      onPointerDown={startDrag((dx, dy) => onDelta(vertical ? dx : dy))}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        flex: "none",
        position: "relative",
        alignSelf: "stretch",
        zIndex: 6,
        width: vertical ? 8 : "auto",
        height: vertical ? "auto" : 8,
        cursor: vertical ? "col-resize" : "row-resize",
      }}
    >
      <span
        style={{
          position: "absolute",
          borderRadius: 2,
          background: h ? "var(--accent)" : "transparent",
          transition: "background .12s",
          ...(vertical
            ? { top: 6, bottom: 6, left: 3, width: 2 }
            : { left: 6, right: 6, top: 3, height: 2 }),
        }}
      />
    </div>
  );
};

/* edge handle for resizing the dock width (handle sits on the LEFT edge) */
export const WidthHandle: React.FC<{ onDelta: (d: number) => void }> = ({
  onDelta,
}) => {
  const [h, setH] = useState(false);
  return (
    <div
      data-cur="col-resize"
      onPointerDown={startDrag((dx) => onDelta(dx))}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        flex: "none",
        width: 5,
        cursor: "col-resize",
        position: "relative",
        zIndex: 6,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 1.5,
          width: 2,
          borderRadius: 2,
          background: h ? "var(--accent)" : "transparent",
          transition: "background .12s",
        }}
      />
    </div>
  );
};

/* drop-zone overlay shown while dragging a panel over another */
const ZoneOverlay: React.FC<{ zone: DockZone }> = ({ zone }) => {
  const pos: React.CSSProperties = {
    left: { left: 0, top: 0, bottom: 0, width: "50%" },
    right: { right: 0, top: 0, bottom: 0, width: "50%" },
    top: { left: 0, right: 0, top: 0, height: "50%" },
    bottom: { left: 0, right: 0, bottom: 0, height: "50%" },
  }[zone];
  return (
    <div
      style={{
        position: "absolute",
        zIndex: 9,
        pointerEvents: "none",
        borderRadius: 12,
        background: "color-mix(in srgb, var(--accent) 20%, transparent)",
        border: "2px solid var(--accent)",
        boxShadow: "0 0 18px -2px var(--accent)",
        ...pos,
      }}
    />
  );
};

/* ============================================================
   Recursive split-tree dock.
   node = { t:"leaf", k }  |  { t:"split", dir:"row"|"col", items:[node…], w:[…], id }
   row = children side-by-side · col = children stacked.
   Drop on a panel edge → split that panel; drop on a dock perimeter
   strip → split at the ROOT (full-width row / full-height column).
   ============================================================ */
export const leaf = (k: string): DockNode => ({ t: "leaf", k });
const _isLeaf = (n: DockNode): n is { t: "leaf"; k: string } => n.t === "leaf";
export const keysOf = (n: DockNode): string[] =>
  n.t === "leaf" ? [n.k] : n.items.flatMap(keysOf);

let _sid = 0;
export const ensureIds = (n: DockNode | null): DockNode | null => {
  if (!n) return n;
  if (n.t === "leaf") return n;
  return {
    ...n,
    id: n.id || "s" + ++_sid,
    items: n.items.map((c) => ensureIds(c) as DockNode),
  };
};

export const removeKey = (n: DockNode | null, key: string): DockNode | null => {
  if (!n) return null;
  if (_isLeaf(n)) return n.k === key ? null : n;
  const items: DockNode[] = [];
  const w: number[] = [];
  n.items.forEach((c, i) => {
    const r = removeKey(c, key);
    if (r) {
      items.push(r);
      w.push((n.w && n.w[i]) || 1);
    }
  });
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];
  return { ...n, items, w };
};

const pruneTree = (n: DockNode | null, onSet: Set<string>): DockNode | null => {
  if (!n) return null;
  if (_isLeaf(n)) return onSet.has(n.k) ? n : null;
  const items: DockNode[] = [];
  const w: number[] = [];
  n.items.forEach((c, i) => {
    const r = pruneTree(c, onSet);
    if (r) {
      items.push(r);
      w.push((n.w && n.w[i]) || 1);
    }
  });
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];
  return { ...n, items, w };
};

export const insertBeside = (
  n: DockNode,
  targetKey: string,
  drag: string,
  dir: "row" | "col",
  before: boolean
): DockNode => {
  if (_isLeaf(n)) {
    if (n.k !== targetKey) return n;
    return {
      t: "split",
      dir,
      items: before ? [leaf(drag), n] : [n, leaf(drag)],
      w: [1, 1],
    };
  }
  const idx = n.items.findIndex((c) => _isLeaf(c) && c.k === targetKey);
  if (idx >= 0) {
    const items = [...n.items];
    const w = [...(n.w || n.items.map(() => 1))];
    if (n.dir === dir) {
      const at = before ? idx : idx + 1;
      items.splice(at, 0, leaf(drag));
      w.splice(at, 0, 1);
      return { ...n, items, w };
    }
    items[idx] = {
      t: "split",
      dir,
      items: before ? [leaf(drag), items[idx]] : [items[idx], leaf(drag)],
      w: [1, 1],
    };
    return { ...n, items, w };
  }
  return {
    ...n,
    items: n.items.map((c) => insertBeside(c, targetKey, drag, dir, before)),
  };
};

export const insertRoot = (
  tree: DockNode | null,
  drag: string,
  dir: "row" | "col",
  before: boolean
): DockNode => {
  if (!tree) return leaf(drag);
  if (!_isLeaf(tree) && tree.dir === dir) {
    const items = [...tree.items];
    const w = [...(tree.w || items.map(() => 1))];
    if (before) {
      items.unshift(leaf(drag));
      w.unshift(1);
    } else {
      items.push(leaf(drag));
      w.push(1);
    }
    return { ...tree, items, w };
  }
  return {
    t: "split",
    dir,
    items: before ? [leaf(drag), tree] : [tree, leaf(drag)],
    w: [1, 1],
  };
};

export const setNodeWeights = (
  n: DockNode | null,
  id: string,
  w: number[]
): DockNode | null => {
  if (!n || _isLeaf(n)) return n;
  if (n.id === id) return { ...n, w };
  return { ...n, items: n.items.map((c) => setNodeWeights(c, id, w) as DockNode) };
};

/* reconcile a stored tree against the set of currently-present panels */
export const reconcileTree = (
  tree: DockNode | null,
  present: string[]
): DockNode | null => {
  const onSet = new Set(present);
  let t = pruneTree(tree, onSet);
  const have = new Set(t ? keysOf(t) : []);
  present.forEach((k) => {
    if (!have.has(k)) t = t ? insertRoot(t, k, "col", false) : leaf(k);
  });
  return ensureIds(t);
};

/* ---- renderer context ---- */
type TreeCtx = {
  drag: string | null;
  over: OverState;
  beginDrag: (k: string, e: React.PointerEvent) => void;
  renderItem: (key: string, handle: DragHandle) => React.ReactNode;
  onWeights: (nodeId: string, w: number[]) => void;
};

/* ---- recursive renderer ---- */
const TreeSplit: React.FC<{
  node: Extract<DockNode, { t: "split" }>;
  ctx: TreeCtx;
}> = ({ node, ctx }) => {
  const [ref, size] = useElSize();
  const dir = node.dir;
  const total = dir === "row" ? size.w : size.h;
  const w = node.w || node.items.map(() => 1);
  // A gutter drag captures `adjust` once at pointer-down, but emits INCREMENTAL
  // deltas across many moves. Reading `w`/`total` from refs (refreshed every
  // render) lets each move accumulate against the latest weights instead of the
  // stale pointer-down snapshot — otherwise the whole drag collapses to one step.
  const wRef = useRef(w);
  wRef.current = w;
  const totalRef = useRef(total);
  totalRef.current = total;
  const adjust = (i: number, d: number) => {
    const t = totalRef.current;
    if (!t) return;
    const cur = wRef.current;
    const sum = cur.reduce((a, b) => a + b, 0);
    const dW = (d / t) * sum;
    const nw = [...cur];
    const a = nw[i] + dW,
      b = nw[i + 1] - dW,
      min = sum * 0.12;
    if (a < min || b < min) return;
    nw[i] = a;
    nw[i + 1] = b;
    ctx.onWeights(node.id as string, nw);
  };
  return (
    <div
      ref={ref}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: dir === "row" ? "row" : "column",
      }}
    >
      {node.items.map((c, i) => (
        <React.Fragment key={c.t === "leaf" ? c.k : c.id}>
          <div
            style={{
              flexGrow: w[i],
              flexBasis: 0,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
            }}
          >
            <TreeNode node={c} ctx={ctx} />
          </div>
          {i < node.items.length - 1 && (
            <Gutter dir={dir} onDelta={(d) => adjust(i, d)} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

const TreeLeaf: React.FC<{
  node: Extract<DockNode, { t: "leaf" }>;
  ctx: TreeCtx;
}> = ({ node, ctx }) => {
  const k = node.k;
  const { drag, over, beginDrag, renderItem } = ctx;
  const handle: DragHandle = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      beginDrag(k, e);
    },
  };
  return (
    <div
      data-leaf-key={k}
      style={{
        position: "relative",
        display: "flex",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        opacity: drag === k ? 0.35 : 1,
        transition: "opacity .12s",
      }}
    >
      {renderItem(k, handle)}
      {over && over.kind === "leaf" && over.key === k && drag && drag !== k && (
        <ZoneOverlay zone={over.zone} />
      )}
    </div>
  );
};

const TreeNode: React.FC<{ node: DockNode; ctx: TreeCtx }> = ({ node, ctx }) =>
  node.t === "leaf" ? (
    <TreeLeaf node={node} ctx={ctx} />
  ) : (
    <TreeSplit node={node} ctx={ctx} />
  );

const RootEdge: React.FC<{ zone: DockZone }> = ({ zone }) => {
  const base: React.CSSProperties = {
    position: "absolute",
    zIndex: 21,
    pointerEvents: "none",
    background: "var(--accent)",
    boxShadow: "0 0 12px var(--accent)",
    borderRadius: 2,
  };
  const m: React.CSSProperties = {
    left: { left: 0, top: 6, bottom: 6, width: 3 },
    right: { right: 0, top: 6, bottom: 6, width: 3 },
    top: { top: 0, left: 6, right: 6, height: 3 },
    bottom: { bottom: 0, left: 6, right: 6, height: 3 },
  }[zone];
  return <div style={{ ...base, ...m }} />;
};

/* tiling dock built on the split tree — pointer-based dragging (works in sandboxed
   iframes and over child iframes, unlike native HTML5 drag-and-drop) */
export const DockTree: React.FC<{
  tree: DockNode | null;
  onMove: (dragKey: string, targetKey: string, zone: DockZone) => void;
  onMoveRoot: (dragKey: string, zone: DockZone) => void;
  onWeights: (nodeId: string, w: number[]) => void;
  renderItem: (key: string, handle: DragHandle) => React.ReactNode;
}> = ({ tree, onMove, onMoveRoot, onWeights, renderItem }) => {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<OverState>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    k: string;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const EDGE = 24;

  const hitTest = (x: number, y: number): OverState => {
    const dock = dockRef.current;
    if (!dock) return null;
    const dr = dock.getBoundingClientRect();
    if (x < dr.left || x > dr.right || y < dr.top || y > dr.bottom) return null;
    // near the dock's outer boundary → root split (full-width row / full-height column)
    const dl = x - dr.left,
      drr = dr.right - x,
      dt = y - dr.top,
      db = dr.bottom - y;
    const m = Math.min(dl, drr, dt, db);
    if (m < EDGE) {
      const zone: DockZone =
        dl === m ? "left" : drr === m ? "right" : dt === m ? "top" : "bottom";
      return { kind: "root", zone };
    }
    // otherwise → the panel under the cursor, nearest edge picks the split direction
    const el = document.elementFromPoint(x, y);
    const leafEl =
      el && el.closest && el.closest("[data-leaf-key]");
    if (!leafEl || !dock.contains(leafEl)) return null;
    const key = leafEl.getAttribute("data-leaf-key");
    if (key == null) return null;
    const r = leafEl.getBoundingClientRect();
    const zone = (
      [
        ["left", x - r.left],
        ["right", r.right - x],
        ["top", y - r.top],
        ["bottom", r.bottom - y],
      ] as [DockZone, number][]
    ).sort((a, b) => a[1] - b[1])[0][0];
    return { kind: "leaf", key, zone };
  };

  const beginDrag = (k: string, e: React.PointerEvent) => {
    const start = { k, x: e.clientX, y: e.clientY, active: false };
    dragRef.current = start;
    const onMoveFn = (ev: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      if (!st.active) {
        if (Math.abs(ev.clientX - st.x) + Math.abs(ev.clientY - st.y) < 5)
          return;
        st.active = true;
        setDrag(st.k);
        document.body.classList.add("rd-dragging");
      }
      setOver(hitTest(ev.clientX, ev.clientY));
    };
    const onUpFn = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMoveFn, true);
      window.removeEventListener("pointerup", onUpFn, true);
      const st = dragRef.current;
      dragRef.current = null;
      document.body.classList.remove("rd-dragging");
      if (st && st.active) {
        const t = hitTest(ev.clientX, ev.clientY);
        if (t && t.kind === "root") onMoveRoot(st.k, t.zone);
        else if (t && t.kind === "leaf" && t.key !== st.k)
          onMove(st.k, t.key, t.zone);
      }
      setDrag(null);
      setOver(null);
    };
    window.addEventListener("pointermove", onMoveFn, true);
    window.addEventListener("pointerup", onUpFn, true);
  };

  const ctx: TreeCtx = { drag, over, beginDrag, renderItem, onWeights };
  if (!tree) return null;
  return (
    <div
      ref={dockRef}
      style={{
        position: "relative",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
      }}
    >
      <TreeNode node={tree} ctx={ctx} />
      {over && over.kind === "root" && <RootEdge zone={over.zone} />}
    </div>
  );
};
