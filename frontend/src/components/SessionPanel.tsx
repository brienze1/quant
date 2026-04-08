import { useEffect, useRef, useState, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";
import type { Session, Task, Config } from "../types";
import { StatusDot } from "./StatusDot";
import { TerminalPane } from "./TerminalPane";
import * as api from "../api";

type SplitLayout = "horizontal" | "vertical";

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
  const menuRef = useRef<HTMLDivElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null!)
  const isDragging = useRef(false);

  const isArchived = displayStatus === "archived";
  const isPaused = displayStatus === "paused";

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

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--q-bg)" }}>
      {/* Action bar */}
      <div
        className="flex items-center justify-between px-5 shrink-0"
        style={{
          backgroundColor: "var(--q-bg)",
          borderBottom: "1px solid var(--q-border)",
          fontFamily: "'JetBrains Mono', monospace",
          height: 32,
        }}
      >
        {/* Left: status + name + badges */}
        <div className="flex items-center gap-2 overflow-hidden">
          <StatusDot status={displayStatus} />
          <span
            className="text-xs font-bold overflow-hidden whitespace-nowrap"
            style={{ color: "var(--q-fg)", textOverflow: "ellipsis" }}
          >
            {session.name}
          </span>
          {task && (
            <span
              className="shrink-0 text-[9px] px-1.5 py-0.5"
              style={{
                color: "var(--q-accent)",
                border: "1px solid var(--q-border)",
                backgroundColor: "var(--q-bg-hover)",
              }}
            >
              # {task.tag}
            </span>
          )}
          {session.worktreePath && (
            <span
              className="shrink-0 text-[9px] px-1.5 py-0.5"
              style={{
                color: "var(--q-accent)",
                border: "1px solid var(--q-border)",
                backgroundColor: "var(--q-bg-hover)",
              }}
            >
              wt {session.branchName}
            </span>
          )}
        </div>

        {/* Right: terminal btn + layout toggle + hamburger */}
        <div className="flex items-center gap-3 shrink-0">

          {/* Unarchive button */}
          {isArchived && onUnarchive && (
            <ActionBtn label="$ unarchive" onClick={() => onUnarchive(session.id)} color="var(--q-accent)" />
          )}

          {/* Terminal button */}
          {!isArchived && (
            <button
              onClick={splitState.open ? handleCloseTerminal : handleOpenTerminal}
              className="flex items-center gap-1 px-2 py-1 text-[11px]"
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                color: splitState.open ? "var(--q-bg)" : "var(--q-cyan)",
                backgroundColor: splitState.open ? "var(--q-cyan)" : "var(--q-bg-hover)",
                border: `1px solid ${splitState.open ? "var(--q-cyan)" : "var(--q-border)"}`,
              }}
              onMouseEnter={(e) => {
                if (!splitState.open) e.currentTarget.style.backgroundColor = "var(--q-border)";
              }}
              onMouseLeave={(e) => {
                if (!splitState.open) e.currentTarget.style.backgroundColor = "var(--q-bg-hover)";
              }}
            >
              <span style={{ fontWeight: 700 }}>$</span>
              <span>terminal</span>
            </button>
          )}

          {/* Layout toggle (only when split is open) */}
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

          {/* Hamburger menu */}
          {!isArchived && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center justify-center"
                style={{
                  width: 20,
                  height: 20,
                  color: menuOpen ? "var(--q-fg)" : "var(--q-fg-secondary)",
                }}
                onMouseEnter={(e) => { if (!menuOpen) e.currentTarget.style.color = "var(--q-fg)"; }}
                onMouseLeave={(e) => { if (!menuOpen) e.currentTarget.style.color = "var(--q-fg-secondary)"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </svg>
              </button>

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

      {/* Split container */}
      <SplitContainer
        splitContainerRef={splitContainerRef}
        splitState={splitState}
        onDividerMouseDown={handleDividerMouseDown}
        primaryPane={
          <>
            {splitState.open && (
              <PaneHeader
                label={session.sessionType === "claude" ? "claude" : "terminal"}
                dotColor={session.sessionType === "claude" ? "var(--q-accent)" : "var(--q-cyan)"}
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
              <PaneHeader
                label="terminal"
                dotColor="var(--q-cyan)"
                onClose={handleCloseTerminal}
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
    </div>
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
            borderTop: isH ? "1px solid var(--q-border)" : undefined,
            borderBottom: isH ? "1px solid var(--q-border)" : undefined,
            borderLeft: !isH ? "1px solid var(--q-border)" : undefined,
            borderRight: !isH ? "1px solid var(--q-border)" : undefined,
            zIndex: 1,
          }}
          onMouseEnter={(e) => {
            const grip = e.currentTarget.querySelector("[data-grip]") as HTMLElement;
            if (grip) grip.style.backgroundColor = "var(--q-accent)";
          }}
          onMouseLeave={(e) => {
            const grip = e.currentTarget.querySelector("[data-grip]") as HTMLElement;
            if (grip) grip.style.backgroundColor = "var(--q-fg-muted)";
          }}
        >
          <div
            data-grip
            style={{
              width: isH ? 32 : 2,
              height: isH ? 2 : 32,
              backgroundColor: "var(--q-fg-muted)",
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

function PaneHeader({
  label,
  dotColor,
  onClose,
}: {
  label: string;
  dotColor: string;
  onClose?: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between px-4 shrink-0"
      style={{
        height: 24,
        backgroundColor: "var(--q-bg-input)",
        borderBottom: "1px solid var(--q-border)",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      <div className="flex items-center gap-1.5">
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: dotColor,
          }}
        />
        <span style={{ fontSize: 10, color: "var(--q-fg-secondary)" }}>{label}</span>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="text-[9px] transition-colors"
          style={{ color: "var(--q-fg-muted)", fontFamily: "'JetBrains Mono', monospace" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-muted)")}
        >
          [x]
        </button>
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
  const borderColor = active ? "var(--q-accent)" : "var(--q-border)";
  const fillColor = active ? "var(--q-accent)" : "var(--q-fg-secondary)";
  const isHorizontal = type === "horizontal";

  return (
    <button
      onClick={onClick}
      style={{
        width: 20,
        height: 16,
        backgroundColor: "var(--q-bg-hover)",
        border: `1px solid ${borderColor}`,
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
        backgroundColor: "var(--q-bg-menu)",
        border: "1px solid var(--q-border)",
        padding: "4px 0",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        zIndex: 50,
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
      }}
    >
      {isRunning && onRestart && (
        <MenuItemRow onClick={onRestart}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--q-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          <span style={{ color: "var(--q-fg)" }}>restart</span>
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
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        cursor: "pointer",
        textAlign: "left",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--q-bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      {children}
    </button>
  );
}

function ActionBtn({
  label,
  onClick,
  color,
}: {
  label: string;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 text-[10px] lowercase transition-colors"
      style={{
        color,
        fontFamily: "'JetBrains Mono', monospace",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--q-bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      {label}
    </button>
  );
}
