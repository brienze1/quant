import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job, JobRun, UpdateJobRequest, Agent, JobGroup } from "../types";
import * as api from "../api";

type JobTab = "settings" | "history";
type RunTab = "session" | "result";

interface Props {
  jobs: Job[];
  agents: Agent[];
  jobGroups: JobGroup[];
  activeWorkspaceId: string;
  onCreateJob: () => void;
  onEditJob: (job: Job) => void;
  onRefreshJobs: () => void;
  onRefreshJobGroups: () => void;
}

const font = "'JetBrains Mono', monospace";
const NODE_W = 200;
const NODE_H = 52;
const CANVAS_POSITIONS_KEY = "quant-canvas-positions";

function relativeTime(dateStr: string): string {
  if (!dateStr) return "---";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  if (!ms) return "---";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

function statusColor(status: string): string {
  switch (status) {
    case "success": return "#10B981";
    case "running": return "#10B981";
    case "pending": return "#F59E0B";
    case "failed": return "#EF4444";
    case "cancelled": return "#6B7280";
    case "timed_out": return "#EF4444";
    default: return "#6B7280";
  }
}

const pulseKeyframes = `
@keyframes job-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
@keyframes edge-march {
  to { stroke-dashoffset: -11; }
}
@keyframes node-shake {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-0.8deg); }
  50% { transform: rotate(0.8deg); }
  75% { transform: rotate(-0.5deg); }
}
@keyframes node-shake-scared {
  0%, 100% { transform: rotate(0deg); }
  10% { transform: rotate(-3deg); }
  20% { transform: rotate(3deg); }
  30% { transform: rotate(-2.5deg); }
  40% { transform: rotate(2.5deg); }
  50% { transform: rotate(-2deg); }
  60% { transform: rotate(2deg); }
  70% { transform: rotate(-1.5deg); }
  80% { transform: rotate(1.5deg); }
  90% { transform: rotate(-1deg); }
}
@keyframes modal-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes modal-scale-in {
  from { opacity: 0; transform: scale(0.92); }
  to { opacity: 1; transform: scale(1); }
}
`;

type NodePositions = Record<string, { x: number; y: number }>;

function autoLayout(jobs: Job[]): NodePositions {
  const positions: NodePositions = {};
  if (jobs.length === 0) return positions;

  const jobIds = new Set(jobs.map((j) => j.id));

  // Build separate success/failure adjacency
  const successOut = new Map<string, string[]>();
  const allOut = new Map<string, string[]>();
  const allIn = new Map<string, string[]>();
  for (const job of jobs) {
    const succs = (job.onSuccess ?? []).filter((t) => jobIds.has(t));
    const fails = (job.onFailure ?? []).filter((t) => jobIds.has(t));
    successOut.set(job.id, succs);
    allOut.set(job.id, [...succs, ...fails]);
    if (!allIn.has(job.id)) allIn.set(job.id, []);
    for (const t of [...succs, ...fails]) {
      if (!allIn.has(t)) allIn.set(t, []);
      allIn.get(t)!.push(job.id);
    }
  }

  // Identify side-effect nodes: triggered by 3+ unique sources with no outgoing edges
  const sideEffectIds = new Set<string>();
  for (const job of jobs) {
    const inc = allIn.get(job.id) ?? [];
    const uniqueSources = new Set(inc).size;
    const out = allOut.get(job.id) ?? [];
    if (uniqueSources >= 3 && out.length === 0) {
      sideEffectIds.add(job.id);
    }
  }

  // Build layout adjacency (excluding side-effects as targets)
  const layoutOut = new Map<string, string[]>();
  const layoutSuccessOut = new Map<string, string[]>();
  const layoutIn = new Map<string, string[]>();
  for (const job of jobs) {
    if (sideEffectIds.has(job.id)) continue;
    const succs = (job.onSuccess ?? []).filter((t) => jobIds.has(t) && !sideEffectIds.has(t));
    const fails = (job.onFailure ?? []).filter((t) => jobIds.has(t) && !sideEffectIds.has(t));
    layoutSuccessOut.set(job.id, succs);
    layoutOut.set(job.id, [...succs, ...fails]);
    if (!layoutIn.has(job.id)) layoutIn.set(job.id, []);
    for (const t of [...succs, ...fails]) {
      if (!layoutIn.has(t)) layoutIn.set(t, []);
      layoutIn.get(t)!.push(job.id);
    }
  }

  // Find connected components (undirected, excluding side-effects)
  const mainJobs = jobs.filter((j) => !sideEffectIds.has(j.id));
  const componentOf = new Map<string, number>();
  let componentCount = 0;
  for (const job of mainJobs) {
    if (componentOf.has(job.id)) continue;
    const cid = componentCount++;
    const stack = [job.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (componentOf.has(id)) continue;
      componentOf.set(id, cid);
      for (const t of layoutOut.get(id) ?? []) if (!componentOf.has(t)) stack.push(t);
      for (const t of layoutIn.get(id) ?? []) if (!componentOf.has(t)) stack.push(t);
    }
  }

  const components: Job[][] = Array.from({ length: componentCount }, () => []);
  for (const job of mainJobs) {
    components[componentOf.get(job.id)!].push(job);
  }
  components.sort((a, b) => b.length - a.length);

  const hSpacing = 300;
  const vSpacing = 120;
  const componentGap = 100;
  const startX = 100;
  let currentY = 100;
  const positionedSideEffects = new Set<string>();

  for (const component of components) {
    const compIds = new Set(component.map((j) => j.id));

    // Find roots (no incoming from within component)
    const roots = component.filter((j) => {
      const inc = (layoutIn.get(j.id) ?? []).filter((i) => compIds.has(i));
      return inc.length === 0;
    });
    if (roots.length === 0) roots.push(component[0]);

    // Phase 1: Success-only BFS → identifies the "spine" (happy path)
    const spineIds = new Set<string>();
    const spineQueue: string[] = [];
    for (const r of roots) { spineIds.add(r.id); spineQueue.push(r.id); }
    const spineVisited = new Set<string>(spineQueue);
    while (spineQueue.length > 0) {
      const id = spineQueue.shift()!;
      for (const t of (layoutSuccessOut.get(id) ?? []).filter((t) => compIds.has(t))) {
        if (!spineVisited.has(t)) {
          spineVisited.add(t);
          spineIds.add(t);
          spineQueue.push(t);
        }
      }
    }

    // Phase 2: Full BFS (all edges) for depth assignment
    const depth = new Map<string, number>();
    const visited = new Set<string>();
    const queue: string[] = [];
    for (const r of roots) {
      depth.set(r.id, 0);
      visited.add(r.id);
      queue.push(r.id);
    }
    while (queue.length > 0) {
      const id = queue.shift()!;
      const d = depth.get(id)!;
      for (const t of (layoutOut.get(id) ?? []).filter((t) => compIds.has(t))) {
        if (!visited.has(t)) {
          visited.add(t);
          depth.set(t, d + 1);
          queue.push(t);
        }
      }
    }
    for (const job of component) {
      if (!depth.has(job.id)) depth.set(job.id, 0);
    }

    // Phase 3: Group by depth, separate spine (row 0) from branch (row 1+)
    const levels = new Map<number, { spine: string[]; branch: string[] }>();
    for (const [id, d] of depth.entries()) {
      if (!levels.has(d)) levels.set(d, { spine: [], branch: [] });
      const level = levels.get(d)!;
      if (spineIds.has(id)) level.spine.push(id);
      else level.branch.push(id);
    }

    // Position: spine nodes on top, branch nodes below with a gap
    const sortedDepths = [...levels.keys()].sort((a, b) => a - b);
    let maxRows = 0;
    for (const d of sortedDepths) {
      const { spine, branch } = levels.get(d)!;
      let row = 0;
      for (const id of spine) {
        positions[id] = { x: startX + d * hSpacing, y: currentY + row * vSpacing };
        row++;
      }
      if (branch.length > 0 && spine.length > 0) {
        row = Math.max(row, 1); // ensure gap between spine and branch
      }
      for (const id of branch) {
        positions[id] = { x: startX + d * hSpacing, y: currentY + row * vSpacing };
        row++;
      }
      maxRows = Math.max(maxRows, row);
    }

    // Phase 4: Position side-effects belonging to THIS component right below it
    const compSideEffects = jobs.filter((j) => {
      if (!sideEffectIds.has(j.id) || positionedSideEffects.has(j.id)) return false;
      const inc = allIn.get(j.id) ?? [];
      return inc.some((srcId) => compIds.has(srcId));
    });

    // Check if this component has backward edges (loops) — these dip below nodes
    let hasBackwardEdges = false;
    for (const j of component) {
      for (const t of [...(j.onSuccess ?? []), ...(j.onFailure ?? [])]) {
        const tPos = positions[t];
        const jPos = positions[j.id];
        if (tPos && jPos && tPos.x <= jPos.x + NODE_W + 10) {
          hasBackwardEdges = true;
          break;
        }
      }
      if (hasBackwardEdges) break;
    }
    // Extra space for backward edge curves (they dip ~100px below lowest node)
    const backwardEdgeSpace = hasBackwardEdges ? 100 : 0;

    if (compSideEffects.length > 0) {
      const seY = currentY + maxRows * vSpacing + backwardEdgeSpace + 20;
      const compPositions = component.map((j) => positions[j.id]).filter(Boolean);
      const avgX = compPositions.length > 0
        ? compPositions.reduce((s, p) => s + p.x, 0) / compPositions.length
        : startX;
      const totalWidth = compSideEffects.length * (NODE_W + 60) - 60;
      const seStartX = Math.max(avgX - totalWidth / 2, startX);
      for (let i = 0; i < compSideEffects.length; i++) {
        positions[compSideEffects[i].id] = { x: seStartX + i * (NODE_W + 60), y: seY };
        positionedSideEffects.add(compSideEffects[i].id);
      }
      currentY = seY + vSpacing;
    } else {
      currentY += maxRows * vSpacing + backwardEdgeSpace;
    }

    currentY += componentGap;
  }

  // Catch any unpositioned jobs
  const positioned = new Set(Object.keys(positions));
  const remaining = jobs.filter((j) => !positioned.has(j.id));
  for (let i = 0; i < remaining.length; i++) {
    positions[remaining[i].id] = { x: startX + i * (NODE_W + 60), y: currentY };
  }

  return positions;
}

function loadPositions(): NodePositions {
  try {
    const raw = localStorage.getItem(CANVAS_POSITIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function savePositions(positions: NodePositions) {
  try {
    localStorage.setItem(CANVAS_POSITIONS_KEY, JSON.stringify(positions));
  } catch { /* ignore */ }
}

export function JobsView({ jobs, agents, jobGroups, activeWorkspaceId, onCreateJob, onEditJob, onRefreshJobs, onRefreshJobGroups }: Props) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<JobTab>("settings");
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunTab, setSelectedRunTab] = useState<RunTab>("session");
  const [runOutput, setRunOutput] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [parentRunInfo, setParentRunInfo] = useState<{ jobName: string; result: string; metadata: string } | null>(null);
  const agentName = (id?: string) => {
    if (!id) return null;
    const a = agents.find((a) => a.id === id);
    return a ? a.name : null;
  };

  // Multi-select state
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const selectionBoxRef = useRef(selectionBox);
  selectionBoxRef.current = selectionBox;

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: { label: string; action: () => void }[] } | null>(null);
  const [groupNameInput, setGroupNameInput] = useState<string>("");
  const [showGroupNameInput, setShowGroupNameInput] = useState(false);

  // Groups sidebar state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);

  // Animation ref for animated pan/zoom
  const animFrameRef = useRef<number>(0);

  // Canvas state
  const [nodePositions, setNodePositions] = useState<NodePositions>(() => {
    const saved = loadPositions();
    return Object.keys(saved).length > 0 ? saved : {};
  });
  const [zoom, setZoom] = useState(1);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; nodeStartX: number; nodeStartY: number } | null>(null);
  const [panning, setPanning] = useState<{ startX: number; startY: number; offsetStartX: number; offsetStartY: number } | null>(null);
  const [canvasModalJobId, setCanvasModalJobId] = useState<string | null>(null);
  const [canvasModalTab, setCanvasModalTab] = useState<JobTab>("settings");
  const [connectingMode, setConnectingMode] = useState<{ type: "success" | "failure"; sourceId?: string } | null>(null);
  const [triggerDropdownOpen, setTriggerDropdownOpen] = useState(false);
  const [groupsSidebarWidth, setGroupsSidebarWidth] = useState(200);
  const [resizingSidebar, setResizingSidebar] = useState(false);

  // Sidebar resize drag
  useEffect(() => {
    if (!resizingSidebar) return;
    const handleMove = (e: MouseEvent) => {
      const newWidth = Math.max(140, Math.min(400, e.clientX));
      setGroupsSidebarWidth(newWidth);
    };
    const handleUp = () => setResizingSidebar(false);
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [resizingSidebar]);

  // Close trigger dropdown on outside click
  useEffect(() => {
    if (!triggerDropdownOpen) return;
    const handle = () => setTriggerDropdownOpen(false);
    const timer = setTimeout(() => document.addEventListener("click", handle), 0);
    return () => { clearTimeout(timer); document.removeEventListener("click", handle); };
  }, [triggerDropdownOpen]);
  const [connectMousePos, setConnectMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [runningJobIds, setRunningJobIds] = useState<Set<string>>(new Set());
  const [selectedEdge, setSelectedEdge] = useState<{ sourceId: string; targetId: string; type: "success" | "failure" } | null>(null);
  const [edgeDeleteHover, setEdgeDeleteHover] = useState(false);
  const [wavePhase, setWavePhase] = useState(0);
  const waveAmplitude = useRef(0);
  const waveSpeed = useRef(0);
  const waveFreq = useRef(0);
  const waveAnimRef = useRef<number>(0);
  const lastFrameTime = useRef(Date.now());
  const [flashingEdges, setFlashingEdges] = useState<Set<string>>(new Set()); // "sourceId->targetId" keys
  const didDrag = useRef(false);
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [dragDeleteHover, setDragDeleteHover] = useState(false);
  const deleteZoneRef = useRef<HTMLDivElement>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

  // For canvas modal, select the job so settings/history tabs work
  const canvasModalJob = jobs.find((j) => j.id === canvasModalJobId) ?? null;

  // Route highlighting: highlight running job + immediate next jobs, dim only same-flow jobs
  const routeState = useMemo(() => {
    if (runningJobIds.size === 0) return null;

    const routeNodes = new Set<string>();     // highlighted nodes (running + immediate next)
    const routeEdges = new Set<string>();     // highlighted edges (running -> immediate next)
    const flowNodes = new Set<string>();       // all nodes in the same flow (connected component)
    const jobMap = new Map(jobs.map((j) => [j.id, j]));

    // Build undirected adjacency for connected-component discovery
    const adj = new Map<string, Set<string>>();
    for (const j of jobs) {
      if (!adj.has(j.id)) adj.set(j.id, new Set());
      for (const t of (j.onSuccess ?? [])) {
        if (jobMap.has(t)) {
          adj.get(j.id)!.add(t);
          if (!adj.has(t)) adj.set(t, new Set());
          adj.get(t)!.add(j.id);
        }
      }
      for (const t of (j.onFailure ?? [])) {
        if (jobMap.has(t)) {
          adj.get(j.id)!.add(t);
          if (!adj.has(t)) adj.set(t, new Set());
          adj.get(t)!.add(j.id);
        }
      }
    }

    for (const runId of runningJobIds) {
      routeNodes.add(runId);
      const runJob = jobMap.get(runId);
      if (!runJob) continue;

      // BFS undirected to find entire connected component (flow)
      const visited = new Set<string>([runId]);
      const queue: string[] = [runId];
      while (queue.length > 0) {
        const nid = queue.shift()!;
        flowNodes.add(nid);
        for (const neighbor of (adj.get(nid) ?? [])) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      // Only highlight immediate next jobs (first hop)
      for (const t of (runJob.onSuccess ?? [])) {
        if (jobMap.has(t)) {
          routeNodes.add(t);
          routeEdges.add(`${runId}->${t}:success`);
        }
      }
      for (const t of (runJob.onFailure ?? [])) {
        if (jobMap.has(t)) {
          routeNodes.add(t);
          routeEdges.add(`${runId}->${t}:failure`);
        }
      }
    }

    return { routeNodes, routeEdges, flowNodes };
  }, [jobs, runningJobIds]);

  // Hover highlighting: find directly connected nodes
  const hoverConnectedNodes = useMemo(() => {
    if (!hoveredNodeId || connectingMode || canvasModalJobId) return null;
    const connected = new Set<string>([hoveredNodeId]);
    for (const job of jobs) {
      const succs = job.onSuccess ?? [];
      const fails = job.onFailure ?? [];
      if (job.id === hoveredNodeId) {
        succs.forEach((t) => connected.add(t));
        fails.forEach((t) => connected.add(t));
      } else {
        if (succs.includes(hoveredNodeId) || fails.includes(hoveredNodeId)) {
          connected.add(job.id);
        }
      }
    }
    return connected;
  }, [hoveredNodeId, jobs, connectingMode, canvasModalJobId]);

  // Precompute connected components for edge routing (so backward edges only scan their own pipeline)
  const jobComponentMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const jobIds = new Set(jobs.map((j) => j.id));
    const adj = new Map<string, string[]>();
    for (const job of jobs) {
      const targets = [...(job.onSuccess ?? []), ...(job.onFailure ?? [])].filter((t) => jobIds.has(t));
      adj.set(job.id, targets);
    }
    const visited = new Set<string>();
    for (const job of jobs) {
      if (visited.has(job.id)) continue;
      const component = new Set<string>();
      const stack = [job.id];
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        component.add(id);
        for (const t of adj.get(id) ?? []) if (!visited.has(t)) stack.push(t);
        // Also check reverse edges
        for (const j of jobs) {
          if ([...(j.onSuccess ?? []), ...(j.onFailure ?? [])].includes(id) && !visited.has(j.id)) {
            stack.push(j.id);
          }
        }
      }
      for (const id of component) map.set(id, component);
    }
    return map;
  }, [jobs]);

  // Initialize node positions on first render with jobs
  useEffect(() => {
    if (initializedRef.current) return;
    if (jobs.length === 0) return;
    initializedRef.current = true;

    const saved = loadPositions();
    const hasAllPositions = jobs.every((j) => saved[j.id]);
    if (hasAllPositions) {
      setNodePositions(saved);
    } else {
      const layout = autoLayout(jobs);
      setNodePositions(layout);
      savePositions(layout);
    }
  }, [jobs]);

  // When modal opens, set selectedJobId for tab rendering and fetch runs
  useEffect(() => {
    if (canvasModalJobId) {
      setSelectedJobId(canvasModalJobId);
    }
  }, [canvasModalJobId]);

  const fetchRuns = useCallback(async (jobId: string) => {
    try {
      const result = await api.listRunsByJob(jobId);
      setRuns(result ?? []);
    } catch (err) {
      console.error("failed to fetch runs:", err);
      setRuns([]);
    }
  }, []);

  const fetchOutput = useCallback(async (runId: string) => {
    try {
      const output = await api.getRunOutput(runId);
      setRunOutput(output ?? "");
    } catch (err) {
      console.error("failed to fetch run output:", err);
      setRunOutput("");
    }
  }, []);

  useEffect(() => {
    if (selectedJobId) {
      fetchRuns(selectedJobId);
      setSelectedRunId(null);
      setRunOutput("");
    } else {
      setRuns([]);
    }
  }, [selectedJobId, fetchRuns]);

  useEffect(() => {
    if (selectedRunId && selectedRunTab === "session") {
      fetchOutput(selectedRunId);
    }
  }, [selectedRunId, selectedRunTab, fetchOutput]);

  // Fetch parent run info when a triggered run is selected
  useEffect(() => {
    if (!selectedRun || !selectedRun.triggeredBy) {
      setParentRunInfo(null);
      return;
    }
    (async () => {
      try {
        const parentRun = await api.getRun(selectedRun.triggeredBy);
        const parentJob = jobs.find((j) => j.id === parentRun.jobId);
        const parentJobName = parentJob?.name || parentRun.jobId.slice(0, 8);
        let metadata = "";
        let result = parentRun.result || "";
        const metaSep = "\n\n--- metadata ---\n";
        const metaIdx = result.indexOf(metaSep);
        if (metaIdx >= 0) {
          metadata = result.slice(metaIdx + metaSep.length);
          result = result.slice(0, metaIdx);
        }
        setParentRunInfo({ jobName: parentJobName, result, metadata });
      } catch {
        setParentRunInfo(null);
      }
    })();
  }, [selectedRun?.id, selectedRun?.triggeredBy, jobs]);

  // Poll for updates when a running run is selected
  useEffect(() => {
    if (!selectedRun || selectedRun.status !== "running") return;
    if (!selectedJobId) return;

    const interval = setInterval(async () => {
      await fetchRuns(selectedJobId);
      if (selectedRunId && selectedRunTab === "session") {
        await fetchOutput(selectedRunId);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [selectedRun?.status, selectedJobId, selectedRunId, selectedRunTab, fetchRuns, fetchOutput]);

  // Animate wave on selected edge with smooth amplitude transitions
  const selectedEdgeRef = useRef(selectedEdge);
  selectedEdgeRef.current = selectedEdge;
  const edgeDeleteHoverRef = useRef(edgeDeleteHover);
  edgeDeleteHoverRef.current = edgeDeleteHover;

  useEffect(() => {
    let running = true;
    const animate = () => {
      if (!running) return;

      // Determine target values based on current state
      const hasEdge = !!selectedEdgeRef.current;
      const isScared = edgeDeleteHoverRef.current;

      const targetAmp = !hasEdge ? 0 : isScared ? 5 : 2;
      const targetSpeed = !hasEdge ? 0 : isScared ? 0.008 : 0.003;
      const targetFreq = !hasEdge ? 3 : isScared ? 5 : 3;

      // Smoothly lerp towards targets (0.08 = smooth, higher = faster transition)
      const lerpRate = 0.08;
      waveAmplitude.current += (targetAmp - waveAmplitude.current) * lerpRate;
      waveSpeed.current += (targetSpeed - waveSpeed.current) * lerpRate;
      waveFreq.current += (targetFreq - waveFreq.current) * lerpRate;

      // Snap to zero when very close
      if (Math.abs(waveAmplitude.current) < 0.05 && targetAmp === 0) {
        waveAmplitude.current = 0;
      }

      // Accumulate phase based on speed (not absolute time)
      const now = Date.now();
      const dt = now - lastFrameTime.current;
      lastFrameTime.current = now;
      setWavePhase((prev) => prev + waveSpeed.current * dt);
      waveAnimRef.current = requestAnimationFrame(animate);
    };

    waveAnimRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(waveAnimRef.current);
    };
  }, []);

  // Refresh jobs list periodically so canvas stays in sync with external changes (MCP, scheduler)
  useEffect(() => {
    const interval = setInterval(() => {
      onRefreshJobs();
    }, 10000);
    return () => clearInterval(interval);
  }, [onRefreshJobs]);

  // Poll for running jobs on the canvas and detect trigger firings
  const prevRunningRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (jobs.length === 0) return;

    const checkRunning = async () => {
      const running = new Set<string>();
      for (const job of jobs) {
        try {
          const jobRuns = await api.listRunsByJob(job.id);
          if (jobRuns?.some((r) => r.status === "running")) {
            running.add(job.id);
          }
        } catch { /* ignore */ }
      }

      // Detect jobs that just stopped running — flash only the trigger edges that match the outcome
      const prevRunning = prevRunningRef.current;
      for (const jobId of prevRunning) {
        if (!running.has(jobId)) {
          const job = jobs.find((j) => j.id === jobId);
          if (job) {
            // Check the latest run's actual status to determine which edges fired
            try {
              const latestRuns = await api.listRunsByJob(jobId);
              const latestRun = latestRuns?.[0];
              if (latestRun) {
                const edgeKeys = new Set<string>();
                if (latestRun.status === "success") {
                  for (const targetId of (job.onSuccess ?? [])) {
                    edgeKeys.add(`${jobId}->${targetId}`);
                  }
                } else if (latestRun.status === "failed") {
                  for (const targetId of (job.onFailure ?? [])) {
                    edgeKeys.add(`${jobId}->${targetId}`);
                  }
                }
                if (edgeKeys.size > 0) {
                  setFlashingEdges((prev) => new Set([...prev, ...edgeKeys]));
                  setTimeout(() => {
                    setFlashingEdges((prev) => {
                      const next = new Set(prev);
                      for (const k of edgeKeys) next.delete(k);
                      return next;
                    });
                  }, 1500);
                }
              }
            } catch { /* ignore */ }
          }
        }
      }

      prevRunningRef.current = running;
      setRunningJobIds(running);
    };

    checkRunning();
    const interval = setInterval(checkRunning, 5000);
    return () => clearInterval(interval);
  }, [jobs]);


  async function handleRunNow() {
    if (!selectedJobId) return;
    try {
      const run = await api.runJob(selectedJobId);
      await fetchRuns(selectedJobId);
      setSelectedTab("history");
      setSelectedRunId(run.id);
      setSelectedRunTab("session");
      onRefreshJobs();
    } catch (err) {
      console.error("failed to run job:", err);
    }
  }

  async function handleRunJobById(jobId: string) {
    try {
      const run = await api.runJob(jobId);
      // Set selectedJobId so the modal's history tab shows the new run
      setSelectedJobId(jobId);
      await fetchRuns(jobId);
      setSelectedRunId(run.id);
      setSelectedTab("history");
      setSelectedRunTab("session");
      onRefreshJobs();
    } catch (err) {
      console.error("failed to run job:", err);
    }
  }

  async function handleStopRun() {
    if (!selectedRunId || !selectedJobId) return;
    try {
      await api.cancelRun(selectedRunId);
      await fetchRuns(selectedJobId);
    } catch (err) {
      console.error("failed to stop run:", err);
    }
  }

  // Check if there's a running run for the selected job
  const hasRunningRun = runs.some((r) => r.status === "running");

  async function handleDelete() {
    if (!selectedJobId) return;
    try {
      await api.deleteJob(selectedJobId);
      setSelectedJobId(null);
      setCanvasModalJobId(null);
      onRefreshJobs();
    } catch (err) {
      console.error("failed to delete job:", err);
    }
  }

  // Keyboard handler for escape and space
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setConnectingMode(null);
        setCanvasModalJobId(null);
        setSelectedEdge(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedEdge && !canvasModalJobId) {
        // Delete the selected edge
        const sourceJob = jobs.find((j) => j.id === selectedEdge.sourceId);
        if (sourceJob) {
          api.updateJob({
            id: sourceJob.id,
            name: sourceJob.name,
            description: sourceJob.description,
            type: sourceJob.type as "claude" | "bash",
            workingDirectory: sourceJob.workingDirectory,
            scheduleEnabled: sourceJob.scheduleEnabled,
            scheduleType: sourceJob.scheduleType as "recurring" | "one_time",
            cronExpression: sourceJob.cronExpression,
            scheduleInterval: sourceJob.scheduleInterval,
            timeoutSeconds: sourceJob.timeoutSeconds,
            prompt: sourceJob.prompt,
            allowBypass: sourceJob.allowBypass,
            autonomousMode: sourceJob.autonomousMode,
            maxRetries: sourceJob.maxRetries,
            model: sourceJob.model,
            overrideRepoCommand: sourceJob.overrideRepoCommand,
            claudeCommand: sourceJob.claudeCommand,
            successPrompt: sourceJob.successPrompt,
            failurePrompt: sourceJob.failurePrompt,
            metadataPrompt: sourceJob.metadataPrompt,
            interpreter: sourceJob.interpreter,
            scriptContent: sourceJob.scriptContent,
            envVariables: sourceJob.envVariables,
            onSuccess: selectedEdge.type === "success"
              ? sourceJob.onSuccess.filter((id) => id !== selectedEdge.targetId)
              : sourceJob.onSuccess,
            onFailure: selectedEdge.type === "failure"
              ? sourceJob.onFailure.filter((id) => id !== selectedEdge.targetId)
              : sourceJob.onFailure,
          }).then(() => {
            setSelectedEdge(null);
            onRefreshJobs();
          }).catch((err) => console.error("failed to delete trigger:", err));
        }
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === " " && !canvasModalJobId && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        setSpaceDown(true);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === " ") setSpaceDown(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [canvasModalJobId]);

  // Global mouse handlers for drag, pan, and selection box
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (dragging) {
        const dx = (e.clientX - dragging.startX) / zoom;
        const dy = (e.clientY - dragging.startY) / zoom;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          didDrag.current = true;
          setIsDraggingNode(true);
        }
        setNodePositions((prev) => ({
          ...prev,
          [dragging.id]: { x: dragging.nodeStartX + dx, y: dragging.nodeStartY + dy },
        }));
        // Check if hovering over delete zone
        if (deleteZoneRef.current) {
          const rect = deleteZoneRef.current.getBoundingClientRect();
          const over = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
          setDragDeleteHover(over);
        }
      }
      if (panning) {
        const dx = e.clientX - panning.startX;
        const dy = e.clientY - panning.startY;
        setCanvasOffset({ x: panning.offsetStartX + dx, y: panning.offsetStartY + dy });
      }
      // Selection box drag
      if (selectionBoxRef.current) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const worldX = (e.clientX - rect.left - canvasOffset.x) / zoom;
          const worldY = (e.clientY - rect.top - canvasOffset.y) / zoom;
          const sb = selectionBoxRef.current;
          const updated = { ...sb, currentX: worldX, currentY: worldY };
          setSelectionBox(updated);

          // Compute which jobs intersect the selection rect
          const boxMinX = Math.min(sb.startX, worldX);
          const boxMaxX = Math.max(sb.startX, worldX);
          const boxMinY = Math.min(sb.startY, worldY);
          const boxMaxY = Math.max(sb.startY, worldY);

          const selected = new Set<string>();
          for (const job of jobs) {
            const pos = nodePositions[job.id];
            if (!pos) continue;
            const nodeMinX = pos.x;
            const nodeMaxX = pos.x + NODE_W;
            const nodeMinY = pos.y;
            const nodeMaxY = pos.y + NODE_H;
            if (nodeMaxX >= boxMinX && nodeMinX <= boxMaxX && nodeMaxY >= boxMinY && nodeMinY <= boxMaxY) {
              selected.add(job.id);
            }
          }
          setSelectedJobIds(selected);
        }
      }
    }
    function onMouseUp(e: MouseEvent) {
      if (dragging) {
        // Check if dropped on delete zone
        if (deleteZoneRef.current && didDrag.current) {
          const rect = deleteZoneRef.current.getBoundingClientRect();
          const over = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
          if (over) {
            const jobId = dragging.id;
            api.deleteJob(jobId).then(() => {
              onRefreshJobs();
            }).catch((err) => console.error("failed to delete job:", err));
          }
        }
        setDragDeleteHover(false);
        setIsDraggingNode(false);
        setDragging(null);
        setNodePositions((prev) => {
          savePositions(prev);
          return prev;
        });
      }
      if (panning) {
        setPanning(null);
      }
      // Finalize selection box
      if (selectionBoxRef.current) {
        const sb = selectionBoxRef.current;
        const dx = Math.abs(sb.currentX - sb.startX);
        const dy = Math.abs(sb.currentY - sb.startY);
        // If it was just a click (no significant drag), clear selection
        if (dx < 5 && dy < 5) {
          setSelectedJobIds(new Set());
        }
        setSelectionBox(null);
      }
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, panning, zoom, jobs, nodePositions, canvasOffset]);

  async function handleNodeClick(jobId: string) {
    if (!connectingMode) return;
    if (!connectingMode.sourceId) {
      setConnectingMode({ ...connectingMode, sourceId: jobId });
      return;
    }
    // Create the connection
    const sourceJob = jobs.find((j) => j.id === connectingMode.sourceId);
    if (!sourceJob || connectingMode.sourceId === jobId) {
      setConnectingMode(null);
      return;
    }

    const updateReq: UpdateJobRequest = {
      id: sourceJob.id,
      name: sourceJob.name,
      description: sourceJob.description,
      type: sourceJob.type,
      workingDirectory: sourceJob.workingDirectory,
      scheduleEnabled: sourceJob.scheduleEnabled,
      scheduleType: sourceJob.scheduleType,
      cronExpression: sourceJob.cronExpression,
      scheduleInterval: sourceJob.scheduleInterval,
      timeoutSeconds: sourceJob.timeoutSeconds,
      prompt: sourceJob.prompt,
      allowBypass: sourceJob.allowBypass,
      autonomousMode: sourceJob.autonomousMode,
      maxRetries: sourceJob.maxRetries,
      model: sourceJob.model,
      overrideRepoCommand: sourceJob.overrideRepoCommand,
      claudeCommand: sourceJob.claudeCommand,
      successPrompt: sourceJob.successPrompt,
      failurePrompt: sourceJob.failurePrompt,
      metadataPrompt: sourceJob.metadataPrompt,
      interpreter: sourceJob.interpreter,
      scriptContent: sourceJob.scriptContent,
      envVariables: sourceJob.envVariables,
      onSuccess: [...sourceJob.onSuccess],
      onFailure: [...sourceJob.onFailure],
    };

    if (connectingMode.type === "success") {
      if (!updateReq.onSuccess.includes(jobId)) {
        updateReq.onSuccess.push(jobId);
      }
    } else {
      if (!updateReq.onFailure.includes(jobId)) {
        updateReq.onFailure.push(jobId);
      }
    }

    try {
      await api.updateJob(updateReq);
      onRefreshJobs();
    } catch (err) {
      console.error("failed to create connection:", err);
    }
    setConnectingMode(null);
  }

  function handleAutoLayout() {
    const layout = autoLayout(jobs);
    setNodePositions(layout);
    savePositions(layout);
  }

  function handleFitView() {
    if (jobs.length === 0 || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const allPos = jobs.map((j) => nodePositions[j.id] ?? { x: 0, y: 0 });
    if (allPos.length === 0) return;

    const minX = Math.min(...allPos.map((p) => p.x));
    const maxX = Math.max(...allPos.map((p) => p.x + NODE_W));
    const minY = Math.min(...allPos.map((p) => p.y));
    const maxY = Math.max(...allPos.map((p) => p.y + NODE_H));

    const contentW = maxX - minX + 200;
    const contentH = maxY - minY + 200;

    const scaleX = rect.width / contentW;
    const scaleY = rect.height / contentH;
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 2);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setZoom(newZoom);
    setCanvasOffset({
      x: rect.width / 2 - centerX * newZoom,
      y: rect.height / 2 - centerY * newZoom,
    });
  }

  // Animated pan/zoom
  function animateToView(targetZoom: number, targetOffset: { x: number; y: number }, duration = 500) {
    cancelAnimationFrame(animFrameRef.current);
    const startZoom = zoom;
    const startOffset = { ...canvasOffset };
    const startTime = Date.now();

    function easeInOutQuad(t: number): number {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function step() {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const e = easeInOutQuad(t);

      setZoom(startZoom + (targetZoom - startZoom) * e);
      setCanvasOffset({
        x: startOffset.x + (targetOffset.x - startOffset.x) * e,
        y: startOffset.y + (targetOffset.y - startOffset.y) * e,
      });

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      }
    }

    animFrameRef.current = requestAnimationFrame(step);
  }

  function focusOnJob(jobId: string) {
    const pos = nodePositions[jobId];
    if (!pos || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const targetZoom = 1.0;
    const centerX = pos.x + NODE_W / 2;
    const centerY = pos.y + NODE_H / 2;
    animateToView(targetZoom, {
      x: rect.width / 2 - centerX * targetZoom,
      y: rect.height / 2 - centerY * targetZoom,
    });
  }

  function focusOnGroup(group: JobGroup) {
    if (!canvasRef.current || group.jobIds.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const positions = group.jobIds.map((id) => nodePositions[id]).filter(Boolean);
    if (positions.length === 0) return;

    const minX = Math.min(...positions.map((p) => p.x));
    const maxX = Math.max(...positions.map((p) => p.x + NODE_W));
    const minY = Math.min(...positions.map((p) => p.y));
    const maxY = Math.max(...positions.map((p) => p.y + NODE_H));

    const padding = 100;
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;

    const scaleX = rect.width / contentW;
    const scaleY = rect.height / contentH;
    const targetZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 2);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    animateToView(targetZoom, {
      x: rect.width / 2 - centerX * targetZoom,
      y: rect.height / 2 - centerY * targetZoom,
    });
  }

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    function handleClick() { setContextMenu(null); setShowGroupNameInput(false); setGroupNameInput(""); }
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [contextMenu]);

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) {
      // Cmd/Ctrl + scroll = zoom towards mouse position
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? -0.03 : 0.03;
      const oldZoom = zoom;
      const newZoom = Math.min(Math.max(oldZoom + delta, 0.25), 2);
      // Adjust offset so the world point under the cursor stays fixed
      const worldX = (mouseX - canvasOffset.x) / oldZoom;
      const worldY = (mouseY - canvasOffset.y) / oldZoom;
      setCanvasOffset({
        x: mouseX - worldX * newZoom,
        y: mouseY - worldY * newZoom,
      });
      setZoom(newZoom);
    } else {
      // Normal scroll = pan
      setCanvasOffset((prev) => ({
        x: prev.x - e.deltaX - (e.shiftKey ? e.deltaY : 0),
        y: prev.y - (e.shiftKey ? 0 : e.deltaY),
      }));
    }
  }

  function handleCanvasMouseDown(e: React.MouseEvent) {
    // Middle mouse button or space+left click for panning
    if (e.button === 1 || (spaceDown && e.button === 0)) {
      e.preventDefault();
      setPanning({
        startX: e.clientX,
        startY: e.clientY,
        offsetStartX: canvasOffset.x,
        offsetStartY: canvasOffset.y,
      });
      return;
    }
    // Left click on empty canvas (not on node, not connecting) -> start selection box
    if (e.button === 0 && !connectingMode && !spaceDown && e.target === e.currentTarget) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const worldX = (e.clientX - rect.left - canvasOffset.x) / zoom;
      const worldY = (e.clientY - rect.top - canvasOffset.y) / zoom;
      setSelectionBox({ startX: worldX, startY: worldY, currentX: worldX, currentY: worldY });
    }
  }



  function renderKeyValue(key: string, value: string | number | boolean | string[] | undefined | null) {
    let displayValue: string;
    let color = "#FAFAFA";

    if (value === undefined || value === null || value === "") {
      displayValue = "---";
      color = "#6B7280";
    } else if (typeof value === "boolean") {
      displayValue = value ? "true" : "false";
      color = value ? "#10B981" : "#EF4444";
    } else if (Array.isArray(value)) {
      displayValue = value.length > 0 ? value.join(", ") : "---";
      if (value.length === 0) color = "#6B7280";
    } else {
      displayValue = String(value);
    }

    return (
      <div
        key={key}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11, fontFamily: font }}
      >
        <span style={{ color: "#6B7280" }}>{key}:</span>
        <span style={{ color, textAlign: "right", wordBreak: "break-all" }}>{displayValue}</span>
      </div>
    );
  }

  function renderSection(title: string, rows: React.ReactNode) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ color: "#4B5563", fontSize: 10, fontFamily: font }}>
          # {title}
        </span>
        <div style={{ height: 1, backgroundColor: "#2a2a2a" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows}
        </div>
      </div>
    );
  }

  function renderSettingsTab() {
    if (!selectedJob) return null;

    return (
      <div
        className="flex-1 overflow-y-auto"
        style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}
      >
        {renderSection("general", <>
          {renderKeyValue("type", selectedJob.type)}
          {renderKeyValue("name", selectedJob.name)}
          {renderKeyValue("description", selectedJob.description)}
          {renderKeyValue("working_dir", selectedJob.workingDirectory)}
        </>)}

        {renderSection("schedule", <>
          {renderKeyValue("enabled", selectedJob.scheduleEnabled)}
          {renderKeyValue("type", selectedJob.scheduleType)}
          {renderKeyValue("interval", selectedJob.scheduleInterval ? `${selectedJob.scheduleInterval}m` : "")}
          {renderKeyValue("cron", selectedJob.cronExpression)}
          {renderKeyValue("timeout", selectedJob.timeoutSeconds ? `${selectedJob.timeoutSeconds}s` : "")}
        </>)}

        {renderSection("triggers", <>
          {renderKeyValue("on_success", selectedJob.onSuccess)}
          {renderKeyValue("on_failure", selectedJob.onFailure)}
          {renderKeyValue("triggered_by", selectedJob.triggeredBy.length > 0
            ? selectedJob.triggeredBy.map((ref) => {
                const j = jobs.find((jj) => jj.id === ref.jobId);
                return `${j?.name ?? ref.jobId.slice(0, 8)} (${ref.triggerOn})`;
              }).join(", ")
            : "")}
        </>)}

        {selectedJob.type === "claude"
          ? <>
            {renderSection("session", <>
              {renderKeyValue("agent", agentName(selectedJob.agentId) || "none")}
              {renderKeyValue("model", selectedJob.model)}
              {renderKeyValue("max_retries", selectedJob.maxRetries)}
              {renderKeyValue("override_repo_command", selectedJob.overrideRepoCommand)}
              {renderKeyValue("claude_command", selectedJob.claudeCommand)}
            </>)}
            {renderSection("prompts", <>
              {renderKeyValue("task_prompt", selectedJob.prompt)}
              {renderKeyValue("success_criteria", selectedJob.successPrompt)}
              {renderKeyValue("failure_criteria", selectedJob.failurePrompt)}
              {renderKeyValue("metadata_prompt", selectedJob.metadataPrompt)}
            </>)}
          </>
          : renderSection("script", <>
              {renderKeyValue("interpreter", selectedJob.interpreter)}
              {renderKeyValue("script_content", selectedJob.scriptContent)}
            </>)
        }
      </div>
    );
  }

  function renderHistoryTab() {
    return (
      <div className="flex flex-1 overflow-hidden">
        {/* Runs sub-sidebar */}
        <div
          className="flex flex-col h-full shrink-0 overflow-y-auto"
          style={{ width: 220, borderRight: "1px solid #2a2a2a" }}
        >
          {runs.length === 0 ? (
            <div className="flex items-center justify-center p-4">
              <span style={{ color: "#6B7280", fontSize: 11, fontFamily: font }}>no runs yet</span>
            </div>
          ) : (
            runs.map((run) => {
              const active = run.id === selectedRunId;
              const canRerun = run.status !== "running" && run.status !== "pending";
              return (
                <div
                  key={run.id}
                  className="flex items-center w-full transition-colors"
                  style={{
                    backgroundColor: active ? "#1F1F1F" : "transparent",
                    fontFamily: font,
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = "#1F1F1F"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <button
                    onClick={() => { setSelectedRunId(run.id); setSelectedRunTab("session"); }}
                    className="flex items-center gap-2 flex-1 px-3 py-2 text-left"
                    style={{ background: "none", border: "none", cursor: "pointer", fontFamily: font, minWidth: 0 }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: statusColor(run.status),
                        flexShrink: 0,
                        animation: run.status === "running" ? "job-pulse 1.5s ease-in-out infinite" : "none",
                      }}
                    />
                    <div className="flex flex-col overflow-hidden" style={{ gap: 2 }}>
                      <span style={{ color: "#FAFAFA", fontSize: 11, fontFamily: font }}>
                        {run.id.slice(0, 8)}
                      </span>
                      <span style={{ color: "#6B7280", fontSize: 9, fontFamily: font }}>
                        {relativeTime(run.startedAt)}
                      </span>
                    </div>
                  </button>
                  {canRerun && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!selectedJobId) return;
                        try {
                          const newRun = await api.rerunJob(selectedJobId, run.id);
                          await fetchRuns(selectedJobId);
                          setSelectedRunId(newRun.id);
                          setSelectedRunTab("session");
                          onRefreshJobs();
                        } catch (err) {
                          console.error("failed to rerun job:", err);
                        }
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#6B7280",
                        fontSize: 10,
                        fontFamily: font,
                        padding: "4px 8px",
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#10B981")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
                      title="rerun this job"
                    >
                      &#8635;
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Run detail area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedRun ? (
            <div className="flex items-center justify-center flex-1">
              <span style={{ color: "#6B7280", fontSize: 11, fontFamily: font }}>select a run</span>
            </div>
          ) : (
            <>
              {/* Run sub-tabs */}
              <div className="flex" style={{ borderBottom: "1px solid #2a2a2a" }}>
                {(["session", "result"] as RunTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setSelectedRunTab(t)}
                    className="flex items-center justify-center px-4 py-2 text-[10px] lowercase transition-colors"
                    style={{
                      fontFamily: font,
                      fontWeight: selectedRunTab === t ? 500 : "normal",
                      color: selectedRunTab === t ? "#10B981" : "#6B7280",
                      borderBottom: selectedRunTab === t ? "2px solid #10B981" : "2px solid transparent",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Sub-tab content */}
              {selectedRunTab === "session" ? (
                <div className="flex-1 overflow-y-auto p-4" style={{ position: "relative" }}>
                  {runOutput && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(runOutput);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      style={{
                        position: "sticky",
                        top: 0,
                        float: "right",
                        background: "none",
                        border: "1px solid #2a2a2a",
                        borderRadius: 4,
                        padding: "4px 8px",
                        cursor: "pointer",
                        color: copied ? "#10B981" : "#6B7280",
                        fontSize: 10,
                        fontFamily: font,
                        zIndex: 1,
                      }}
                      onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "#FAFAFA"; }}
                      onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "#6B7280"; }}
                      title="copy output"
                    >
                      {copied ? "✓ copied" : "⧉ copy"}
                    </button>
                  )}
                  {selectedRun.status === "running" && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            backgroundColor: "#10B981",
                            animation: "job-pulse 1.5s ease-in-out infinite",
                            display: "inline-block",
                          }}
                        />
                        <span style={{ color: "#10B981", fontSize: 11, fontFamily: font }}>
                          {runOutput ? "running... output updating every 3s" : "running..."}
                        </span>
                      </div>
                      {selectedJob && (
                        <div
                          style={{
                            backgroundColor: "#0D0D0D",
                            border: "1px solid #1a1a1a",
                            borderRadius: 4,
                            padding: "10px 12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                          }}
                        >
                          <div style={{ display: "flex", gap: 8, fontSize: 10, fontFamily: font }}>
                            <span style={{ color: "#6B7280" }}>type</span>
                            <span style={{ color: "#9CA3AF" }}>{selectedJob.type}</span>
                            {selectedJob.model && <>
                              <span style={{ color: "#6B7280", marginLeft: 8 }}>model</span>
                              <span style={{ color: "#9CA3AF" }}>{selectedJob.model}</span>
                            </>}
                            {selectedJob.agentId && <>
                              <span style={{ color: "#6B7280", marginLeft: 8 }}>agent</span>
                              <span style={{ color: "#10B981" }}>{agentName(selectedJob.agentId) || selectedJob.agentId.slice(0, 8)}</span>
                            </>}
                          </div>
                          {selectedRun.triggeredBy && parentRunInfo && (
                            <div style={{ display: "flex", gap: 8, fontSize: 10, fontFamily: font }}>
                              <span style={{ color: "#6B7280" }}>triggered_by</span>
                              <span style={{ color: "#9CA3AF" }}>{parentRunInfo.jobName}</span>
                            </div>
                          )}
                          {selectedJob.type === "claude" && selectedJob.prompt && (
                            <div style={{ fontSize: 10, fontFamily: font, marginTop: 2 }}>
                              <span style={{ color: "#6B7280" }}>prompt </span>
                              <span style={{ color: "#9CA3AF", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {selectedJob.prompt.length > 300 ? selectedJob.prompt.slice(0, 300) + "..." : selectedJob.prompt}
                              </span>
                            </div>
                          )}
                          {selectedJob.type === "bash" && selectedJob.scriptContent && (
                            <div style={{ fontSize: 10, fontFamily: font, marginTop: 2 }}>
                              <span style={{ color: "#6B7280" }}>script </span>
                              <span style={{ color: "#9CA3AF", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {selectedJob.scriptContent.length > 300 ? selectedJob.scriptContent.slice(0, 300) + "..." : selectedJob.scriptContent}
                              </span>
                            </div>
                          )}
                          {parentRunInfo?.metadata && (
                            <div style={{ fontSize: 10, fontFamily: font, marginTop: 2 }}>
                              <span style={{ color: "#6B7280" }}>received_metadata </span>
                              <span style={{ color: "#10B981", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {parentRunInfo.metadata.length > 500 ? parentRunInfo.metadata.slice(0, 500) + "..." : parentRunInfo.metadata}
                              </span>
                            </div>
                          )}
                          {parentRunInfo && !parentRunInfo.metadata && parentRunInfo.result && (
                            <div style={{ fontSize: 10, fontFamily: font, marginTop: 2 }}>
                              <span style={{ color: "#6B7280" }}>received_output </span>
                              <span style={{ color: "#9CA3AF", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {parentRunInfo.result.length > 500 ? parentRunInfo.result.slice(parentRunInfo.result.length - 500) + "..." : parentRunInfo.result}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <pre
                    style={{
                      color: "#FAFAFA",
                      fontSize: 11,
                      fontFamily: font,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      margin: 0,
                    }}
                  >
                    {runOutput || (selectedRun.status !== "running" ? "no output available" : "")}
                  </pre>
                </div>
              ) : (
                <div
                  className="flex-1 overflow-y-auto"
                  style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}
                >
                  {renderSection("execution", <>
                    {renderKeyValue("run_id", selectedRun.id)}
                    {renderKeyValue("status", selectedRun.status)}
                    {renderKeyValue("triggered_by", parentRunInfo ? parentRunInfo.jobName : selectedRun.triggeredBy || "manual")}
                    {renderKeyValue("started", selectedRun.startedAt ? new Date(selectedRun.startedAt).toLocaleString() : "---")}
                    {selectedRun.finishedAt && renderKeyValue("finished", new Date(selectedRun.finishedAt).toLocaleString())}
                    {renderKeyValue("duration", formatDuration(selectedRun.durationMs))}
                    {selectedRun.modelUsed && renderKeyValue("model", selectedRun.modelUsed)}
                    {selectedRun.tokensUsed > 0 && renderKeyValue("tokens_used", selectedRun.tokensUsed.toLocaleString())}
                  </>)}

                  {selectedJob && renderSection("input", <>
                    {renderKeyValue("type", selectedJob.type)}
                    {selectedJob.agentId && renderKeyValue("agent", agentName(selectedJob.agentId) || selectedJob.agentId.slice(0, 8))}
                    {selectedJob.model && renderKeyValue("model", selectedJob.model)}
                    {selectedJob.type === "claude" && selectedJob.prompt && renderKeyValue("prompt", selectedJob.prompt)}
                    {selectedJob.type === "bash" && selectedJob.scriptContent && renderKeyValue("script", selectedJob.scriptContent)}
                    {selectedJob.claudeCommand && renderKeyValue("claude_command", selectedJob.claudeCommand)}
                    {selectedJob.overrideRepoCommand && renderKeyValue("repo_command", selectedJob.overrideRepoCommand)}
                  </>)}

                  {parentRunInfo?.metadata && renderSection("received_metadata",
                    <pre style={{ color: "#10B981", fontSize: 11, fontFamily: font, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                      {parentRunInfo.metadata}
                    </pre>
                  )}

                  {parentRunInfo && !parentRunInfo.metadata && parentRunInfo.result && renderSection("received_output",
                    <pre style={{ color: "#9CA3AF", fontSize: 11, fontFamily: font, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                      {parentRunInfo.result.length > 1000 ? "..." + parentRunInfo.result.slice(parentRunInfo.result.length - 1000) : parentRunInfo.result}
                    </pre>
                  )}

                  {(() => {
                    const result = selectedRun.result || "";
                    const metaSep = "\n\n--- metadata ---\n";
                    const metaIdx = result.indexOf(metaSep);
                    const metadata = metaIdx >= 0 ? result.slice(metaIdx + metaSep.length) : "";
                    return metadata ? renderSection("output_metadata",
                      <pre style={{ color: "#10B981", fontSize: 11, fontFamily: font, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                        {metadata}
                      </pre>
                    ) : null;
                  })()}

                  {selectedRun.sessionId && renderSection("triggered_sessions",
                    <div style={{ fontSize: 11, fontFamily: font }}>
                      <span style={{ color: "#10B981", cursor: "pointer" }}>
                        {selectedRun.sessionId}
                      </span>
                    </div>
                  )}

                  {selectedRun.errorMessage && renderSection("error",
                    <span style={{ color: "#EF4444", fontSize: 11, fontFamily: font }}>
                      {selectedRun.errorMessage}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // Generate a smooth wavy path between two points — like a vibrating rope
  function wavyPath(sx: number, sy: number, tx: number, ty: number, cx1: number, cy1: number, cx2: number, cy2: number, time: number, amplitude: number, frequency: number): string {
    const steps = 40;
    const points: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Base bezier curve position (cubic)
      const mt = 1 - t;
      const bx = mt*mt*mt*sx + 3*mt*mt*t*cx1 + 3*mt*t*t*cx2 + t*t*t*tx;
      const by = mt*mt*mt*sy + 3*mt*mt*t*cy1 + 3*mt*t*t*cy2 + t*t*t*ty;
      // Sine wave perpendicular to the curve, fading at endpoints (rope fixed at ends)
      const envelope = Math.sin(t * Math.PI); // 0 at ends, 1 at middle
      const wave = Math.sin(t * Math.PI * frequency + time) * amplitude * envelope;
      // Calculate normal direction (perpendicular to tangent)
      const dt = 0.01;
      const t2 = Math.min(t + dt, 1);
      const mt2 = 1 - t2;
      const bx2 = mt2*mt2*mt2*sx + 3*mt2*mt2*t2*cx1 + 3*mt2*t2*t2*cx2 + t2*t2*t2*tx;
      const by2 = mt2*mt2*mt2*sy + 3*mt2*mt2*t2*cy1 + 3*mt2*t2*t2*cy2 + t2*t2*t2*ty;
      const dx = bx2 - bx;
      const dy = by2 - by;
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      // Normal is perpendicular to tangent
      const nx = -dy / len;
      const ny = dx / len;
      const px = bx + nx * wave;
      const py = by + ny * wave;
      points.push(i === 0 ? `M ${px},${py}` : `L ${px},${py}`);
    }
    return points.join(" ");
  }

  function renderSvgConnections() {
    const lines: React.ReactNode[] = [];
    let keyIdx = 0;

    for (const job of jobs) {
      const sourcePos = nodePositions[job.id];
      if (!sourcePos) continue;

      const drawEdge = (targetId: string, edgeType: "success" | "failure") => {
        const targetPos = nodePositions[targetId];
        if (!targetPos) return;

        const edgeColor = edgeType === "success" ? "#10B981" : "#EF4444";
        const k = keyIdx++;
        const isSelected = selectedEdge?.sourceId === job.id && selectedEdge?.targetId === targetId && selectedEdge?.type === edgeType;
        const isFlashing = flashingEdges.has(`${job.id}->${targetId}`);
        const isAnimated = isSelected || isFlashing;

        // Free port connection: find best exit/entry points on any side of the nodes
        // Source center and target center
        const sCx = sourcePos.x + NODE_W / 2;
        const sCy = sourcePos.y + NODE_H / 2;
        const tCx = targetPos.x + NODE_W / 2;
        const tCy = targetPos.y + NODE_H / 2;
        const dx = tCx - sCx;
        const dy = tCy - sCy;
        const pad = 2; // small gap so arrow doesn't overlap border

        // Pick exit port on source node (closest side towards target center)
        let sx: number, sy: number;
        const sAspect = (NODE_W / 2) / (NODE_H / 2);
        if (Math.abs(dx) > Math.abs(dy) * sAspect) {
          // Horizontal dominant: exit left or right
          sx = dx > 0 ? sourcePos.x + NODE_W + pad : sourcePos.x - pad;
          sy = sCy + (dy / Math.abs(dx)) * (NODE_W / 2) * 0.5;
          sy = Math.max(sourcePos.y + 4, Math.min(sourcePos.y + NODE_H - 4, sy));
        } else {
          // Vertical dominant: exit top or bottom
          sy = dy > 0 ? sourcePos.y + NODE_H + pad : sourcePos.y - pad;
          sx = sCx + (dx / Math.max(Math.abs(dy), 1)) * (NODE_H / 2) * 0.5;
          sx = Math.max(sourcePos.x + 4, Math.min(sourcePos.x + NODE_W - 4, sx));
        }

        // Pick entry port on target node (closest side towards source center)
        let tx: number, ty: number;
        if (Math.abs(dx) > Math.abs(dy) * sAspect) {
          tx = dx > 0 ? targetPos.x - pad : targetPos.x + NODE_W + pad;
          ty = tCy - (dy / Math.abs(dx)) * (NODE_W / 2) * 0.5;
          ty = Math.max(targetPos.y + 4, Math.min(targetPos.y + NODE_H - 4, ty));
        } else {
          ty = dy > 0 ? targetPos.y - pad : targetPos.y + NODE_H + pad;
          tx = tCx - (dx / Math.max(Math.abs(dy), 1)) * (NODE_H / 2) * 0.5;
          tx = Math.max(targetPos.x + 4, Math.min(targetPos.x + NODE_W - 4, tx));
        }

        // Compute control points based on exit/entry directions
        const dist = Math.sqrt(dx * dx + dy * dy);
        const cpLen = Math.min(Math.max(dist * 0.35, 40), 120);
        let cx1: number, cy1: number, cx2: number, cy2: number;

        // Source control point: extend in the direction of exit
        const sDx = sx - sCx;
        const sDy = sy - sCy;
        const sLen = Math.sqrt(sDx * sDx + sDy * sDy) || 1;
        cx1 = sx + (sDx / sLen) * cpLen;
        cy1 = sy + (sDy / sLen) * cpLen;

        // Target control point: extend in the direction of entry (away from target center)
        const tDx = tx - tCx;
        const tDy = ty - tCy;
        const tLen = Math.sqrt(tDx * tDx + tDy * tDy) || 1;
        cx2 = tx + (tDx / tLen) * cpLen;
        cy2 = ty + (tDy / tLen) * cpLen;

        const pathD = `M ${sx},${sy} C ${cx1},${cy1} ${cx2},${cy2} ${tx},${ty}`;
        // Compute actual bezier midpoint for label positioning
        const midX = 0.125 * sx + 0.375 * cx1 + 0.375 * cx2 + 0.125 * tx;
        const midY = 0.125 * sy + 0.375 * cy1 + 0.375 * cy2 + 0.125 * ty;

        // Hover/route edge highlighting
        const isHoverRelevant = hoveredNodeId === job.id || hoveredNodeId === targetId;
        const routeEdgeKey = `${job.id}->${targetId}:${edgeType}`;
        const isInRoute = routeState?.routeEdges.has(routeEdgeKey) ?? false;
        let edgeOpacity = 1;
        let defaultStroke = edgeColor;
        if (hoveredGroupId && !isSelected && !isFlashing) {
          const groupJobIds = jobGroups.find((g) => g.id === hoveredGroupId)?.jobIds ?? [];
          const srcInGroup = groupJobIds.includes(job.id);
          const tgtInGroup = groupJobIds.includes(targetId);
          if (!srcInGroup && !tgtInGroup) { edgeOpacity = 0.06; defaultStroke = "#4B5563"; }
        } else if (hoverConnectedNodes && !isSelected && !isFlashing) {
          if (!isHoverRelevant) { edgeOpacity = 0.06; defaultStroke = "#4B5563"; }
        } else if (routeState && !isSelected && !isFlashing) {
          const isInFlow = routeState.flowNodes.has(job.id) || routeState.flowNodes.has(targetId);
          if (isInRoute) {
            // highlighted edge — keep full opacity
          } else if (isInFlow) {
            edgeOpacity = 0.12; defaultStroke = "#4B5563";
          }
          // Edges between unrelated jobs stay at full opacity
        }

        lines.push(
          <g key={`edge-${k}`} style={{ cursor: "pointer" }}>
            {/* Wide invisible hit area for easier clicking */}
            <path
              d={pathD}
              stroke="transparent"
              strokeWidth={16}
              fill="none"
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedEdge(isSelected ? null : { sourceId: job.id, targetId, type: edgeType });
                setEdgeDeleteHover(false);
              }}
            />
            {/* Visible dashed line — wavy when selected, smooth transitions */}
            <path
              d={isSelected && waveAmplitude.current > 0.1
                ? wavyPath(sx, sy, tx, ty, cx1, cy1, cx2, cy2, wavePhase, waveAmplitude.current, waveFreq.current)
                : pathD}
              stroke={isFlashing ? edgeColor : isSelected ? (edgeDeleteHover ? "#EF4444" : "#FAFAFA") : defaultStroke}
              strokeWidth={2}
              strokeDasharray="6 5"
              fill="none"
              markerEnd={isSelected ? (edgeDeleteHover ? "url(#arrow-delete)" : "url(#arrow-selected)") : edgeOpacity < 0.5 ? "url(#arrow-dim)" : `url(#arrow-${edgeType})`}
              style={{ ...(isFlashing ? { animation: "edge-march 0.4s linear infinite" } : {}), opacity: isSelected || isFlashing ? 1 : edgeOpacity, transition: "opacity 0.2s" }}
            />
            <circle cx={midX} cy={midY - 14} r={4} fill={isSelected && edgeDeleteHover ? "#EF4444" : edgeColor} style={{ opacity: isSelected || isFlashing ? 1 : edgeOpacity, transition: "opacity 0.2s" }} />
            <text
              x={midX + 8}
              y={midY - 11}
              fill={isSelected && edgeDeleteHover ? "#EF4444" : defaultStroke}
              fontSize={8}
              fontFamily={font}
              style={{ opacity: isSelected || isFlashing ? 1 : edgeOpacity, transition: "opacity 0.2s" }}
            >
              {edgeType}
            </text>
            {/* Delete button when selected */}
            {isSelected && (
              <g
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setEdgeDeleteHover(true)}
                onMouseLeave={() => setEdgeDeleteHover(false)}
                onClick={async (e) => {
                  e.stopPropagation();
                  const sourceJob = jobs.find((j) => j.id === job.id);
                  if (!sourceJob) return;
                  try {
                    await api.updateJob({
                      id: sourceJob.id,
                      name: sourceJob.name,
                      description: sourceJob.description,
                      type: sourceJob.type as "claude" | "bash",
                      workingDirectory: sourceJob.workingDirectory,
                      scheduleEnabled: sourceJob.scheduleEnabled,
                      scheduleType: sourceJob.scheduleType as "recurring" | "one_time",
                      cronExpression: sourceJob.cronExpression,
                      scheduleInterval: sourceJob.scheduleInterval,
                      timeoutSeconds: sourceJob.timeoutSeconds,
                      prompt: sourceJob.prompt,
                      allowBypass: sourceJob.allowBypass,
                      autonomousMode: sourceJob.autonomousMode,
                      maxRetries: sourceJob.maxRetries,
                      model: sourceJob.model,
                      overrideRepoCommand: sourceJob.overrideRepoCommand,
                      claudeCommand: sourceJob.claudeCommand,
                      successPrompt: sourceJob.successPrompt,
                      failurePrompt: sourceJob.failurePrompt,
                      metadataPrompt: sourceJob.metadataPrompt,
                      interpreter: sourceJob.interpreter,
                      scriptContent: sourceJob.scriptContent,
                      envVariables: sourceJob.envVariables,
                      onSuccess: edgeType === "success"
                        ? sourceJob.onSuccess.filter((id) => id !== targetId)
                        : sourceJob.onSuccess,
                      onFailure: edgeType === "failure"
                        ? sourceJob.onFailure.filter((id) => id !== targetId)
                        : sourceJob.onFailure,
                    });
                    setSelectedEdge(null);
                    setEdgeDeleteHover(false);
                    onRefreshJobs();
                  } catch (err) {
                    console.error("failed to delete trigger:", err);
                  }
                }}
              >
                {/* Larger hit area for hover */}
                <rect x={midX - 30} y={midY + 10} width={60} height={20} fill="transparent" />
                <text x={midX} y={midY + 24} fill="#EF4444" fontSize={11} fontFamily={font} textAnchor="middle">✕ delete</text>
              </g>
            )}
          </g>
        );
      };

      for (const targetId of (job.onSuccess ?? [])) {
        drawEdge(targetId, "success");
      }
      for (const targetId of (job.onFailure ?? [])) {
        drawEdge(targetId, "failure");
      }
    }

    return lines;
  }

  function renderMinimap() {
    if (jobs.length === 0) return null;

    const allPos = jobs.map((j) => nodePositions[j.id]).filter(Boolean) as { x: number; y: number }[];
    if (allPos.length === 0) return null;

    // Include both node positions AND the current viewport in the extent
    const containerRect = canvasRef.current?.getBoundingClientRect();
    const vpW = containerRect ? containerRect.width / zoom : 800;
    const vpH = containerRect ? containerRect.height / zoom : 600;
    const vpWorldX = -canvasOffset.x / zoom;
    const vpWorldY = -canvasOffset.y / zoom;

    const nodeMinX = Math.min(...allPos.map((p) => p.x));
    const nodeMaxX = Math.max(...allPos.map((p) => p.x + NODE_W));
    const nodeMinY = Math.min(...allPos.map((p) => p.y));
    const nodeMaxY = Math.max(...allPos.map((p) => p.y + NODE_H));

    // Extend bounds to include viewport area
    const minX = Math.min(nodeMinX, vpWorldX) - 200;
    const maxX = Math.max(nodeMaxX, vpWorldX + vpW) + 200;
    const minY = Math.min(nodeMinY, vpWorldY) - 200;
    const maxY = Math.max(nodeMaxY, vpWorldY + vpH) + 200;

    const contentW = maxX - minX || 1;
    const contentH = maxY - minY || 1;
    const mapW = 180;
    const mapH = 120;
    const scaleX = mapW / contentW;
    const scaleY = mapH / contentH;
    const scale = Math.min(scaleX, scaleY);

    // Viewport rect
    const vpX = (vpWorldX - minX) * scale;
    const vpY = (vpWorldY - minY) * scale;
    const vpRW = vpW * scale;
    const vpRH = vpH * scale;

    function handleMinimapMouseDown(e: React.MouseEvent<HTMLDivElement>) {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Check if clicking inside the viewport rect
      const insideVp = clickX >= vpX && clickX <= vpX + vpRW && clickY >= vpY && clickY <= vpY + vpRH;

      if (insideVp) {
        // Drag the viewport rect
        const startMouseX = e.clientX;
        const startMouseY = e.clientY;
        const startOffsetX = canvasOffset.x;
        const startOffsetY = canvasOffset.y;

        const onMove = (me: MouseEvent) => {
          const dx = (me.clientX - startMouseX) / scale;
          const dy = (me.clientY - startMouseY) / scale;
          setCanvasOffset({
            x: startOffsetX - dx * zoom,
            y: startOffsetY - dy * zoom,
          });
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      } else {
        // Click outside viewport rect — jump canvas to that world position
        const worldX = clickX / scale + minX;
        const worldY = clickY / scale + minY;
        setCanvasOffset({
          x: -(worldX - vpW / 2) * zoom,
          y: -(worldY - vpH / 2) * zoom,
        });
      }
    }

    return (
      <div
        onMouseDown={handleMinimapMouseDown}
        style={{
          position: "absolute",
          bottom: 16,
          right: 56,
          zIndex: 10,
          width: 180,
          height: 120,
          backgroundColor: "#111111",
          border: "1px solid #2a2a2a",
          borderRadius: 4,
          overflow: "hidden",
          cursor: "pointer",
        }}
      >
        {jobs.map((job) => {
          const pos = nodePositions[job.id];
          if (!pos) return null;
          return (
            <div
              key={job.id}
              style={{
                position: "absolute",
                left: (pos.x - minX) * scale,
                top: (pos.y - minY) * scale,
                width: Math.max(NODE_W * scale, 4),
                height: Math.max(NODE_H * scale, 3),
                backgroundColor: job.scheduleEnabled ? "#10B981" : "#6B7280",
                borderRadius: 1,
                opacity: 0.8,
              }}
            />
          );
        })}
        <div
          style={{
            position: "absolute",
            left: vpX,
            top: vpY,
            width: vpRW,
            height: vpRH,
            border: "1px solid #6B7280",
            borderRadius: 1,
            backgroundColor: "rgba(107,114,128,0.08)",
            cursor: "grab",
          }}
        />
      </div>
    );
  }

  function renderCanvasModal() {
    if (!canvasModalJobId || !canvasModalJob) return null;

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "#00000080",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          animation: "modal-backdrop-in 0.2s ease-out",
        }}
        onClick={(e) => { if (e.target === e.currentTarget) setCanvasModalJobId(null); }}
        onWheel={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: 720,
            height: 520,
            backgroundColor: "#0A0A0A",
            border: "1px solid #2a2a2a",
            borderRadius: 4,
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "modal-scale-in 0.25s ease-out",
          }}
        >
          {/* Modal header */}
          <div
            className="flex items-center justify-between px-5 shrink-0"
            style={{ height: 48, borderBottom: "1px solid #2a2a2a" }}
          >
            <div className="flex items-center gap-2">
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: canvasModalJob.scheduleEnabled ? "#10B981" : "#6B7280",
                }}
              />
              <span style={{ color: "#FAFAFA", fontSize: 13, fontWeight: 500, fontFamily: font }}>
                {canvasModalJob.name}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {hasRunningRun ? (
                <button
                  onClick={handleStopRun}
                  className="flex items-center gap-1 px-3 py-1 text-[11px] lowercase transition-colors"
                  style={{ color: "#EF4444", fontFamily: font, background: "none", border: "none", cursor: "pointer" }}
                >
                  &#9632; stop
                </button>
              ) : (
                <button
                  onClick={handleRunNow}
                  className="flex items-center gap-1 px-3 py-1 text-[11px] lowercase transition-colors"
                  style={{ color: "#10B981", fontFamily: font, background: "none", border: "none", cursor: "pointer" }}
                >
                  &#9654; run now
                </button>
              )}
              <button
                onClick={() => { setCanvasModalJobId(null); onEditJob(canvasModalJob); }}
                className="flex items-center gap-1 px-3 py-1 text-[11px] lowercase transition-colors"
                style={{ color: "#6B7280", fontFamily: font, background: "none", border: "none", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
              >
                &#10000; edit
              </button>
            </div>
          </div>

          {/* Modal tab bar */}
          <div className="flex" style={{ borderBottom: "1px solid #2a2a2a" }}>
            {(["settings", "history"] as JobTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setCanvasModalTab(t)}
                className="flex items-center justify-center px-6 py-2 text-[11px] lowercase transition-colors"
                style={{
                  fontFamily: font,
                  fontWeight: canvasModalTab === t ? 500 : "normal",
                  color: canvasModalTab === t ? "#10B981" : "#6B7280",
                  borderBottom: canvasModalTab === t ? "2px solid #10B981" : "2px solid transparent",
                  background: "none",
                  border: "none",
                  borderBottomWidth: 2,
                  borderBottomStyle: "solid",
                  borderBottomColor: canvasModalTab === t ? "#10B981" : "transparent",
                  cursor: "pointer",
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Modal tab content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {canvasModalTab === "settings" && renderSettingsTab()}
            {canvasModalTab === "history" && renderHistoryTab()}
          </div>
        </div>
      </div>
    );
  }

  function renderCanvasView() {
    return (
      <div
        ref={canvasRef}
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          backgroundColor: "#080808",
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: connectingMode ? "crosshair" : spaceDown ? "grab" : panning ? "grabbing" : "default",
        }}
        onWheel={handleWheel}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={(e) => {
          if (connectingMode?.sourceId) {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (rect) {
              setConnectMousePos({
                x: (e.clientX - rect.left - canvasOffset.x) / zoom,
                y: (e.clientY - rect.top - canvasOffset.y) / zoom,
              });
            }
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (selectedJobIds.size === 0) return;
          const items: { label: string; action: () => void }[] = [];
          // Check if all selected jobs are in the same group for "Ungroup" option
          const selectedArr = [...selectedJobIds];
          const groupForSelected = jobGroups.find((g) => selectedArr.every((jid) => g.jobIds.includes(jid)) && selectedArr.length > 0);
          items.push({ label: "Create Group", action: () => { setShowGroupNameInput(true); } });
          if (groupForSelected) {
            items.push({
              label: "Ungroup",
              action: async () => {
                try {
                  const remaining = groupForSelected.jobIds.filter((id) => !selectedJobIds.has(id));
                  if (remaining.length === 0) {
                    await api.deleteJobGroup(groupForSelected.id);
                  } else {
                    await api.updateJobGroup({ id: groupForSelected.id, name: groupForSelected.name, jobIds: remaining, workspaceId: activeWorkspaceId });
                  }
                  onRefreshJobGroups();
                  setContextMenu(null);
                } catch (err) { console.error("failed to ungroup:", err); }
              },
            });
          }
          setContextMenu({ x: e.clientX, y: e.clientY, items });
          setShowGroupNameInput(false);
          setGroupNameInput("");
        }}
        onClick={(e) => {
          // Clear selections only when clicking the canvas background directly
          if (e.target === e.currentTarget) {
            setSelectedEdge(null);
            setEdgeDeleteHover(false);
          }
        }}
      >
        {/* SVG connections overlay */}
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          <defs>
            <marker id="arrow-success" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="8" markerHeight="6" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#10B981"/></marker>
            <marker id="arrow-failure" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="8" markerHeight="6" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#EF4444"/></marker>
            <marker id="arrow-selected" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="8" markerHeight="6" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#FAFAFA"/></marker>
            <marker id="arrow-delete" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="8" markerHeight="6" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#EF4444"/></marker>
            <marker id="arrow-dim" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="8" markerHeight="6" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#4B5563"/></marker>
          </defs>
          <g transform={`translate(${canvasOffset.x}, ${canvasOffset.y}) scale(${zoom})`} style={{ pointerEvents: "auto" }}>
            {renderSvgConnections()}
            {/* Preview connection line when drawing a trigger */}
            {connectingMode?.sourceId && (() => {
              const srcPos = nodePositions[connectingMode.sourceId];
              if (!srcPos) return null;
              // Compute free port towards target
              let rawTx = connectMousePos.x;
              let rawTy = connectMousePos.y;
              if (hoveredNodeId && hoveredNodeId !== connectingMode.sourceId) {
                const tgtPos = nodePositions[hoveredNodeId];
                if (tgtPos) { rawTx = tgtPos.x + NODE_W / 2; rawTy = tgtPos.y + NODE_H / 2; }
              }
              const pDx = rawTx - (srcPos.x + NODE_W / 2);
              const pDy = rawTy - (srcPos.y + NODE_H / 2);
              const pAspect = (NODE_W / 2) / (NODE_H / 2);
              let sx: number, sy: number;
              if (Math.abs(pDx) > Math.abs(pDy) * pAspect) {
                sx = pDx > 0 ? srcPos.x + NODE_W + 2 : srcPos.x - 2;
                sy = srcPos.y + NODE_H / 2 + (pDy / Math.abs(pDx)) * (NODE_W / 2) * 0.5;
                sy = Math.max(srcPos.y + 4, Math.min(srcPos.y + NODE_H - 4, sy));
              } else {
                sy = pDy > 0 ? srcPos.y + NODE_H + 2 : srcPos.y - 2;
                sx = srcPos.x + NODE_W / 2 + (pDx / Math.max(Math.abs(pDy), 1)) * (NODE_H / 2) * 0.5;
                sx = Math.max(srcPos.x + 4, Math.min(srcPos.x + NODE_W - 4, sx));
              }
              let tx = connectMousePos.x;
              let ty = connectMousePos.y;
              if (hoveredNodeId && hoveredNodeId !== connectingMode.sourceId) {
                const tgtPos = nodePositions[hoveredNodeId];
                if (tgtPos) {
                  if (Math.abs(pDx) > Math.abs(pDy) * pAspect) {
                    tx = pDx > 0 ? tgtPos.x - 2 : tgtPos.x + NODE_W + 2;
                    ty = tgtPos.y + NODE_H / 2;
                  } else {
                    ty = pDy > 0 ? tgtPos.y - 2 : tgtPos.y + NODE_H + 2;
                    tx = tgtPos.x + NODE_W / 2;
                  }
                }
              }
              const pDist = Math.sqrt(pDx * pDx + pDy * pDy);
              const pCpLen = Math.min(Math.max(pDist * 0.35, 40), 120);
              const sNx = sx - (srcPos.x + NODE_W / 2), sNy = sy - (srcPos.y + NODE_H / 2);
              const sNLen = Math.sqrt(sNx * sNx + sNy * sNy) || 1;
              const color = connectingMode.type === "success" ? "#10B981" : "#EF4444";
              const arrowId = connectingMode.type === "success" ? "arrow-success" : "arrow-failure";
              return (
                <path
                  d={`M ${sx},${sy} C ${sx + (sNx / sNLen) * pCpLen},${sy + (sNy / sNLen) * pCpLen} ${tx},${ty} ${tx},${ty}`}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray="6 5"
                  fill="none"
                  opacity={0.6}
                  markerEnd={`url(#${arrowId})`}
                  style={{ pointerEvents: "none" }}
                />
              );
            })()}
          </g>
        </svg>

        {/* Node container with transform */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            pointerEvents: "none",
            zIndex: isDraggingNode ? 200 : 2,
          }}
        >
          {/* Visual group boxes */}
          {jobGroups.map((group) => {
            const positions = group.jobIds.map((id) => nodePositions[id]).filter(Boolean);
            if (positions.length === 0) return null;
            const minX = Math.min(...positions.map((p) => p.x)) - 24;
            const maxX = Math.max(...positions.map((p) => p.x + NODE_W)) + 24;
            const minY = Math.min(...positions.map((p) => p.y)) - 24;
            const maxY = Math.max(...positions.map((p) => p.y + NODE_H)) + 24;
            return (
              <div key={`group-box-${group.id}`} style={{ position: "absolute", left: minX, top: minY, width: maxX - minX, height: maxY - minY, border: "1px solid #2a2a2a", borderRadius: 8, backgroundColor: "#0f0f0f80", pointerEvents: "none" }}>
                <span style={{ position: "absolute", top: -12, left: 12, backgroundColor: "#0f0f0f", padding: "0 6px", color: "#4B5563", fontSize: 9, fontFamily: font, whiteSpace: "nowrap" }}>{group.name}</span>
              </div>
            );
          })}

          {/* Selection box */}
          {selectionBox && (() => {
            const x = Math.min(selectionBox.startX, selectionBox.currentX);
            const y = Math.min(selectionBox.startY, selectionBox.currentY);
            const w = Math.abs(selectionBox.currentX - selectionBox.startX);
            const h = Math.abs(selectionBox.currentY - selectionBox.startY);
            if (w < 2 && h < 2) return null;
            return (
              <div style={{ position: "absolute", left: x, top: y, width: w, height: h, border: "1px solid rgba(16, 185, 129, 0.5)", backgroundColor: "rgba(16, 185, 129, 0.06)", pointerEvents: "none", borderRadius: 2 }} />
            );
          })()}

          {jobs.map((job) => {
            const pos = nodePositions[job.id] ?? { x: 0, y: 0 };
            const isSelected = job.id === canvasModalJobId;
            const isMultiSelected = selectedJobIds.has(job.id);
            const isConnectSource = connectingMode?.sourceId === job.id;
            const isHovered = hoveredNodeId === job.id;
            const isRunning = runningJobIds.has(job.id);
            const isDraggingThis = dragging?.id === job.id && isDraggingNode;
            const isInHoveredGroup = hoveredGroupId ? (jobGroups.find((g) => g.id === hoveredGroupId)?.jobIds.includes(job.id) ?? false) : false;
            let borderColor = "#2a2a2a";
            if (isDraggingThis && dragDeleteHover) borderColor = "#EF4444";
            else if (isDraggingThis) borderColor = "#FAFAFA";
            else if (isMultiSelected) borderColor = "#10B981";
            else if (isRunning) borderColor = "#10B981";
            else if (isSelected) borderColor = "#10B981";
            else if (isConnectSource) borderColor = connectingMode?.type === "success" ? "#10B981" : "#EF4444";
            else if (connectingMode && isHovered) borderColor = connectingMode.type === "success" ? "#10B981" : "#EF4444";

            // Hover/route/group node highlighting
            let nodeOpacity = 1;
            if (isDraggingThis && dragDeleteHover) {
              nodeOpacity = 0.5;
            } else if (hoveredGroupId && !isDraggingThis && !isSelected && !connectingMode) {
              nodeOpacity = isInHoveredGroup ? 1 : 0.15;
            } else if (hoverConnectedNodes && !isDraggingThis && !isSelected && !connectingMode) {
              nodeOpacity = hoverConnectedNodes.has(job.id) ? 1 : 0.15;
            } else if (routeState && !isDraggingThis && !isSelected && !connectingMode) {
              if (routeState.routeNodes.has(job.id)) {
                nodeOpacity = 1;
              } else if (routeState.flowNodes.has(job.id)) {
                nodeOpacity = 0.35;
              }
              // Jobs not in the flow stay at opacity 1
            }

            const scheduleInfo = job.scheduleEnabled
              ? (job.cronExpression ? `cron: ${job.cronExpression}` : job.scheduleInterval ? `every ${job.scheduleInterval}m` : job.scheduleType)
              : "disabled";

            return (
              <div
                key={job.id}
                style={{
                  position: "absolute",
                  left: pos.x,
                  top: pos.y,
                  width: NODE_W,
                  backgroundColor: "#111111",
                  border: `1px solid ${borderColor}`,
                  borderRadius: 4,
                  padding: "10px 14px",
                  cursor: connectingMode ? "pointer" : dragging?.id === job.id ? "grabbing" : "grab",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  pointerEvents: "auto",
                  transition: dragging?.id === job.id ? "none" : "border-color 0.15s, opacity 0.2s",
                  animation: isDraggingThis
                    ? (dragDeleteHover ? "node-shake-scared 0.2s ease-in-out infinite" : "node-shake 0.3s ease-in-out infinite")
                    : "none",
                  zIndex: isDraggingThis ? 200 : "auto",
                  opacity: nodeOpacity,
                }}
                onMouseEnter={() => setHoveredNodeId(job.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onMouseDown={(e) => {
                  if (connectingMode) return;
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  didDrag.current = false;
                  setDragging({
                    id: job.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    nodeStartX: pos.x,
                    nodeStartY: pos.y,
                  });
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (connectingMode) {
                    handleNodeClick(job.id);
                    return;
                  }
                  // Open modal on click, but not if we dragged
                  if (!didDrag.current) {
                    setCanvasModalJobId(job.id);
                    setSelectedJobId(job.id);
                    setCanvasModalTab("settings");
                  }
                }}
              >
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: job.scheduleEnabled ? "#10B981" : "#6B7280",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      color: "#FAFAFA",
                      fontSize: 11,
                      fontWeight: "bold",
                      fontFamily: font,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {job.name}
                  </span>
                  {isRunning ? (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: "#10B981",
                        animation: "job-pulse 1.5s ease-in-out infinite",
                        display: "inline-block",
                        flexShrink: 0,
                      }}
                      title="running..."
                    />
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRunJobById(job.id);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#10B981",
                        fontSize: 10,
                        cursor: "pointer",
                        padding: "0 2px",
                        fontFamily: font,
                        lineHeight: 1,
                      }}
                      title="run job"
                    >
                      &#9654;
                    </button>
                  )}
                </div>
                {/* Second line */}
                <div style={{ marginTop: 4, color: "#4B5563", fontSize: 9, fontFamily: font, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {job.type}{agentName(job.agentId) ? <span style={{ color: "#10B981" }}> &middot; {agentName(job.agentId)}</span> : null} &middot; {scheduleInfo}
                </div>
              </div>
            );
          })}
        </div>

        {/* Floating logo island */}
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            zIndex: 10,
            backgroundColor: "#141414",
            border: "1px solid #2a2a2a",
            borderRadius: 9999,
            padding: "6px 16px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            fontFamily: font,
            fontSize: 12,
            pointerEvents: "none",
          }}
        >
          <span style={{ color: "#10B981" }}>&gt;_ </span>
          <span style={{ color: "#FAFAFA" }}>quant</span>
        </div>

        {/* Floating action island */}
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            backgroundColor: "#141414",
            border: "1px solid #2a2a2a",
            borderRadius: 9999,
            padding: "4px 8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            gap: 0,
            fontFamily: font,
            fontSize: 10,
          }}
        >
          {/* + new job */}
          <button
            onClick={onCreateJob}
            style={{ background: "none", border: "none", color: "#10B981", cursor: "pointer", padding: "4px 10px", fontFamily: font, fontSize: 10, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#059669")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#10B981")}
          >
            + new job
          </button>
          {/* triggers dropdown */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => { setTriggerDropdownOpen((v) => !v); }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px 10px",
                fontFamily: font,
                fontSize: 10,
                display: "flex",
                alignItems: "center",
                gap: 4,
                whiteSpace: "nowrap",
                color: connectingMode ? "#FAFAFA" : "#6B7280",
              }}
              onMouseEnter={(e) => { if (!connectingMode) e.currentTarget.style.color = "#FAFAFA"; }}
              onMouseLeave={(e) => { if (!connectingMode) e.currentTarget.style.color = "#6B7280"; }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" />
              </svg>
              {connectingMode ? `trigger: ${connectingMode.type}` : "triggers"}
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {triggerDropdownOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: 6,
                  backgroundColor: "#1a1a1a",
                  border: "1px solid #2a2a2a",
                  borderRadius: 6,
                  padding: "4px 0",
                  minWidth: 140,
                  zIndex: 9999,
                  fontFamily: font,
                  fontSize: 11,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                }}
              >
                <button
                  onClick={() => {
                    setConnectingMode(connectingMode?.type === "success" ? null : { type: "success" });
                    setTriggerDropdownOpen(false);
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    width: "100%", padding: "6px 12px",
                    background: connectingMode?.type === "success" ? "#2a2a2a" : "none",
                    border: "none", cursor: "pointer",
                    color: "#10B981", textAlign: "left", fontSize: 11,
                    fontFamily: font,
                  }}
                  onMouseEnter={(e) => { if (connectingMode?.type !== "success") e.currentTarget.style.backgroundColor = "#222"; }}
                  onMouseLeave={(e) => { if (connectingMode?.type !== "success") e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#10B981", flexShrink: 0 }} />
                  on success
                  {connectingMode?.type === "success" && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "auto" }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => {
                    setConnectingMode(connectingMode?.type === "failure" ? null : { type: "failure" });
                    setTriggerDropdownOpen(false);
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    width: "100%", padding: "6px 12px",
                    background: connectingMode?.type === "failure" ? "#2a2a2a" : "none",
                    border: "none", cursor: "pointer",
                    color: "#EF4444", textAlign: "left", fontSize: 11,
                    fontFamily: font,
                  }}
                  onMouseEnter={(e) => { if (connectingMode?.type !== "failure") e.currentTarget.style.backgroundColor = "#222"; }}
                  onMouseLeave={(e) => { if (connectingMode?.type !== "failure") e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#EF4444", flexShrink: 0 }} />
                  on failure
                  {connectingMode?.type === "failure" && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "auto" }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
                {connectingMode && (
                  <>
                    <div style={{ borderTop: "1px solid #2a2a2a", margin: "4px 0" }} />
                    <button
                      onClick={() => {
                        setConnectingMode(null);
                        setTriggerDropdownOpen(false);
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        width: "100%", padding: "6px 12px",
                        background: "none", border: "none", cursor: "pointer",
                        color: "#6B7280", textAlign: "left", fontSize: 11,
                        fontFamily: font,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#222"; e.currentTarget.style.color = "#FAFAFA"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6B7280"; }}
                    >
                      cancel
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          {/* separator */}
          <div style={{ width: 1, height: 16, backgroundColor: "#2a2a2a", margin: "0 4px" }} />
          {/* auto-layout */}
          <button
            onClick={handleAutoLayout}
            style={{ background: "none", border: "none", color: "#6B7280", cursor: "pointer", padding: "4px 10px", fontFamily: font, fontSize: 10, whiteSpace: "nowrap" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
          >
            &#8635; auto-layout
          </button>
          {/* fit view */}
          <button
            onClick={handleFitView}
            style={{ background: "none", border: "none", color: "#6B7280", cursor: "pointer", padding: "4px 10px", fontFamily: font, fontSize: 10, whiteSpace: "nowrap" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
          >
            &#8862; fit view
          </button>
          {/* separator */}
          <div style={{ width: 1, height: 16, backgroundColor: "#2a2a2a", margin: "0 4px" }} />
          {/* zoom controls */}
          <button
            onClick={() => setZoom((z) => Math.max(z - 0.1, 0.25))}
            style={{ background: "none", border: "none", color: "#6B7280", cursor: "pointer", padding: "4px 6px", fontFamily: font, fontSize: 12, lineHeight: 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
          >
            -
          </button>
          <span style={{ color: "#6B7280", fontSize: 10, padding: "0 4px", minWidth: 32, textAlign: "center", fontFamily: font }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(z + 0.1, 2))}
            style={{ background: "none", border: "none", color: "#6B7280", cursor: "pointer", padding: "4px 6px", fontFamily: font, fontSize: 12, lineHeight: 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
          >
            +
          </button>
        </div>

        {/* Minimap */}
        {renderMinimap()}

        {/* Drag-to-delete zone — appears when dragging a node */}
        {isDraggingNode && (
          <div
            ref={deleteZoneRef}
            style={{
              position: "absolute",
              bottom: 24,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "10px 32px",
              backgroundColor: dragDeleteHover ? "#2a1a1a" : "#1F1F1F",
              border: `2px solid ${dragDeleteHover ? "#EF4444" : "#EF444480"}`,
              borderRadius: 9999,
              color: "#EF4444",
              fontSize: 11,
              fontFamily: font,
              fontWeight: 500,
              zIndex: 150,
              transition: "background-color 0.15s, border-color 0.15s",
              pointerEvents: "none",
              boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            }}
          >
            {dragDeleteHover ? "✕ Release to delete" : "✕ Drag here to delete"}
          </div>
        )}

        {/* Canvas modal */}
        {renderCanvasModal()}

        {/* Context menu */}
        {contextMenu && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: contextMenu.x,
              top: contextMenu.y,
              backgroundColor: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: 6,
              padding: 4,
              zIndex: 2000,
              minWidth: 160,
              boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
              fontFamily: font,
            }}
          >
            {contextMenu.items.map((item, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  item.action();
                  if (item.label !== "Create Group") {
                    setContextMenu(null);
                  }
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  color: "#FAFAFA",
                  fontSize: 11,
                  fontFamily: font,
                  padding: "6px 12px",
                  cursor: "pointer",
                  borderRadius: 4,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#2a2a2a")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                {item.label}
              </button>
            ))}
            {showGroupNameInput && (
              <div style={{ padding: "6px 12px" }}>
                <input
                  autoFocus
                  value={groupNameInput}
                  onChange={(e) => setGroupNameInput(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && groupNameInput.trim()) {
                      try {
                        await api.createJobGroup({ name: groupNameInput.trim(), jobIds: [...selectedJobIds], workspaceId: activeWorkspaceId });
                        onRefreshJobGroups();
                        setContextMenu(null);
                        setShowGroupNameInput(false);
                        setGroupNameInput("");
                        setSelectedJobIds(new Set());
                      } catch (err) { console.error("failed to create group:", err); }
                    }
                    if (e.key === "Escape") { setContextMenu(null); setShowGroupNameInput(false); setGroupNameInput(""); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="group name..."
                  style={{
                    width: "100%",
                    backgroundColor: "#111111",
                    border: "1px solid #2a2a2a",
                    borderRadius: 4,
                    color: "#FAFAFA",
                    fontSize: 11,
                    fontFamily: font,
                    padding: "4px 8px",
                    outline: "none",
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderGroupsSidebar() {
    const groupedJobIds = new Set(jobGroups.flatMap((g) => g.jobIds));
    const ungroupedJobs = jobs.filter((j) => !groupedJobIds.has(j.id));

    return (
      <div style={{ display: "flex", flexShrink: 0, position: "relative" }}>
      <div
        style={{
          width: groupsSidebarWidth,
          backgroundColor: "#0A0A0A",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          flexShrink: 0,
          fontFamily: font,
        }}
      >
        <div style={{ padding: "12px 14px 8px", color: "#4B5563", fontSize: 10, fontWeight: 500, letterSpacing: 0.5 }}>
          GROUPS
        </div>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {jobGroups.map((group) => {
            const isExpanded = expandedGroups.has(group.id);
            const groupJobs = group.jobIds.map((id) => jobs.find((j) => j.id === id)).filter(Boolean) as Job[];
            return (
              <div key={group.id}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 14px",
                    cursor: "pointer",
                    color: hoveredGroupId === group.id ? "#FAFAFA" : "#9CA3AF",
                    fontSize: 11,
                    transition: "color 0.15s",
                  }}
                  onMouseEnter={() => setHoveredGroupId(group.id)}
                  onMouseLeave={() => setHoveredGroupId(null)}
                  onClick={() => {
                    focusOnGroup(group);
                  }}
                >
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                        return next;
                      });
                    }}
                    style={{ fontSize: 8, display: "inline-block", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", width: 10, textAlign: "center" }}
                  >
                    &#9654;
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.name}</span>
                  <span style={{ color: "#4B5563", fontSize: 9 }}>{groupJobs.length}</span>
                  <span
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await api.deleteJobGroup(group.id);
                        onRefreshJobGroups();
                      } catch (err) {
                        console.error("failed to delete group:", err);
                      }
                    }}
                    style={{
                      color: "#4B5563",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      opacity: hoveredGroupId === group.id ? 1 : 0,
                      transition: "opacity 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#EF4444"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "#4B5563"; }}
                    title="Delete group"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </span>
                </div>
                {isExpanded && groupJobs.map((job) => (
                  <div
                    key={job.id}
                    style={{
                      padding: "4px 14px 4px 30px",
                      cursor: "pointer",
                      color: hoveredNodeId === job.id ? "#FAFAFA" : runningJobIds.has(job.id) ? "#FAFAFA" : "#6B7280",
                      fontSize: 10,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={() => setHoveredNodeId(job.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    onClick={() => focusOnJob(job.id)}
                  >
                    {job.name}
                  </div>
                ))}
              </div>
            );
          })}

          {/* Ungrouped section */}
          {ungroupedJobs.length > 0 && (
            <div>
              <div style={{ height: 1, backgroundColor: "#2a2a2a", margin: "4px 14px" }} />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 14px",
                  cursor: "pointer",
                  color: "#6B7280",
                  fontSize: 11,
                }}
                onClick={() => {
                  setExpandedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has("__ungrouped__")) next.delete("__ungrouped__"); else next.add("__ungrouped__");
                    return next;
                  });
                }}
              >
                <span
                  style={{ fontSize: 8, display: "inline-block", transform: expandedGroups.has("__ungrouped__") ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", width: 10, textAlign: "center" }}
                >
                  &#9654;
                </span>
                <span style={{ flex: 1 }}>ungrouped</span>
                <span style={{ color: "#4B5563", fontSize: 9 }}>{ungroupedJobs.length}</span>
              </div>
              {expandedGroups.has("__ungrouped__") && ungroupedJobs.map((job) => (
                <div
                  key={job.id}
                  style={{
                    padding: "4px 14px 4px 30px",
                    cursor: "pointer",
                    color: hoveredNodeId === job.id ? "#FAFAFA" : runningJobIds.has(job.id) ? "#FAFAFA" : "#6B7280",
                    fontSize: 10,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    transition: "color 0.15s",
                  }}
                  onMouseEnter={() => setHoveredNodeId(job.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onClick={() => focusOnJob(job.id)}
                >
                  {job.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Resize handle */}
      <div
        onMouseDown={(e) => { e.preventDefault(); setResizingSidebar(true); }}
        style={{
          width: 4,
          cursor: "col-resize",
          backgroundColor: resizingSidebar ? "#10B981" : "transparent",
          borderRight: "1px solid #2a2a2a",
          transition: "background-color 0.15s",
        }}
        onMouseEnter={(e) => { if (!resizingSidebar) e.currentTarget.style.backgroundColor = "#333"; }}
        onMouseLeave={(e) => { if (!resizingSidebar) e.currentTarget.style.backgroundColor = "transparent"; }}
      />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen" style={{ backgroundColor: "#0A0A0A", fontFamily: font }}>
      <style>{pulseKeyframes}</style>
      {renderGroupsSidebar()}
      {renderCanvasView()}
    </div>
  );
}
