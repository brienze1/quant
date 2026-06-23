import { useEffect, useRef, useState, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";
import type { Session, Task, Config } from "../types";
import { StatusDot } from "./StatusDot";
import { TerminalPane } from "./TerminalPane";
import { MindmapPane } from "./MindmapPane";
import { PaneHeader as UiPaneHeader } from "./PaneHeader";
import { IconButton } from "./IconButton";
import { Button } from "./Button";
import { Pill } from "./Pill";
import { Icon } from "./Icon";
import * as api from "../api";
import { pttService, type PttState } from "../voice/pttService";
import { getActiveKeybindings, formatKeyCombo } from "../keybindings";

type SplitLayout = "horizontal" | "vertical";

// Per-session mindmap dock geometry (split layout + divider %), persisted per
// session in localStorage — mirroring how boards persist under
// "quant.mindmapBoard.<sessionId>". SessionPanel is a single instance reused
// across tab switches, so without keying these by session id a resize in one
// session would silently resize every other session's pane too.
const MM_LAYOUT_KEY = "quant.mindmapLayout.";
const MM_DIVIDER_KEY = "quant.mindmapDivider.";

function loadMindmapLayout(sessionId: string): SplitLayout {
  return localStorage.getItem(MM_LAYOUT_KEY + sessionId) === "horizontal"
    ? "horizontal"
    : "vertical";
}

function loadMindmapDivider(sessionId: string): number {
  const v = Number(localStorage.getItem(MM_DIVIDER_KEY + sessionId));
  return Number.isFinite(v) && v >= 20 && v <= 80 ? v : 55;
}

interface SplitState {
  open: boolean;
  terminalSession: Session | null;
  layout: SplitLayout;
  dividerPercent: number;
}

interface Props {
  session: Session;
  task: Task | null;
  onStart: (id: string, rows: number, cols: number) => void;
  onResume: (id: string, rows: number, cols: number) => void;
  onRestart: (id: string, rows: number, cols: number) => void;
  onUnarchive?: (id: string) => void;
  displayStatus: import("./StatusBadge").DisplayStatus;
  embeddedTerminalSession?: Session | null;
  terminalPaneOpen?: boolean;
  onTerminalPaneOpenChange?: (open: boolean) => void;
  // Mindmap pane open/closed is a PER-SESSION flag owned by App
  // (mindmapPaneOpenMap) — ephemeral, every pane starts closed on launch.
  mindmapPaneOpen: boolean;
  onMindmapPaneOpenChange: (open: boolean) => void;
  // Voice pane open/closed is a single GLOBAL flag owned by App (config-backed,
  // synced across tabs and remote clients) — mirrors the mindmap pane flag.
  voicePaneOpen: boolean;
  onVoicePaneOpenChange: (open: boolean) => void;
  onCreateEmbeddedTerminal: (parentSession: Session) => Promise<Session>;
}

export function SessionPanel({
  session,
  task,
  onStart,
  onResume,
  onRestart,
  onUnarchive,
  displayStatus,
  embeddedTerminalSession,
  terminalPaneOpen = false,
  onTerminalPaneOpenChange,
  mindmapPaneOpen,
  onMindmapPaneOpenChange,
  voicePaneOpen,
  onVoicePaneOpenChange,
  onCreateEmbeddedTerminal,
}: Props) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [termConfig, setTermConfig] = useState<Config | null>(null);
  const [splitState, setSplitState] = useState<SplitState>({
    open: false,
    terminalSession: null,
    layout: "horizontal",
    dividerPercent: 55,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  // The mindmap split is independent of the terminal split: it has its own
  // layout (default vertical so the mindmap docks on the right) and divider.
  // Both are PER-SESSION: hydrated from localStorage whenever the session
  // changes, persisted back per session id.
  const [mindmapLayout, setMindmapLayoutState] = useState<SplitLayout>(() => loadMindmapLayout(session.id));
  const [mindmapDividerPercent, setMindmapDividerPercent] = useState(() => loadMindmapDivider(session.id));
  // Mirrors the divider state so the mouseup handler can persist the final
  // value without re-registering listeners on every mousemove.
  const mindmapDividerRef = useRef(mindmapDividerPercent);
  const menuRef = useRef<HTMLDivElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null!)
  const mindmapContainerRef = useRef<HTMLDivElement>(null!)
  const isDragging = useRef(false);
  const isDraggingMindmap = useRef(false);

  const isArchived = displayStatus === "archived";
  const isPaused = displayStatus === "paused";

  // PTT button mirrors the shared pttService singleton, so a hotkey-started
  // capture can be stopped by clicking the button (and vice versa).
  const [pttState, setPttState] = useState<PttState>(pttService.getState());
  // Set while a mousedown on the button started the current capture: a quick
  // release (<300ms) leaves it recording (toggle), a long hold stops on release.
  const pttPressRef = useRef<{ downAt: number } | null>(null);
  useEffect(() => pttService.onState(setPttState), []);

  function handlePttMouseDown() {
    if (pttState === "transcribing") return;
    if (pttService.isCapturing()) {
      void pttService.stop();
      return;
    }
    pttPressRef.current = { downAt: Date.now() };
    // Starts as a hold (cancelled if the window blurs mid-press); a quick
    // release below upgrades it to a toggle that survives blur.
    void pttService.start(session.id, "hold");
  }

  function handlePttMouseUp() {
    const press = pttPressRef.current;
    pttPressRef.current = null;
    if (!press) return;
    if (Date.now() - press.downAt >= 300) {
      void pttService.stop();
    } else {
      pttService.setMode("toggle");
    }
  }

  function handlePttMouseLeave() {
    if (!pttPressRef.current) return;
    pttPressRef.current = null;
    void pttService.stop();
  }

  // Load terminal config on mount
  useEffect(() => {
    api.getConfig().then((cfg) => {
      setTermConfig(cfg);
    }).catch(() => {});
  }, []);

  // When session changes, restore open state and terminal session from persistent props
  useEffect(() => {
    setSplitState(prev => ({
      ...prev,
      open: terminalPaneOpen && !!(embeddedTerminalSession || prev.terminalSession),
      terminalSession: embeddedTerminalSession || null,
    }));
    // Hydrate THIS session's mindmap dock geometry (the open flag itself is
    // per-session App state passed down as a prop).
    const layout = loadMindmapLayout(session.id);
    const divider = loadMindmapDivider(session.id);
    setMindmapLayoutState(layout);
    setMindmapDividerPercent(divider);
    mindmapDividerRef.current = divider;
    // A divider drag must never survive a session switch: the divider element
    // can unmount mid-drag (pane closed on the next session), which would
    // leave the dragging flag stuck and let plain mouse movement silently
    // resize the pane.
    if (isDraggingMindmap.current || isDragging.current) {
      isDraggingMindmap.current = false;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Split divider drag handling
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = splitState.layout === "horizontal" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  }, [splitState.layout]);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isDragging.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      let percent: number;
      if (splitState.layout === "horizontal") {
        percent = ((e.clientY - rect.top) / rect.height) * 100;
      } else {
        percent = ((e.clientX - rect.left) / rect.width) * 100;
      }
      setSplitState(prev => ({ ...prev, dividerPercent: Math.min(80, Math.max(20, percent)) }));
    }
    function handleMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [splitState.layout]);

  // Mindmap split divider drag handling (independent of the terminal split).
  const handleMindmapDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingMindmap.current = true;
    document.body.style.cursor = mindmapLayout === "horizontal" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  }, [mindmapLayout]);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isDraggingMindmap.current || !mindmapContainerRef.current) return;
      const rect = mindmapContainerRef.current.getBoundingClientRect();
      let percent: number;
      if (mindmapLayout === "horizontal") {
        percent = ((e.clientY - rect.top) / rect.height) * 100;
      } else {
        percent = ((e.clientX - rect.left) / rect.width) * 100;
      }
      const clamped = Math.min(80, Math.max(20, percent));
      mindmapDividerRef.current = clamped;
      setMindmapDividerPercent(clamped);
    }
    function handleMouseUp() {
      if (!isDraggingMindmap.current) return;
      isDraggingMindmap.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Persist the final divider position for THIS session only.
      localStorage.setItem(
        MM_DIVIDER_KEY + session.id,
        String(Math.round(mindmapDividerRef.current))
      );
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [mindmapLayout, session.id]);

  // Switch the mindmap dock layout and persist it for this session.
  const setMindmapLayout = useCallback((l: SplitLayout) => {
    setMindmapLayoutState(l);
    localStorage.setItem(MM_LAYOUT_KEY + session.id, l);
  }, [session.id]);

  async function handleOpenTerminal() {
    if (splitState.open) return;
    const existing = splitState.terminalSession || embeddedTerminalSession;
    if (existing) {
      setSplitState(prev => ({ ...prev, open: true, terminalSession: existing }));
      onTerminalPaneOpenChange?.(true);
      return;
    }
    try {
      const termSession = await onCreateEmbeddedTerminal(session);
      setSplitState(prev => ({ ...prev, open: true, terminalSession: termSession }));
      onTerminalPaneOpenChange?.(true);
    } catch {
      // Failed to create embedded terminal
    }
  }

  function handleCloseTerminal() {
    setSplitState(prev => ({ ...prev, open: false }));
    onTerminalPaneOpenChange?.(false);
  }

  function handleToggleLayout() {
    setSplitState(prev => ({
      ...prev,
      layout: prev.layout === "horizontal" ? "vertical" : "horizontal",
    }));
  }

  // The terminal split's secondary pane (the embedded terminal) is open only
  // when a terminal session exists and the user has toggled it open.
  const terminalSecondaryOpen = splitState.open && !!splitState.terminalSession;
  // The OUTER split's secondary pane is the mindmap "dock" — independent of the
  // terminal split, so both the embedded terminal and the dock can show at once.
  //
  // NOTE: the VOICE pane is NO LONGER rendered here. Voice is pinned to the
  // session it was opened on and must survive active-tab switches, so it is
  // mounted at App scope (keyed by voiceSessionId) and rendered as a persistent
  // right-docked panel — not inside this per-active-tab SessionPanel, which
  // unmounts on tab switch. Files moved out too (right files panel + center
  // file tabs, both App-owned). SessionPanel only owns the mindmap dock now.
  const dockOpen = mindmapPaneOpen;
  const dockSplitState: SplitState = {
    open: dockOpen,
    terminalSession: null,
    layout: mindmapLayout,
    dividerPercent: mindmapDividerPercent,
  };
  const terminalSplitState: SplitState = { ...splitState, open: terminalSecondaryOpen };

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--panel)" }}>
      {/* Action bar */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          backgroundColor: "var(--panel)",
          borderBottom: "1px solid var(--border-2)",
          height: 38,
          padding: "0 10px 0 14px",
          gap: 8,
        }}
      >
        {/* Left: status + name + badges */}
        <div className="flex items-center gap-2 overflow-hidden">
          <StatusDot status={displayStatus} glow />
          <span
            className="overflow-hidden whitespace-nowrap"
            style={{ color: "var(--fg)", textOverflow: "ellipsis", fontSize: 12.5, fontWeight: 600, letterSpacing: "-0.01em" }}
          >
            {session.name}
          </span>
          {task && (
            <Pill tone="accent" style={{ display: "inline-flex", alignItems: "center" }}>
              <Icon name="hash" size={9} style={{ display: "inline", verticalAlign: "-1px", marginRight: 2 }} />
              {task.tag}
            </Pill>
          )}
          {session.worktreePath && (
            <Pill tone="info" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Icon name="branch" size={9} style={{ display: "inline", verticalAlign: "-1px" }} />
              {session.branchName}
            </Pill>
          )}
        </div>

        {/* Right: terminal btn + layout toggle + hamburger */}
        <div className="flex items-center gap-1.5 shrink-0">

          {/* Unarchive button */}
          {isArchived && onUnarchive && (
            <Button variant="subtle" size="sm" icon="unarchive" onClick={() => onUnarchive(session.id)}>
              unarchive
            </Button>
          )}

          {/* Terminal button */}
          {!isArchived && (
            <Button
              variant="ghost"
              size="sm"
              icon="terminal"
              active={splitState.open}
              onClick={splitState.open ? handleCloseTerminal : handleOpenTerminal}
            >
              terminal
            </Button>
          )}

          {/* Mindmap button */}
          {!isArchived && (
            <Button
              variant="ghost"
              size="sm"
              icon="waypoints"
              active={mindmapPaneOpen}
              onClick={() => onMindmapPaneOpenChange(!mindmapPaneOpen)}
            >
              mindmap
            </Button>
          )}

          {/* Voice button (mirrors the mindmap toggle; uses the themed
              --purple accent so it tracks theme changes like its siblings).
              Gated on TWO conditions, both of which must hold:
                1. config.voice.enabled — voice feature turned on in Settings.
                2. The session has a LIVE agent process. "running" (mid-turn),
                   "waiting" and "done" (agent idle at the prompt, ready for
                   input) all have a live PTY the kickoff can write to. Idle /
                   paused / stopped / starting have no live process, so we
                   disable the toggle (and never fire the kickoff) there to
                   avoid a confusing "no process running" failure. */}
          {!isArchived && (() => {
            const voiceEnabled = termConfig?.voice?.enabled ?? false;
            const agentAlive =
              displayStatus === "running" ||
              displayStatus === "waiting" ||
              displayStatus === "done";
            const canToggle = voiceEnabled && agentAlive;
            const tooltip = !voiceEnabled
              ? "Enable voice in Settings"
              : !agentAlive
                ? "Start the session's agent first"
                : "toggle voice pane";
            return (
              <Button
                variant="ghost"
                size="sm"
                icon="waveform"
                disabled={!canToggle}
                title={tooltip}
                onClick={() => { if (canToggle) onVoicePaneOpenChange(!voicePaneOpen); }}
                style={
                  voicePaneOpen
                    ? {
                        background: "color-mix(in srgb, var(--purple) 13%, transparent)",
                        color: "var(--purple)",
                        borderColor: "color-mix(in srgb, var(--purple) 45%, var(--border))",
                      }
                    : { color: "var(--purple)" }
                }
              >
                voice
              </Button>
            );
          })()}

          {/* Push-to-talk mic button (peer of the voice button). Quick click
              toggles a capture on/off; press-and-hold captures while held and
              stops on release. Shares the pttService singleton with the global
              hotkeys, so either side can stop a capture the other started. While
              recording the mic glyph fills red and a thin level cue shows right
              of it. */}
          {!isArchived && (() => {
            const voiceEnabled = termConfig?.voice?.enabled ?? false;
            const agentAlive =
              displayStatus === "running" ||
              displayStatus === "waiting" ||
              displayStatus === "done";
            const canPtt = voiceEnabled && agentAlive;
            const bindings = getActiveKeybindings();
            const holdKeys = bindings.find((b) => b.id === "pttHold")?.keys;
            const toggleKeys = bindings.find((b) => b.id === "pttToggle")?.keys;
            const tooltip = !voiceEnabled
              ? "Enable voice in Settings"
              : !agentAlive
                ? "Start the session's agent first"
                : `Push-to-talk — hold ${holdKeys ? formatKeyCombo(holdKeys) : "?"} / toggle ${toggleKeys ? formatKeyCombo(toggleKeys) : "?"} (click = toggle, press & hold = talk)`;
            const recording = pttState === "recording";
            const transcribing = pttState === "transcribing";
            const errored = pttState === "error";
            const fg = recording || errored
              ? "var(--danger)"
              : transcribing
                ? "var(--fg-3)"
                : canPtt
                  ? "var(--purple)"
                  : "var(--fg-3)";
            const border = recording || errored ? "var(--danger)" : "var(--border)";
            return (
              <button
                type="button"
                onMouseDown={(e) => { if (e.button === 0 && canPtt) handlePttMouseDown(); }}
                onMouseUp={(e) => { if (e.button === 0 && canPtt) handlePttMouseUp(); }}
                disabled={!canPtt}
                title={tooltip}
                aria-label={tooltip}
                className="flex items-center justify-center gap-1"
                style={{
                  width: recording ? "auto" : 26,
                  height: 26,
                  padding: recording ? "0 7px" : 0,
                  borderRadius: 7,
                  color: fg,
                  backgroundColor: "transparent",
                  border: `1px solid ${border}`,
                  opacity: canPtt ? (transcribing ? 0.7 : 1) : 0.45,
                  cursor: canPtt ? "pointer" : "default",
                }}
                onMouseEnter={(e) => {
                  if (canPtt && pttState === "idle") e.currentTarget.style.backgroundColor = "var(--hover)";
                }}
                onMouseLeave={(e) => {
                  if (canPtt) handlePttMouseLeave();
                  if (canPtt && pttState === "idle") e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <MicIcon filled={recording} />
                {recording && <PttLevelCue />}
              </button>
            );
          })()}

          {/* Terminal split layout toggle (only when the terminal split is open) */}
          {splitState.open && (
            <div className="flex items-center gap-0.5">
              <LayoutIcon
                type="horizontal"
                active={splitState.layout === "horizontal"}
                onClick={() => setSplitState(prev => ({ ...prev, layout: "horizontal" }))}
              />
              <LayoutIcon
                type="vertical"
                active={splitState.layout === "vertical"}
                onClick={() => setSplitState(prev => ({ ...prev, layout: "vertical" }))}
              />
            </div>
          )}

          {/* Dock layout toggle (controls where the mindmap dock sits
              relative to the session — shown only when the dock is open). */}
          {dockOpen && (
            <div className="flex items-center gap-0.5">
              <LayoutIcon
                type="horizontal"
                active={mindmapLayout === "horizontal"}
                onClick={() => setMindmapLayout("horizontal")}
              />
              <LayoutIcon
                type="vertical"
                active={mindmapLayout === "vertical"}
                onClick={() => setMindmapLayout("vertical")}
              />
            </div>
          )}

          {/* Hamburger menu */}
          {!isArchived && (
            <div className="relative" ref={menuRef}>
              <IconButton
                name="dots"
                size={15}
                label="Menu"
                active={menuOpen}
                onClick={() => setMenuOpen(!menuOpen)}
              />

              {menuOpen && (
                <HamburgerMenu
                  isRunning={session.status === "running"}
                  onRestart={() => onRestart(session.id, 24, 80)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Outer split: the whole terminal block on the primary side, the
          mindmap dock on the secondary side. Both splits are independent, so
          the embedded terminal and the dock can show at the same time without
          overlapping. */}
      <SplitContainer
        splitContainerRef={mindmapContainerRef}
        splitState={dockSplitState}
        onDividerMouseDown={handleMindmapDividerMouseDown}
        primaryPane={
          /* Inner split: session output (primary) + optional embedded terminal */
          <SplitContainer
            splitContainerRef={splitContainerRef}
            splitState={terminalSplitState}
            onDividerMouseDown={handleDividerMouseDown}
            primaryPane={
              <>
                {terminalSecondaryOpen && (
                  <UiPaneHeader
                    dot
                    eyebrow={session.sessionType === "claude" ? "claude" : "terminal"}
                    dotColor={session.sessionType === "claude" ? "var(--accent)" : "var(--info)"}
                    sub={session.name}
                  />
                )}
                <TerminalPane
                  session={session}
                  isArchived={isArchived}
                  onStart={onStart}
                  onResume={onResume}
                  termConfig={termConfig}
                  autoScroll={autoScroll}
                  onAutoScrollChange={setAutoScroll}
                />
              </>
            }
            secondaryPane={
              splitState.open && splitState.terminalSession ? (
                <>
                  <UiPaneHeader
                    dot
                    eyebrow="terminal"
                    dotColor="var(--info)"
                    sub={splitState.terminalSession.name}
                    actions={<IconButton name="x" size={13} label="Close" onClick={handleCloseTerminal} />}
                  />
                  <TerminalPane
                    session={splitState.terminalSession}
                    isArchived={false}
                    onStart={onStart}
                    onResume={onResume}
                    termConfig={termConfig}
                    autoScroll={true}
                    onAutoScrollChange={() => {}}
                  />
                </>
              ) : null
            }
          />
        }
        secondaryPane={
          dockOpen ? (
            <>
              <UiPaneHeader
                dot
                eyebrow="mindmap"
                dotColor="var(--info)"
                actions={<IconButton name="x" size={13} label="Close" onClick={() => onMindmapPaneOpenChange(false)} />}
              />
              <div className="flex-1 min-h-0">
                <MindmapPane sessionId={session.id} />
              </div>
            </>
          ) : null
        }
      />
    </div>
  );
}

// Microphone glyph for the PTT button: rounded capsule + stand + base.
// Inherits the button's `currentColor`; `filled` paints the capsule solid
// (recording state) instead of an outline.
function MicIcon({ filled }: { filled?: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x={9} y={2} width={6} height={11} rx={3} fill={filled ? "currentColor" : "none"} />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1={12} y1={18} x2={12} y2={22} />
      <line x1={8} y1={22} x2={16} y2={22} />
    </svg>
  );
}

// Compact inline mic-level cue for the action bar (no room for the full 6-bar
// meter). Three thin segments sized to the bar row; mounted only while
// recording, polling pttService.getLevel() per animation frame.
const PTT_CUE_SEGMENTS = 3;

function PttLevelCue() {
  const [lit, setLit] = useState(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const lvl = pttService.getLevel();
      // Small noise floor so an idle mic shows 0 segments rather than flicker.
      const n = lvl <= 0.02 ? 0 : Math.max(1, Math.round(lvl * PTT_CUE_SEGMENTS));
      setLit((prev) => (prev === n ? prev : n));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <span
      aria-label="mic level"
      title="mic level"
      style={{ display: "inline-flex", alignItems: "center", gap: 1 }}
    >
      {Array.from({ length: PTT_CUE_SEGMENTS }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 2,
            height: 10,
            borderRadius: 1,
            backgroundColor: i < lit ? "var(--danger)" : "var(--border)",
            opacity: i < lit ? 1 : 0.5,
            transition: "background-color .05s linear, opacity .05s linear",
          }}
        />
      ))}
    </span>
  );
}

/**
 * SplitContainer uses absolute positioning so that pane resizes are instant
 * and xterm.js does not do a slow reflow animation. The parent is `position: relative`
 * and each pane is `position: absolute` with explicit top/left/width/height in pixels,
 * calculated from the container's own dimensions via a ResizeObserver.
 */
function SplitContainer({
  splitContainerRef,
  splitState,
  onDividerMouseDown,
  primaryPane,
  secondaryPane,
}: {
  splitContainerRef: React.RefObject<HTMLDivElement>;
  splitState: SplitState;
  onDividerMouseDown: (e: React.MouseEvent) => void;
  primaryPane: React.ReactNode;
  secondaryPane: React.ReactNode;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = splitContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    // Set initial size
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [splitContainerRef]);

  const DIVIDER = 6;
  const isH = splitState.layout === "horizontal";
  const isOpen = splitState.open && secondaryPane != null;

  // Calculate pixel sizes
  let primaryStyle: React.CSSProperties;
  let dividerStyle: React.CSSProperties | null = null;
  let secondaryStyle: React.CSSProperties | null = null;

  if (!isOpen) {
    primaryStyle = { position: "absolute", top: 0, left: 0, width: size.w, height: size.h };
  } else {
    const total = isH ? size.h : size.w;
    const primaryPx = Math.round((total - DIVIDER) * splitState.dividerPercent / 100);
    const secondaryPx = total - DIVIDER - primaryPx;

    if (isH) {
      primaryStyle = { position: "absolute", top: 0, left: 0, width: size.w, height: primaryPx };
      dividerStyle = { position: "absolute", top: primaryPx, left: 0, width: size.w, height: DIVIDER };
      secondaryStyle = { position: "absolute", top: primaryPx + DIVIDER, left: 0, width: size.w, height: secondaryPx };
    } else {
      primaryStyle = { position: "absolute", top: 0, left: 0, width: primaryPx, height: size.h };
      dividerStyle = { position: "absolute", top: 0, left: primaryPx, width: DIVIDER, height: size.h };
      secondaryStyle = { position: "absolute", top: 0, left: primaryPx + DIVIDER, width: secondaryPx, height: size.h };
    }
  }

  return (
    <div
      ref={splitContainerRef}
      className="flex-1 min-h-0"
      style={{ position: "relative", overflow: "hidden" }}
    >
      {/* Primary pane */}
      <div style={{ ...primaryStyle, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {primaryPane}
      </div>

      {/* Divider */}
      {isOpen && dividerStyle && (
        <div
          onMouseDown={onDividerMouseDown}
          style={{
            ...dividerStyle,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: isH ? "row-resize" : "col-resize",
            borderTop: isH ? "1px solid var(--border-2)" : undefined,
            borderBottom: isH ? "1px solid var(--border-2)" : undefined,
            borderLeft: !isH ? "1px solid var(--border-2)" : undefined,
            borderRight: !isH ? "1px solid var(--border-2)" : undefined,
            zIndex: 1,
          }}
          onMouseEnter={(e) => {
            const grip = e.currentTarget.querySelector("[data-grip]") as HTMLElement;
            if (grip) grip.style.backgroundColor = "var(--accent)";
          }}
          onMouseLeave={(e) => {
            const grip = e.currentTarget.querySelector("[data-grip]") as HTMLElement;
            if (grip) grip.style.backgroundColor = "var(--fg-3)";
          }}
        >
          <div
            data-grip
            style={{
              width: isH ? 32 : 2,
              height: isH ? 2 : 32,
              backgroundColor: "var(--fg-3)",
              borderRadius: 1,
            }}
          />
        </div>
      )}

      {/* Secondary pane */}
      {isOpen && secondaryStyle && (
        <div style={{ ...secondaryStyle, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {secondaryPane}
        </div>
      )}
    </div>
  );
}

function LayoutIcon({
  type,
  active,
  onClick,
}: {
  type: "horizontal" | "vertical";
  active: boolean;
  onClick: () => void;
}) {
  const borderColor = active ? "var(--accent)" : "var(--border)";
  const fillColor = active ? "var(--accent)" : "var(--fg-3)";
  const isHorizontal = type === "horizontal";

  return (
    <button
      onClick={onClick}
      style={{
        width: 20,
        height: 16,
        backgroundColor: active ? "var(--accent-soft)" : "var(--hover)",
        border: `1px solid ${borderColor}`,
        borderRadius: "var(--r1)",
        padding: 2,
        display: "flex",
        flexDirection: isHorizontal ? "column" : "row",
        gap: 1,
        cursor: "pointer",
      }}
      title={`${type} split`}
    >
      <div
        style={{
          backgroundColor: fillColor,
          ...(isHorizontal
            ? { width: "100%", height: 5 }
            : { height: "100%", width: 6 }),
        }}
      />
      <div
        style={{
          backgroundColor: fillColor,
          opacity: 0.4,
          ...(isHorizontal
            ? { width: "100%", height: 5 }
            : { height: "100%", width: 6 }),
        }}
      />
    </button>
  );
}

function HamburgerMenu({
  isRunning,
  onRestart,
}: {
  isRunning: boolean;
  onRestart?: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 4,
        width: 160,
        backgroundColor: "var(--panel-3)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r2)",
        padding: "4px 0",
        fontSize: 11.5,
        zIndex: 50,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      {isRunning && onRestart && (
        <MenuItemRow onClick={onRestart}>
          <Icon name="refresh" size={13} color="var(--warn)" />
          <span style={{ color: "var(--fg)" }}>restart</span>
        </MenuItemRow>
      )}
    </div>
  );
}

function MenuItemRow({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-3 transition-colors"
      style={{
        height: 32,
        background: "none",
        border: "none",
        fontSize: 11.5,
        cursor: "pointer",
        textAlign: "left",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      {children}
    </button>
  );
}

