import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Session, Config } from "../types";
import * as api from "../api";
import { useTheme } from "../theme";

interface TerminalPaneProps {
  session: Session;
  isArchived: boolean;
  onStart: (id: string, rows: number, cols: number) => void;
  onResume: (id: string, rows: number, cols: number) => void;
  termConfig: Config | null;
  /** Expose auto-scroll state to parent */
  autoScroll: boolean;
  onAutoScrollChange: (value: boolean) => void;
}

export function TerminalPane({
  session,
  isArchived,
  onStart,
  onResume,
  termConfig,
  autoScroll,
  onAutoScrollChange,
}: TerminalPaneProps) {
  const { theme } = useTheme();
  const tc = theme.colors;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const termContainerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);
  const sessionIdRef = useRef(session.id);
  const autoScrollRef = useRef(autoScroll);
  const isWritingRef = useRef(false);

  sessionIdRef.current = session.id;
  autoScrollRef.current = autoScroll;

  const initTerminal = useCallback(() => {
    if (!termContainerRef.current) return;

    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;

    const cfg = termConfig;
    const term = new Terminal({
      cursorBlink: isArchived ? false : (cfg?.cursorBlink ?? true),
      cursorStyle: (cfg?.cursorStyle as "block" | "underline" | "bar") ?? "block",
      disableStdin: isArchived,
      fontFamily: cfg?.fontFamily ? `'${cfg.fontFamily}', 'Menlo', 'Monaco', monospace` : "'JetBrains Mono', 'Menlo', 'Monaco', monospace",
      fontSize: cfg?.fontSize ?? 13,
      lineHeight: cfg?.lineHeight ?? 1.2,
      scrollback: cfg?.scrollbackLines ?? 10000,
      theme: {
        background: tc.termBg,
        foreground: tc.termFg,
        cursor: isArchived ? tc.bg : tc.termCursor,
        selectionBackground: tc.selectionBg,
        black: tc.termBlack,
        red: tc.termRed,
        green: tc.termGreen,
        yellow: tc.termYellow,
        blue: tc.termBlue,
        magenta: tc.termMagenta,
        cyan: tc.termCyan,
        white: tc.termWhite,
        brightBlack: tc.termBrightBlack,
        brightRed: tc.termBrightRed,
        brightGreen: tc.termBrightGreen,
        brightYellow: tc.termBrightYellow,
        brightBlue: tc.termBrightBlue,
        brightMagenta: tc.termBrightMagenta,
        brightCyan: tc.termBrightCyan,
        brightWhite: tc.termBrightWhite,
      },
      allowProposedApi: true,
    });

    term.loadAddon(fitAddon);
    term.open(termContainerRef.current);
    fitAddon.fit();
    termRef.current = term;

    // Hide native scrollbar: push xterm-viewport 20px wider so the scrollbar
    // falls outside .xterm which has overflow:hidden — then overlay custom thumb
    const updateThumb = () => {
      const viewport = termContainerRef.current?.querySelector(".xterm-viewport") as HTMLElement | null;
      const thumb = thumbRef.current;
      if (!viewport || !thumb) return;
      const ratio = viewport.clientHeight / viewport.scrollHeight;
      if (ratio >= 1) { thumb.style.display = "none"; return; }
      thumb.style.display = "block";
      thumb.style.height = `${Math.max(ratio * viewport.clientHeight, 24)}px`;
      thumb.style.top = `${(viewport.scrollTop / viewport.scrollHeight) * viewport.clientHeight}px`;
    };
    const viewport = termContainerRef.current.querySelector(".xterm-viewport") as HTMLElement | null;
    if (viewport) {
      viewport.style.width = "calc(100% + 20px)";
      viewport.addEventListener("scroll", updateThumb);
    }
    term.onResize(updateThumb);
    term.onLineFeed(updateThumb);
    updateThumb();

    if (!isArchived) {
      term.onData((data) => {
        api.sendMessage(sessionIdRef.current, data).catch(() => {});
      });

      term.onResize(({ rows, cols }) => {
        api.resizeTerminal(sessionIdRef.current, rows, cols).catch(() => {});
      });
    }

    const viewportEl = termContainerRef.current.querySelector('.xterm-viewport');
    if (viewportEl) {
      viewportEl.addEventListener('wheel', () => {
        requestAnimationFrame(() => {
          if (isWritingRef.current) return;
          const buf = term.buffer.active;
          const isAtBottom = buf.viewportY >= buf.baseY;
          if (!isAtBottom && autoScrollRef.current) {
            autoScrollRef.current = false;
            onAutoScrollChange(false);
          }
          if (isAtBottom && !autoScrollRef.current) {
            autoScrollRef.current = true;
            onAutoScrollChange(true);
          }
        });
      });
    }

    return term;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArchived, termConfig, tc]);

  useEffect(() => {
    if (!termConfig) return;
    const term = initTerminal();
    if (!term) return;

    startedRef.current = false;

    if (isArchived) {
      api
        .getSessionOutput(session.id)
        .then((output) => {
          if (output && termRef.current) {
            termRef.current.write(output);
            termRef.current.write("\r\n\x1b[33m// archived session (read-only)\x1b[0m\r\n");
          }
        })
        .catch(() => {});

      return () => {
        if (termRef.current) {
          termRef.current.dispose();
          termRef.current = null;
        }
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (!w?.runtime?.EventsOn) return;

    const cancelOutput = w.runtime.EventsOn(
      "session:output",
      (data: { sessionId: string; data: string }) => {
        if (data.sessionId === session.id && termRef.current) {
          isWritingRef.current = true;
          termRef.current.write(data.data, () => {
            if (autoScrollRef.current && termRef.current) {
              termRef.current.scrollToBottom();
            }
            isWritingRef.current = false;
          });
        }
      }
    );

    const cancelExited = w.runtime.EventsOn(
      "session:exited",
      (data: { sessionId: string }) => {
        if (data.sessionId === session.id && termRef.current) {
          termRef.current.write("\r\n\x1b[90m// session exited\x1b[0m\r\n");
        }
      }
    );

    if (session.status === "running") {
      api
        .getSessionOutput(session.id)
        .then((output) => {
          if (output && termRef.current) {
            isWritingRef.current = true;
            termRef.current.write(output, () => {
              if (autoScrollRef.current && termRef.current) {
                termRef.current.scrollToBottom();
              }
              isWritingRef.current = false;
            });
          }
        })
        .catch(() => {});
    }

    if (session.status === "idle" || session.status === "paused") {
      const timer = setTimeout(() => {
        if (!startedRef.current && termRef.current && fitAddonRef.current) {
          startedRef.current = true;
          fitAddonRef.current.fit();
          const { rows, cols } = termRef.current;
          if (session.status === "idle") {
            onStart(session.id, rows, cols);
          } else {
            onResume(session.id, rows, cols);
          }
        }
      }, 100);
      return () => {
        clearTimeout(timer);
        if (cancelOutput) cancelOutput();
        if (cancelExited) cancelExited();
        if (termRef.current) {
          termRef.current.dispose();
          termRef.current = null;
        }
      };
    }

    return () => {
      if (cancelOutput) cancelOutput();
      if (cancelExited) cancelExited();
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, isArchived, termConfig]);

  useEffect(() => {
    const container = termContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && termRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // Ignore fit errors during disposal.
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [session.id]);

  // Listen for refit events (e.g. after session restart)
  useEffect(() => {
    const handleRefit = () => {
      if (fitAddonRef.current && termRef.current) {
        try {
          fitAddonRef.current.fit();
          const { rows, cols } = termRef.current;
          api.resizeTerminal(sessionIdRef.current, rows, cols).catch(() => {});
        } catch {
          // Ignore fit errors during disposal.
        }
      }
    };
    window.addEventListener("terminal:refit", handleRefit);
    return () => window.removeEventListener("terminal:refit", handleRefit);
  }, []);

  return (
    <div ref={wrapperRef} className="flex-1 min-h-0 min-w-0" style={{ position: "relative" }}>
      <div
        ref={termContainerRef}
        style={{ position: "absolute", inset: 0, padding: "4px 0 0 4px" }}
      />
      {/* custom scrollbar track */}
      <div style={{ position: "absolute", right: 0, top: 0, width: 4, height: "100%", backgroundColor: "var(--q-bg)", pointerEvents: "none" }} />
      {/* custom scrollbar thumb */}
      <div
        ref={thumbRef}
        style={{ position: "absolute", right: 0, top: 0, width: 4, height: 24, backgroundColor: "var(--q-scrollbar-thumb)", borderRadius: 2, pointerEvents: "none", display: "none" }}
      />
    </div>
  );
}
