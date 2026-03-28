import { useCallback, useEffect, useRef, useState } from "react";
import type { Job, JobRun, UpdateJobRequest } from "../types";
import * as api from "../api";

type JobTab = "settings" | "history";
type RunTab = "session" | "result";

interface Props {
  jobs: Job[];
  onCreateJob: () => void;
  onEditJob: (job: Job) => void;
  onRefreshJobs: () => void;
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

  // Build adjacency
  const outgoing = new Map<string, string[]>();
  const allTargets = new Set<string>();
  for (const job of jobs) {
    const targets = [...(job.onSuccess ?? []), ...(job.onFailure ?? [])];
    outgoing.set(job.id, targets);
    for (const t of targets) allTargets.add(t);
  }

  // Find roots (not targeted by anyone)
  const jobIds = new Set(jobs.map((j) => j.id));
  const roots = jobs.filter((j) => !allTargets.has(j.id));
  if (roots.length === 0) roots.push(jobs[0]);

  // BFS to assign depth
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const r of roots) {
    depth.set(r.id, 0);
    queue.push(r.id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    const targets = outgoing.get(id) ?? [];
    for (const t of targets) {
      if (!jobIds.has(t)) continue;
      if (!depth.has(t) || depth.get(t)! < d + 1) {
        depth.set(t, d + 1);
        queue.push(t);
      }
    }
  }

  // Assign depth 0 to any unreachable jobs
  for (const job of jobs) {
    if (!depth.has(job.id)) depth.set(job.id, 0);
  }

  // Group by depth
  const levels = new Map<number, string[]>();
  for (const [id, d] of depth.entries()) {
    if (!levels.has(d)) levels.set(d, []);
    levels.get(d)!.push(id);
  }

  const hSpacing = 300;
  const vSpacing = 120;
  const startX = 100;
  const startY = 100;

  for (const [d, ids] of levels.entries()) {
    for (let i = 0; i < ids.length; i++) {
      positions[ids[i]] = { x: startX + d * hSpacing, y: startY + i * vSpacing };
    }
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

export function JobsView({ jobs, onCreateJob, onEditJob, onRefreshJobs }: Props) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<JobTab>("settings");
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunTab, setSelectedRunTab] = useState<RunTab>("session");
  const [runOutput, setRunOutput] = useState<string>("");
  const [copied, setCopied] = useState(false);

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
      await api.runJob(jobId);
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
      if (e.key === " " && !canvasModalJobId) {
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

  // Global mouse handlers for drag and pan
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
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, panning, zoom]);

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
              return (
                <button
                  key={run.id}
                  onClick={() => { setSelectedRunId(run.id); setSelectedRunTab("session"); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left transition-colors"
                  style={{
                    backgroundColor: active ? "#1F1F1F" : "transparent",
                    fontFamily: font,
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = "#1F1F1F"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}
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
                  {selectedRun.status === "running" && !runOutput && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
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
                        running...
                      </span>
                    </div>
                  )}
                  {selectedRun.status === "running" && runOutput && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
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
                        running... output updating every 3s
                      </span>
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
                    {renderKeyValue("triggered_by", selectedRun.triggeredBy || "manual")}
                    {renderKeyValue("started", selectedRun.startedAt ? new Date(selectedRun.startedAt).toLocaleString() : "---")}
                    {selectedRun.finishedAt && renderKeyValue("finished", new Date(selectedRun.finishedAt).toLocaleString())}
                    {renderKeyValue("duration", formatDuration(selectedRun.durationMs))}
                    {selectedRun.tokensUsed > 0 && renderKeyValue("tokens_used", selectedRun.tokensUsed.toLocaleString())}
                  </>)}

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
  function wavyPath(sx: number, sy: number, tx: number, ty: number, time: number, amplitude: number, frequency: number): string {
    const steps = 40;
    const points: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Base bezier curve position (cubic)
      const cx1 = sx + 80, cy1 = sy;
      const cx2 = tx - 80, cy2 = ty;
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

        const sx = sourcePos.x + NODE_W;
        const sy = sourcePos.y + NODE_H / 2;
        const tx = targetPos.x;
        const ty = targetPos.y + NODE_H / 2;
        const midX = (sx + tx) / 2;
        const midY = (sy + ty) / 2;
        const edgeColor = edgeType === "success" ? "#10B981" : "#EF4444";
        const k = keyIdx++;
        const isSelected = selectedEdge?.sourceId === job.id && selectedEdge?.targetId === targetId && selectedEdge?.type === edgeType;
        const isFlashing = flashingEdges.has(`${job.id}->${targetId}`);
        const isAnimated = isSelected || isFlashing;
        const pathD = `M ${sx},${sy} C ${sx + 80},${sy} ${tx - 80},${ty} ${tx},${ty}`;

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
                ? wavyPath(sx, sy, tx, ty, wavePhase, waveAmplitude.current, waveFreq.current)
                : pathD}
              stroke={isFlashing ? edgeColor : isSelected ? (edgeDeleteHover ? "#EF4444" : "#FAFAFA") : "#4B5563"}
              strokeWidth={2}
              strokeDasharray="6 5"
              fill="none"
              style={isFlashing ? { animation: "edge-march 0.4s linear infinite" } : undefined}
            />
            <circle cx={midX} cy={midY - 14} r={4} fill={isSelected && edgeDeleteHover ? "#EF4444" : edgeColor} />
            <text
              x={midX + 8}
              y={midY - 11}
              fill={isSelected && edgeDeleteHover ? "#EF4444" : "#4B5563"}
              fontSize={8}
              fontFamily={font}
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

    function handleMinimapClick(e: React.MouseEvent<HTMLDivElement>) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const worldX = clickX / scale + minX;
      const worldY = clickY / scale + minY;
      setCanvasOffset({
        x: -(worldX - vpW / 2) * zoom,
        y: -(worldY - vpH / 2) * zoom,
      });
    }

    return (
      <div
        onClick={handleMinimapClick}
        style={{
          position: "absolute",
          bottom: 16,
          right: 56,
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
            pointerEvents: "none",
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
          <g transform={`translate(${canvasOffset.x}, ${canvasOffset.y}) scale(${zoom})`} style={{ pointerEvents: "auto" }}>
            {renderSvgConnections()}
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
          {jobs.map((job) => {
            const pos = nodePositions[job.id] ?? { x: 0, y: 0 };
            const isSelected = job.id === canvasModalJobId;
            const isConnectSource = connectingMode?.sourceId === job.id;
            const isHovered = hoveredNodeId === job.id;
            const isRunning = runningJobIds.has(job.id);
            const isDraggingThis = dragging?.id === job.id && isDraggingNode;
            let borderColor = "#2a2a2a";
            if (isDraggingThis && dragDeleteHover) borderColor = "#EF4444";
            else if (isDraggingThis) borderColor = "#FAFAFA";
            else if (isRunning) borderColor = "#10B981";
            else if (isSelected) borderColor = "#10B981";
            else if (isConnectSource) borderColor = connectingMode?.type === "success" ? "#10B981" : "#EF4444";
            else if (connectingMode && isHovered) borderColor = connectingMode.type === "success" ? "#10B981" : "#EF4444";

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
                  transition: dragging?.id === job.id ? "none" : "border-color 0.15s",
                  animation: isDraggingThis
                    ? (dragDeleteHover ? "node-shake-scared 0.2s ease-in-out infinite" : "node-shake 0.3s ease-in-out infinite")
                    : "none",
                  zIndex: isDraggingThis ? 200 : "auto",
                  opacity: isDraggingThis && dragDeleteHover ? 0.5 : 1,
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
                  {job.type} &middot; {scheduleInfo}
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
          <span style={{ color: "#10B981" }}>&gt; </span>
          <span style={{ color: "#FAFAFA" }}>quant</span>
        </div>

        {/* Floating action island */}
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
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
          {/* on success */}
          <button
            onClick={() => setConnectingMode(connectingMode?.type === "success" ? null : { type: "success" })}
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
              color: connectingMode?.type === "success" ? "#FAFAFA" : "#10B981",
            }}
          >
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", backgroundColor: "#10B981" }} />
            on success
          </button>
          {/* on failure */}
          <button
            onClick={() => setConnectingMode(connectingMode?.type === "failure" ? null : { type: "failure" })}
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
              color: connectingMode?.type === "failure" ? "#FAFAFA" : "#EF4444",
            }}
          >
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", backgroundColor: "#EF4444" }} />
            on failure
          </button>
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
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen" style={{ backgroundColor: "#0A0A0A", fontFamily: font }}>
      <style>{pulseKeyframes}</style>
      {renderCanvasView()}
    </div>
  );
}
