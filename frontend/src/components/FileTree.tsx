import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Tree } from "react-arborist";
import type { NodeRendererProps, TreeApi } from "react-arborist";
import type { FileEntry } from "../types";
import { listDir, createFile, createDir, renamePath, deletePath } from "../api";
import { ContextMenu } from "./ContextMenu";
import type { MenuItem } from "./ContextMenu";
import { ConfirmModal } from "./ConfirmModal";
import { Icon } from "./Icon";
import { gitStatusColor, gitStatusLabel } from "./gitStatus";

// Tree node keyed by rel path. Dirs start with children: [] and are filled in
// on first expand (load-on-expand); files carry children: null so arborist
// treats them as leaves.
interface TreeNode {
  id: string;
  name: string;
  isDir: boolean;
  children: TreeNode[] | null;
}

interface Props {
  sessionId: string;
  openPath: string | null;
  dirtyPaths: ReadonlySet<string>;
  /** Git working-tree status keyed by rel path (M/A/D/R/?). */
  gitStatus?: ReadonlyMap<string, string>;
  refreshNonce: number;
  /** Case-insensitive substring filter over filenames (client-side, already-loaded tree). */
  filter?: string;
  onOpen: (path: string) => void;
  onPathDeleted: (path: string) => void;
  onPathRenamed: (oldPath: string, newPath: string) => void;
  /** Reports how many rows are currently visible under the active filter. */
  onMatchCount?: (count: number) => void;
  onError: (msg: string) => void;
}

// Imperative handle so the FilesPanel header can trigger the same create-file
// flow as the right-click context menu, scoped to the tree root.
export interface FileTreeHandle {
  createFileAtRoot: () => void;
}

function entryToNode(e: FileEntry): TreeNode {
  return { id: e.path, name: e.name, isDir: e.isDir, children: e.isDir ? [] : null };
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

// Keep already-loaded grandchildren when a parent dir is re-listed, so
// expanded subtrees don't collapse on refresh.
function mergeChildren(fresh: TreeNode[], old: TreeNode[] | null): TreeNode[] {
  if (!old) return fresh;
  const oldById = new Map(old.map((n) => [n.id, n]));
  return fresh.map((n) => {
    const prev = oldById.get(n.id);
    if (n.isDir && prev?.isDir && prev.children && prev.children.length > 0) {
      return { ...n, children: prev.children };
    }
    return n;
  });
}

function withChildren(nodes: TreeNode[], dirPath: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.id === dirPath) {
      return { ...n, children: mergeChildren(children, n.children) };
    }
    if (n.isDir && n.children && dirPath.startsWith(n.id + "/")) {
      return { ...n, children: withChildren(n.children, dirPath, children) };
    }
    return n;
  });
}

