import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
} from "@xyflow/react";
import type { Edge, Node, NodeProps, Connection } from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import "./MindmapPane.css";
import type { MindmapNode } from "../types";
import {
  getMindmap,
  setMindmapNode,
  removeMindmapNode,
  listBoards,
} from "../api";
import { ContextMenu } from "./ContextMenu";
import type { MenuItem } from "./ContextMenu";

const STATUS_LABEL: Record<string, string> = {
  planned: "planned",
  in_progress: "building",
  done: "done",
  blocked: "blocked",
};

const STATUS_OPTIONS = ["planned", "in_progress", "done", "blocked"];

// Data carried on each React Flow node.
interface NodeData {
  label: string;
  text: string;
  status: string;
  note: string;
  progress: number;
  kind: string;
  root: boolean;
  pinned: boolean;
  // Right-click handler injected per render so the node can open the menu.
  onContext?: (e: React.MouseEvent, id: string) => void;
  [key: string]: unknown;
}

type FlowNode = Node<NodeData>;

const NODE_W = 230;
const NODE_W_ROOT = 250;
const NODE_W_NOTE = 210;

function nodeWidth(d: NodeData): number {
  return d.kind === "note" ? NODE_W_NOTE : d.root ? NODE_W_ROOT : NODE_W;
}

// Rough first-pass height estimate (only used until the node is measured in the DOM).
function nodeHeight(d: NodeData): number {
  if (d.kind === "note") return 48 + Math.ceil((d.text || "").length / 24) * 18;
  let h = 44;
  if (d.note) h += 16 + Math.ceil(d.note.length / 26) * 17;
  if (d.progress != null && d.progress >= 0) h += 6;
  return h;
}

type SizeMap = Record<string, { width: number; height: number }>;

// Lay out with dagre. When `sizes` is provided (real measured DOM sizes) we use
// those so rows never overlap; otherwise we fall back to the rough estimate.
// Pinned nodes keep their existing position and are not repositioned.
function layout(nodes: FlowNode[], edges: Edge[], sizes?: SizeMap): FlowNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 90, marginx: 30, marginy: 30 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => {
    const m = sizes?.[n.id];
    g.setNode(n.id, {
      width: m?.width ?? nodeWidth(n.data),
      height: m?.height ?? nodeHeight(n.data),
    });
  });
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    if (n.data.pinned) {
      return { ...n, targetPosition: Position.Left, sourcePosition: Position.Right };
    }
    const p = g.node(n.id);
    return {
      ...n,
      position: { x: p.x - p.width / 2, y: p.y - p.height / 2 },
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
    };
  });
}

