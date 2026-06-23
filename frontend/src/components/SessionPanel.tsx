import { useEffect, useRef, useState, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import type { Session, Task, Config } from "../types";
import { StatusDot } from "./StatusDot";
import { TerminalPane } from "./TerminalPane";
import { IconButton } from "./IconButton";
import { Button } from "./Button";
import { Pill } from "./Pill";
import { Icon } from "./Icon";
import * as api from "../api";
import { pttService, type PttState } from "../voice/pttService";
import { getActiveKeybindings, formatKeyCombo } from "../keybindings";

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
  // Pane-toggle pills (Files / Terminal / Mindmap / Voice) rendered in this
  // header's right group, owned and built by App (it holds the pane state).
  paneToggles?: ReactNode;
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
  paneToggles,
}: Props) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [termConfig, setTermConfig] = useState<Config | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // The terminal pane is considered "open" for the active session per the
  // App-owned per-session flag (terminalPaneOpen prop). The embedded terminal,
  // mindmap, files and voice panes are now rendered in the App-owned right-hand
  // drag-tileable dock (SessionDock) rather than inline splits here.
  //
  // Opening the terminal pane: lazily create the embedded terminal session (if
  // one doesn't already exist) so the dock's "terminal" leaf has a session to
  // show, then flip the App-level open flag. Closing just flips the flag.
  const terminalOpen = terminalPaneOpen;
  async function handleOpenTerminal() {
    if (terminalOpen) return;
    if (embeddedTerminalSession) {
      onTerminalPaneOpenChange?.(true);
      return;
    }
    try {
      await onCreateEmbeddedTerminal(session);
      onTerminalPaneOpenChange?.(true);
    } catch {
      // Failed to create embedded terminal
    }
  }

  function handleCloseTerminal() {
    onTerminalPaneOpenChange?.(false);
  }

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

        {/* Right: pane toggles + mic + hamburger */}
        <div className="flex items-center gap-1.5 shrink-0">

          {/* Pane-toggle pills (Files / Terminal / Mindmap / Voice), built by
              App and passed in. Sit left of the mic/menu in this header. */}
          {paneToggles && (
            <div className="flex items-center" style={{ gap: 9, marginRight: 6 }}>
              {paneToggles}
            </div>
          )}

          {/* Unarchive button */}
          {isArchived && onUnarchive && (
            <Button variant="subtle" size="sm" icon="unarchive" onClick={() => onUnarchive(session.id)}>
              unarchive
            </Button>
          )}

          {/* Terminal / Mindmap / Voice toggles moved to the App-level ActionBar
              (below the tab bar). The pane open/close props are still passed in
              and owned by App; this header no longer renders the toggles. */}

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

      {/* The session's own terminal/output is the fixed main area. The embedded
          terminal, mindmap, files and voice panes now live in the App-owned
          right-hand drag-tileable dock (SessionDock) instead of inline splits,
          so they can be re-tiled/resized without disturbing this main pane. */}
      <div className="flex-1 min-h-0 flex flex-col">
        <TerminalPane
          session={session}
          isArchived={isArchived}
          onStart={onStart}
          onResume={onResume}
          termConfig={termConfig}
          autoScroll={autoScroll}
          onAutoScrollChange={setAutoScroll}
        />
      </div>
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