export const FileTree = forwardRef<FileTreeHandle, Props>(function FileTree({
  sessionId,
  openPath,
  dirtyPaths,
  gitStatus,
  refreshNonce,
  filter,
  onOpen,
  onPathDeleted,
  onPathRenamed,
  onMatchCount,
  onError,
}: Props, ref) {
  const [data, setData] = useState<TreeNode[]>([]);
  const loadedRef = useRef<Set<string>>(new Set());
  const treeRef = useRef<TreeApi<TreeNode> | null>(null);

  // react-arborist treats a non-empty searchTerm as "filter mode": only matching
  // rows (and their ancestors) stay visible. Trim so a whitespace-only query is no-op.
  const filterTerm = (filter ?? "").trim();

  // Context menu target: a node, or null for the tree background (root scope).
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null);
  // Pending "new file"/"new folder" name prompt (WKWebView has no window.prompt).
  const [naming, setNaming] = useState<{ kind: "file" | "dir"; parent: string } | null>(null);
  const [deleting, setDeleting] = useState<TreeNode | null>(null);

  // Same create-file flow the root-scope context menu uses (parent === "").
  useImperativeHandle(
    ref,
    () => ({ createFileAtRoot: () => setNaming({ kind: "file", parent: "" }) }),
    []
  );

  // react-arborist requires explicit pixel width/height.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const loadDir = useCallback(
    (dirPath: string) => {
      return listDir(sessionId, dirPath)
        .then((entries) => {
          const children = (entries ?? []).map(entryToNode);
          loadedRef.current.add(dirPath);
          setData((prev) =>
            dirPath === "" ? mergeChildren(children, prev) : withChildren(prev, dirPath, children)
          );
        })
        .catch((err) => onError(String(err)));
    },
    [sessionId, onError]
  );

  // Initial root listing; the refresh button re-lists every loaded dir.
  useEffect(() => {
    const dirs = refreshNonce === 0 ? [""] : Array.from(new Set(["", ...loadedRef.current]));
    dirs.forEach((d) => void loadDir(d));
  }, [loadDir, refreshNonce]);

  // Report how many already-loaded nodes match the active filter, so the panel
  // can show "N matches" / a no-match empty state. Counts every node whose name
  // contains the term (matching arborist's searchMatch), across loaded subtrees.
  useEffect(() => {
    if (!onMatchCount) return;
    if (!filterTerm) {
      onMatchCount(-1); // -1 = filter inactive
      return;
    }
    const needle = filterTerm.toLowerCase();
    let count = 0;
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.name.toLowerCase().includes(needle)) count++;
        if (n.children) walk(n.children);
      }
    };
    walk(data);
    onMatchCount(count);
  }, [filterTerm, data, onMatchCount]);

  // Live updates: re-list the affected parent dir on backend mutations.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w?.runtime?.EventsOn) {
      const cancel = w.runtime.EventsOn(
        "files:changed",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (d: any) => {
          if (!d || d.sessionId !== sessionId) return;
          const dir = typeof d.path === "string" ? d.path : "";
          if (dir === "" || loadedRef.current.has(dir)) void loadDir(dir);
        }
      );
      return () => cancel && cancel();
    }
  }, [sessionId, loadDir]);

  // Auto-reveal the open file: sequentially load each unloaded ancestor dir
  // (parents must be in `data` before children can attach), expand them, then
  // scroll the file into view (scrollTo waits internally for the row to
  // appear). The cancelled flag keeps rapid openPath changes from
  // interleaving their loads/expands.
  useEffect(() => {
    if (!openPath) return;
    let cancelled = false;
    const ancestors: string[] = [];
    for (
      let idx = openPath.indexOf("/");
      idx !== -1;
      idx = openPath.indexOf("/", idx + 1)
    ) {
      ancestors.push(openPath.slice(0, idx));
    }
    void (async () => {
      for (const dir of ancestors) {
        if (cancelled) return;
        if (!loadedRef.current.has(dir)) await loadDir(dir);
      }
      if (cancelled) return;
      for (const dir of ancestors) treeRef.current?.open(dir);
      void treeRef.current?.scrollTo(openPath);
    })();
    return () => {
      cancelled = true;
    };
  }, [openPath, loadDir]);

  function submitName(name: string) {
    const target = naming;
    setNaming(null);
    if (!target) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const rel = target.parent ? target.parent + "/" + trimmed : trimmed;
    const op = target.kind === "file" ? createFile : createDir;
    op(sessionId, rel)
      .then(() => loadDir(target.parent))
      .then(() => {
        if (target.kind === "file") onOpen(rel);
      })
      .catch((err) => onError(String(err)));
  }

  function confirmDelete() {
    const node = deleting;
    setDeleting(null);
    if (!node) return;
    deletePath(sessionId, node.id, node.isDir)
      .then(() => loadDir(parentOf(node.id)))
      .then(() => onPathDeleted(node.id))
      .catch((err) => onError(String(err)));
  }

  function handleRename(id: string, name: string) {
    const trimmed = name.trim();
    const parent = parentOf(id);
    const newRel = parent ? parent + "/" + trimmed : trimmed;
    if (!trimmed || newRel === id) return;
    renamePath(sessionId, id, newRel)
      .then(() => loadDir(parent))
      .then(() => onPathRenamed(id, newRel))
      .catch((err) => onError(String(err)));
  }

  const menuItems: MenuItem[] = menu
    ? [
        { type: "label", text: menu.node ? menu.node.name : "/" },
        ...(menu.node === null || menu.node.isDir
          ? ([
              {
                type: "item",
                icon: "+",
                iconColor: "var(--info)",
                label: "new file",
                onClick: () => setNaming({ kind: "file", parent: menu.node?.id ?? "" }),
              },
              {
                type: "item",
                icon: "+",
                iconColor: "var(--info)",
                label: "new folder",
                onClick: () => setNaming({ kind: "dir", parent: menu.node?.id ?? "" }),
              },
            ] as MenuItem[])
          : []),
        ...(menu.node
          ? ([
              {
                type: "item",
                icon: "✎",
                iconColor: "var(--accent)",
                label: "rename",
                onClick: () => treeRef.current?.get(menu.node!.id)?.edit(),
              },
              { type: "separator" },
              {
                type: "item",
                icon: "×",
                iconColor: "var(--danger)",
                label: "delete",
                labelColor: "var(--danger)",
                onClick: () => setDeleting(menu.node),
              },
            ] as MenuItem[])
          : []),
      ]
    : [];

  function Row({ node, style }: NodeRendererProps<TreeNode>) {
    const hidden = node.data.name.startsWith(".");
    const selected = openPath === node.data.id;
    const rowDirty = dirtyPaths.has(node.data.id);
    // VCS status for files (dirs never carry one). Distinct from rowDirty,
    // which is the unsaved editor-buffer marker — the two can coexist.
    const status = !node.data.isDir ? gitStatus?.get(node.data.id) : undefined;
    const statusColor = status ? gitStatusColor(status) : undefined;
    return (
      <div
        style={style}
        className={
          "files-row" +
          (selected ? " files-row--selected" : "") +
          (hidden ? " files-row--dim" : "")
        }
        onClick={() => (node.isInternal ? node.toggle() : onOpen(node.data.id))}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY, node: node.data });
        }}
      >
        <span className="files-row-caret">
          {node.isInternal ? (
            <Icon name={node.isOpen ? "chevronDown" : "chevronRight"} size={12} color="var(--fg-4)" />
          ) : null}
        </span>
        <span className="files-row-icon">
          <Icon
            name={node.data.isDir ? (node.isOpen ? "folderOpen" : "folder") : "file"}
            size={13}
            color={
              node.data.isDir
                ? "var(--fg-3)"
                : statusColor
                  ? statusColor
                  : rowDirty
                    ? "var(--warn)"
                    : "var(--fg-3)"
            }
          />
        </span>
        {node.isEditing ? (
          <input
            autoFocus
            defaultValue={node.data.name}
            className="files-row-input"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => node.reset()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") node.reset();
              if (e.key === "Enter") node.submit(e.currentTarget.value);
            }}
          />
        ) : (
          <span
            className={"files-row-name" + (node.data.isDir ? " files-row-name--dir" : "")}
            style={status ? { color: "var(--fg)" } : undefined}
          >
            {node.data.name}
          </span>
        )}
        {rowDirty && <span className="files-row-dirty mono" title="unsaved changes">M</span>}
        {status && (
          <span
            className="mono"
            title={`git: ${status}`}
            style={{
              flex: "none",
              width: 15,
              textAlign: "center",
              fontSize: 10.5,
              fontWeight: 700,
              color: statusColor,
            }}
          >
            {gitStatusLabel(status)}
          </span>
        )}
      </div>
    );
  }

  const deleteMessage = deleting
    ? `delete ${deleting.id}?` +
      (deleting.isDir ? "\neverything inside it will be permanently deleted." : "") +
      (Array.from(dirtyPaths).some(
        (p) => p === deleting.id || p.startsWith(deleting.id + "/")
      )
        ? "\nit has unsaved changes that will be lost."
        : "")
    : "";

  return (
    <div
      ref={wrapRef}
      className="files-tree-wrap"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, node: null });
      }}
    >
      <Tree<TreeNode>
        ref={treeRef}
        data={data}
        width={size.w}
        height={size.h}
        rowHeight={26}
        indent={14}
        openByDefault={false}
        disableDrag
        disableDrop
        disableMultiSelection
        searchTerm={filterTerm}
        searchMatch={(node, term) => node.data.name.toLowerCase().includes(term.toLowerCase())}
        onToggle={(id: string) => {
          if (!loadedRef.current.has(id)) void loadDir(id);
        }}
        onRename={({ id, name }) => handleRename(id, name)}
      >
        {Row}
      </Tree>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      {naming && (
        <NameModal
          title={naming.kind === "file" ? "new file" : "new folder"}
          placeholder={naming.parent ? naming.parent + "/…" : "name"}
          onSubmit={submitName}
          onCancel={() => setNaming(null)}
        />
      )}

      {deleting && (
        <ConfirmModal
          message={deleteMessage}
          confirmLabel="delete"
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
});

// In-app name prompt cloned from MindmapPane's BoardNameModal (no
// window.prompt in WKWebView).
function NameModal({
  title,
  placeholder,
  onSubmit,
  onCancel,
}: {
  title: string;
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--scrim)" }}
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
          backgroundColor: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r3)",
          fontFamily: "var(--mono)",
        }}
      >
        <label className="block text-[10px] lowercase" style={{ color: "var(--fg-2)" }}>
          // {title}
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          className="px-2 py-1.5 text-xs"
          style={{
            backgroundColor: "var(--panel-3)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r1)",
            color: "var(--fg)",
            fontFamily: "var(--mono)",
            outline: "none",
          }}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 text-[11px]"
            style={{ color: "var(--fg-2)", border: "1px solid var(--border)", borderRadius: "var(--r1)", backgroundColor: "transparent" }}
          >
            cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1 text-[11px]"
            style={{ color: "var(--on-accent)", backgroundColor: "var(--accent)", border: "1px solid var(--accent)", borderRadius: "var(--r1)" }}
          >
            create
          </button>
        </div>
      </form>
    </div>
  );
}