function StatusNode({ id, data }: NodeProps<FlowNode>) {
  return (
    <div
      className={"node s-" + data.status + (data.root ? " root" : "")}
      onContextMenu={(e) => data.onContext?.(e, id)}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-head">
        <span className="dot" />
        <span className="node-title">{data.label}</span>
        <span className="badge">{STATUS_LABEL[data.status] ?? data.status}</span>
      </div>
      {data.note && (
        <div className="node-note">
          <span className="ico">📝</span>
          <span>{data.note}</span>
        </div>
      )}
      {data.progress != null && data.progress >= 0 && (
        <div className="pbar">
          <i style={{ width: data.progress + "%" }} />
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function NoteNode({ id, data }: NodeProps<FlowNode>) {
  return (
    <div className="sticky" onContextMenu={(e) => data.onContext?.(e, id)}>
      <Handle type="target" position={Position.Left} />
      <div className="sticky-head">
        <span>📌</span>
        <span>note</span>
      </div>
      <div className="sticky-body">{data.text}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { status: StatusNode, note: NoteNode };

function buildGraph(data: MindmapNode[]): { rawNodes: FlowNode[]; rawEdges: Edge[] } {
  const present = new Set(data.map((n) => n.id));
  const rawNodes: FlowNode[] = data.map((n) => ({
    id: n.id,
    type: n.kind === "note" ? "note" : "status",
    position: { x: 0, y: 0 },
    data: {
      label: n.label,
      text: n.text,
      status: n.status,
      note: n.note,
      progress: n.progress,
      kind: n.kind,
      root: n.parentId === "",
      pinned: false,
    },
  }));
  const statusById = new Map(data.map((n) => [n.id, n.status]));
  const rawEdges: Edge[] = data
    .filter((n) => n.parentId !== "" && present.has(n.parentId))
    .map((n) => ({
      id: n.parentId + "->" + n.id,
      source: n.parentId,
      target: n.id,
      type: "smoothstep",
      animated:
        n.status === "in_progress" || statusById.get(n.parentId) === "in_progress",
    }));
  return { rawNodes, rawEdges };
}

// Convert a FlowNode back into a MindmapNode for persistence.
function flowToMindmap(n: FlowNode, parentId: string, board: string): MindmapNode {
  return {
    id: n.id,
    parentId,
    kind: n.data.kind,
    label: n.data.label,
    text: n.data.text,
    status: n.data.status,
    note: n.data.note,
    progress: n.data.progress,
    board,
  };
}

// --- edit form modal ---

interface EditDraft {
  id: string;
  kind: string;
  label: string;
  text: string;
  status: string;
  note: string;
  progress: number;
  parentId: string;
}

function EditNodeModal({
  draft,
  isNew,
  parentOptions,
  onSubmit,
  onCancel,
}: {
  draft: EditDraft;
  isNew: boolean;
  parentOptions: { value: string; label: string }[];
  onSubmit: (d: EditDraft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<EditDraft>(draft);
  const set = <K extends keyof EditDraft>(k: K, v: EditDraft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (d.kind === "note") {
      if (!d.text.trim()) return;
    } else if (!d.label.trim()) {
      return;
    }
    onSubmit(d);
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: "var(--q-bg-hover)",
    border: "1px solid var(--q-border)",
    color: "var(--q-fg)",
    fontFamily: "'JetBrains Mono', monospace",
    outline: "none",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--q-modal-backdrop)" }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        style={{
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <label className="block text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>
          // {isNew ? "new" : "edit"} {d.kind}
        </label>

        {/* kind toggle (only when creating) */}
        {isNew && (
          <div className="flex gap-2">
            {["node", "note"].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => set("kind", k)}
                className="px-3 py-1.5 text-[11px] lowercase"
                style={{
                  color: d.kind === k ? "var(--q-bg)" : "var(--q-fg-secondary)",
                  backgroundColor: d.kind === k ? "var(--q-accent)" : "var(--q-bg-hover)",
                  border: `1px solid ${d.kind === k ? "var(--q-accent)" : "var(--q-border)"}`,
                }}
              >
                {k}
              </button>
            ))}
          </div>
        )}

        {d.kind === "note" ? (
          <label className="block">
            <span className="text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>text</span>
            <textarea
              autoFocus
              value={d.text}
              onChange={(e) => set("text", e.target.value)}
              rows={3}
              className="mt-1 block w-full px-3 py-2 text-xs"
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
            />
          </label>
        ) : (
          <>
            <label className="block">
              <span className="text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>label</span>
              <input
                autoFocus
                value={d.label}
                onChange={(e) => set("label", e.target.value)}
                className="mt-1 block w-full px-3 py-2 text-xs"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
              />
            </label>

            <label className="block">
              <span className="text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>note</span>
              <input
                value={d.note}
                onChange={(e) => set("note", e.target.value)}
                className="mt-1 block w-full px-3 py-2 text-xs"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
              />
            </label>

            <div className="flex gap-3">
              <label className="block flex-1">
                <span className="text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>status</span>
                <PlainSelect value={d.status} options={STATUS_OPTIONS} onChange={(v) => set("status", v)} />
              </label>
              <label className="block" style={{ width: 90 }}>
                <span className="text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>progress</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={d.progress}
                  onChange={(e) =>
                    set("progress", Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                  }
                  className="mt-1 block w-full px-3 py-2 text-xs"
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
                />
              </label>
            </div>
          </>
        )}

        {/* parent */}
        <label className="block">
          <span className="text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>parent</span>
          <PlainSelect
            value={d.parentId}
            options={["", ...parentOptions.map((o) => o.value)]}
            labels={{ "": "(none / root)", ...Object.fromEntries(parentOptions.map((o) => [o.value, o.label])) }}
            onChange={(v) => set("parentId", v)}
          />
        </label>

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
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{ backgroundColor: "var(--q-accent)", color: "var(--q-bg)", fontWeight: 500 }}
          >
            {isNew ? "create" : "save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// Lightweight native-styled select reused by the edit form.
function PlainSelect({
  value,
  options,
  labels,
  onChange,
}: {
  value: string;
  options: string[];
  labels?: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 block w-full px-3 py-2 text-xs"
      style={{
        backgroundColor: "var(--q-bg-hover)",
        border: "1px solid var(--q-border)",
        color: "var(--q-fg)",
        fontFamily: "'JetBrains Mono', monospace",
        outline: "none",
      }}
    >
      {options.map((o) => (
        <option key={o} value={o} style={{ backgroundColor: "var(--q-bg)" }}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

function MindmapInner({ sessionId }: { sessionId: string }) {
  const boardKey = "quant.mindmapBoard." + sessionId;
  const [activeBoard, setActiveBoard] = useState<string>(
    () => localStorage.getItem("quant.mindmapBoard." + sessionId) || "default"
  );
  const [boards, setBoards] = useState<string[]>(["default"]);
  const [nodesData, setNodesData] = useState<MindmapNode[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, getNodes } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const laidOutSig = useRef("");

  // Co-authoring: ids whose label/note/text the user currently owns (open in the
  // edit form). We keep local values for these instead of the agent's snapshot.
  const editingIds = useRef<Set<string>>(new Set());

  // Edit form + context menu state.
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editIsNew, setEditIsNew] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  // Native window.prompt() is not implemented in the Wails WKWebView, so board
  // creation uses an in-app modal instead.
  const [creatingBoard, setCreatingBoard] = useState(false);

  // Reset board selection when the session changes.
  useEffect(() => {
    setActiveBoard(localStorage.getItem("quant.mindmapBoard." + sessionId) || "default");
    setBoards(["default"]);
    setNodesData([]);
    laidOutSig.current = "";
  }, [sessionId]);

  // Persist the active board.
  useEffect(() => {
    localStorage.setItem(boardKey, activeBoard);
  }, [boardKey, activeBoard]);

  // Refresh the list of boards (unioned with the active board so it always appears).
  const refreshBoards = useCallback(() => {
    listBoards(sessionId)
      .then((list) => {
        if (!Array.isArray(list)) return;
        setBoards((prev) => {
          const merged = new Set<string>(["default", ...list, ...prev, activeBoard]);
          return Array.from(merged);
        });
      })
      .catch(() => {});
  }, [sessionId, activeBoard]);

  // Hydrate on mount / when sessionId or board changes, plus a fallback poll.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getMindmap(sessionId, activeBoard)
        .then((n) => {
          if (!cancelled && Array.isArray(n)) setNodesData(n);
        })
        .catch(() => {});
    };
    setNodesData([]);
    laidOutSig.current = "";
    load();
    refreshBoards();
    const poll = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [sessionId, activeBoard, refreshBoards]);

  // Subscribe to the live Wails event (only apply for the active board).
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w?.runtime?.EventsOn) {
      const cancel = w.runtime.EventsOn(
        "mindmap:updated",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (d: any) => {
          if (d && d.sessionId === sessionId && d.board === activeBoard && Array.isArray(d.nodes)) {
            setNodesData(d.nodes);
            setBoards((prev) =>
              prev.includes(activeBoard) ? prev : [...prev, activeBoard]
            );
          }
        }
      );
      return () => cancel && cancel();
    }
  }, [sessionId, activeBoard]);

  // Rebuild nodes/edges when the data changes. Merge by id to preserve React
  // Flow transient fields (measured/selected/dragging), pinned positions, and
  // any field the user currently owns (editingIds). The agent owns
  // status/progress/structure. Re-layout only on structural change.
  useEffect(() => {
    const { rawNodes, rawEdges } = buildGraph(nodesData);
    setEdges(rawEdges);
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      const structuralChange =
        rawNodes.length !== prev.length || rawNodes.some((n) => !prevById.has(n.id));

      const merged: FlowNode[] = rawNodes.map((n) => {
        const old = prevById.get(n.id);
        if (!old) return n;
        const editing = editingIds.current.has(n.id);
        return {
          ...old,
          type: n.type,
          // Agent owns status/progress/structure; user owns label/note/text while editing.
          data: {
            ...old.data,
            status: n.data.status,
            progress: n.data.progress,
            root: n.data.root,
            kind: n.data.kind,
            label: editing ? old.data.label : n.data.label,
            note: editing ? old.data.note : n.data.note,
            text: editing ? old.data.text : n.data.text,
          },
        };
      });

      if (!structuralChange) {
        // Topology unchanged: keep all positions as-is.
        return merged;
      }
      // Structural change: re-run dagre, but never reposition pinned nodes.
      return layout(merged, rawEdges);
    });
  }, [nodesData, setNodes, setEdges]);

  // Second pass: once nodes are rendered & measured, re-layout with REAL sizes so
  // nothing overlaps. Pinned nodes are skipped (their position is preserved).
  useEffect(() => {
    if (!nodesInitialized) return;
    const measured = getNodes();
    if (measured.length === 0) return;
    if (measured.some((n) => !n.measured || !n.measured.height)) return;
    const sig = measured
      .map(
        (n) =>
          `${n.id}:${Math.round(n.measured!.width ?? 0)}x${Math.round(
            n.measured!.height ?? 0
          )}`
      )
      .join("|");
    if (sig === laidOutSig.current) return;
    laidOutSig.current = sig;
    const sizes: SizeMap = {};
    measured.forEach((n) => {
      sizes[n.id] = {
        width: n.measured!.width ?? nodeWidth(n.data as NodeData),
        height: n.measured!.height ?? 0,
      };
    });
    setNodes(layout(measured as FlowNode[], edges, sizes));
    const t = setTimeout(() => fitView({ duration: 400, padding: 0.18 }), 60);
    return () => clearTimeout(t);
  }, [nodesInitialized, nodes, edges, getNodes, fitView, setNodes]);

  // Inject the right-click handler into every node's data.
  const openMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, nodeId: id });
  }, []);

  const nodesWithCtx = nodes.map((n) =>
    n.data.onContext === openMenu ? n : { ...n, data: { ...n.data, onContext: openMenu } }
  );

  // Map of current parentId per node id (derived from edges).
  const parentOf = useCallback(
    (id: string): string => {
      const e = edges.find((ed) => ed.target === id);
      return e ? e.source : "";
    },
    [edges]
  );

  // --- authoring actions ---

  function openCreate(parentId = "") {
    setEditDraft({
      id: "",
      kind: "node",
      label: "",
      text: "",
      status: "planned",
      note: "",
      progress: 0,
      parentId,
    });
    setEditIsNew(true);
    setMenu(null);
  }

  function openEdit(id: string) {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    editingIds.current.add(id);
    setEditDraft({
      id,
      kind: n.data.kind || "node",
      label: n.data.label,
      text: n.data.text,
      status: n.data.status,
      note: n.data.note,
      progress: n.data.progress ?? 0,
      parentId: parentOf(id),
    });
    setEditIsNew(false);
    setMenu(null);
  }

  function closeEdit() {
    if (editDraft) editingIds.current.delete(editDraft.id);
    setEditDraft(null);
  }

  function submitEdit(d: EditDraft) {
    const id = d.id || crypto.randomUUID();
    const node: MindmapNode = {
      id,
      parentId: d.parentId,
      kind: d.kind,
      label: d.label.trim(),
      text: d.text,
      status: d.status,
      note: d.note,
      progress: d.progress,
      board: activeBoard,
    };
    editingIds.current.delete(d.id);
    setEditDraft(null);
    setMindmapNode(sessionId, activeBoard, node)
      .then(() => getMindmap(sessionId, activeBoard))
      .then((n) => Array.isArray(n) && setNodesData(n))
      .catch(() => {});
  }

  function deleteNode(id: string, subtree: boolean) {
    setMenu(null);
    removeMindmapNode(sessionId, activeBoard, id, subtree)
      .then(() => getMindmap(sessionId, activeBoard))
      .then((n) => Array.isArray(n) && setNodesData(n))
      .catch(() => {});
  }

  // Connecting: set the TARGET's parentId = source (single parent), persist.
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      const target = nodes.find((n) => n.id === conn.target);
      if (!target) return;
      const updated = flowToMindmap(target, conn.source, activeBoard);
      setMindmapNode(sessionId, activeBoard, updated)
        .then(() => getMindmap(sessionId, activeBoard))
        .then((n) => Array.isArray(n) && setNodesData(n))
        .catch(() => {});
    },
    [nodes, sessionId, activeBoard]
  );

  // Pin a node on drag-stop and persist its position implicitly via pinned flag.
  const onNodeDragStop = useCallback(
    (_e: unknown, node: FlowNode) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === node.id
            ? { ...n, position: node.position, data: { ...n.data, pinned: true } }
            : n
        )
      );
    },
    [setNodes]
  );

  // Canvas/keyboard deletion of nodes.
  const onNodesDelete = useCallback(
    (deleted: FlowNode[]) => {
      deleted.forEach((n) => {
        removeMindmapNode(sessionId, activeBoard, n.id, false).catch(() => {});
      });
      setTimeout(() => {
        getMindmap(sessionId, activeBoard)
          .then((n) => Array.isArray(n) && setNodesData(n))
          .catch(() => {});
      }, 50);
    },
    [sessionId, activeBoard]
  );

  // Edge deletion clears the child's parentId.
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      deleted.forEach((e) => {
        const child = nodes.find((n) => n.id === e.target);
        if (!child) return;
        const updated = flowToMindmap(child, "", activeBoard);
        setMindmapNode(sessionId, activeBoard, updated).catch(() => {});
      });
      setTimeout(() => {
        getMindmap(sessionId, activeBoard)
          .then((n) => Array.isArray(n) && setNodesData(n))
          .catch(() => {});
      }, 50);
    },
    [nodes, sessionId, activeBoard]
  );

  function submitBoard(name: string) {
    setCreatingBoard(false);
    const trimmed = name.trim();
    if (!trimmed) return;
    setBoards((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setActiveBoard(trimmed);
  }

  // Parent options for the edit form (exclude the node being edited).
  const parentOptions = nodes
    .filter((n) => n.id !== editDraft?.id)
    .map((n) => ({
      value: n.id,
      label: n.data.kind === "note" ? `📌 ${n.data.text.slice(0, 30)}` : n.data.label,
    }));

  const ctxNode = menu ? nodes.find((n) => n.id === menu.nodeId) : null;
  const menuItems: MenuItem[] = ctxNode
    ? [
        { type: "label", text: ctxNode.data.kind === "note" ? "note" : ctxNode.data.label },
        {
          type: "item",
          icon: "✎",
          iconColor: "var(--q-accent)",
          label: "edit",
          onClick: () => openEdit(menu!.nodeId),
        },
        {
          type: "item",
          icon: "+",
          iconColor: "var(--q-accent)",
          label: "add child",
          onClick: () => openCreate(menu!.nodeId),
        },
        { type: "separator" },
        {
          type: "item",
          icon: "×",
          iconColor: "var(--q-error)",
          label: "delete",
          labelColor: "var(--q-error)",
          onClick: () => deleteNode(menu!.nodeId, false),
        },
        {
          type: "item",
          icon: "×",
          iconColor: "var(--q-error)",
          label: "delete subtree",
          labelColor: "var(--q-error)",
          onClick: () => deleteNode(menu!.nodeId, true),
        },
      ]
    : [];

  const boardOptions = Array.from(new Set([...boards, activeBoard]));

  return (
    <div className="mindmap-pane">
      <div className="mindmap-toolbar">
        <select
          className="mindmap-board-select"
          value={activeBoard}
          onChange={(e) => setActiveBoard(e.target.value)}
        >
          {boardOptions.map((b) => (
            <option key={b} value={b} style={{ backgroundColor: "var(--q-bg)" }}>
              {b}
            </option>
          ))}
        </select>
        <button type="button" className="mindmap-tool-btn" onClick={() => setCreatingBoard(true)}>
          + board
        </button>
        <div className="mindmap-tool-spacer" />
        <button type="button" className="mindmap-tool-btn" onClick={() => openCreate("")}>
          + node
        </button>
        <button
          type="button"
          className="mindmap-tool-btn"
          onClick={() => {
            setEditDraft({
              id: "",
              kind: "note",
              label: "",
              text: "",
              status: "planned",
              note: "",
              progress: 0,
              parentId: "",
            });
            setEditIsNew(true);
          }}
        >
          + note
        </button>
      </div>

      <div className="mindmap-canvas">
        {nodesData.length === 0 ? (
          <div className="mindmap-empty">
            empty board — add a node or the agent will draw here as it works.
          </div>
        ) : (
          <ReactFlow
            nodes={nodesWithCtx}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.3}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
            nodesDraggable
            nodesConnectable
          >
            <Background color="var(--q-border-light)" gap={22} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>

      {editDraft && (
        <EditNodeModal
          draft={editDraft}
          isNew={editIsNew}
          parentOptions={parentOptions}
          onSubmit={submitEdit}
          onCancel={closeEdit}
        />
      )}

      {menu && ctxNode && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      {creatingBoard && (
        <BoardNameModal onSubmit={submitBoard} onCancel={() => setCreatingBoard(false)} />
      )}
    </div>
  );
}

function BoardNameModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--q-modal-backdrop)" }}
      onClick={onCancel}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(name);
        }}
        className="w-full max-w-xs p-6 flex flex-col gap-4"
        style={{
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <label className="block text-[10px] lowercase" style={{ color: "var(--q-fg-secondary)" }}>
          // new board
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="board name"
          className="nodrag px-2 py-1.5 text-xs"
          style={{
            backgroundColor: "var(--q-bg-hover)",
            border: "1px solid var(--q-border)",
            color: "var(--q-fg)",
            fontFamily: "'JetBrains Mono', monospace",
            outline: "none",
          }}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 text-[11px]"
            style={{ color: "var(--q-fg-secondary)", border: "1px solid var(--q-border)", backgroundColor: "transparent" }}
          >
            cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1 text-[11px]"
            style={{ color: "var(--q-bg)", backgroundColor: "var(--q-accent)", border: "1px solid var(--q-accent)" }}
          >
            create
          </button>
        </div>
      </form>
    </div>
  );
}

export function MindmapPane({ sessionId }: { sessionId: string }) {
  return (
    <ReactFlowProvider>
      <MindmapInner sessionId={sessionId} />
    </ReactFlowProvider>
  );
}
