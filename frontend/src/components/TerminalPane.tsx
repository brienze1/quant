import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Session, Config } from "../types";
import * as api from "../api";
import { terminalIO } from "../terminal/terminalInput";
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
  // Cancels any in-flight touch-scroll momentum loop. Reassigned inside the
  // touch-scrolling setup below; must be called before every
  // `termRef.current.dispose()` so a live rAF never drives a disposed terminal.
  const cancelMomentumRef = useRef<() => void>(() => {});

  sessionIdRef.current = session.id;
  autoScrollRef.current = autoScroll;

  const initTerminal = useCallback(() => {
    if (!termContainerRef.current) return;

    if (termRef.current) {
      cancelMomentumRef.current();
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
        terminalIO.sendInput(sessionIdRef.current, data);
      });

      term.onResize(({ rows, cols }) => {
        terminalIO.sendResize(sessionIdRef.current, rows, cols);
      });

      // The fit() at open time ran BEFORE this onResize handler existed, so
      // the PTY never hears about the grid size the terminal mounted at. When
      // the terminal is recreated on a tab switch into a pane whose width
      // differs from this session's last-known PTY size — and the pane does
      // not change size afterwards (so the ResizeObserver never fires) — the
      // agent's TUI keeps rendering at the stale column count, squeezing the
      // chat into a narrow band and leaving an empty gap beside it. Sync the
      // PTY to the freshly mounted grid explicitly.
      terminalIO.sendResize(sessionIdRef.current, term.rows, term.cols);
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

    // Touch scrolling: iOS never fires `wheel`, and xterm's scrollable
    // `.xterm-viewport` is a *sibling* of the touched `.xterm-screen`, so native
    // touch-panning finds no scrollable ancestor. Translate finger drags into
    // `scrollLines` on the terminal directly. Attach to `term.element` (the
    // `.xterm` div that contains `.xterm-screen`) so the listeners are torn down
    // with the terminal on dispose, same as the wheel listener above.
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouch && term.element) {
      const touchTarget = term.element;
      // iOS WebKit will claim a vertical drag as a native scroll of xterm's
      // `.xterm-viewport` (it has `overflow-y: scroll`) and then deliver
      // non-cancelable touchmoves — so our handler nudges the buffer but WebKit
      // fights it and it reads as "doesn't scroll". Declaring `touch-action:none`
      // on the touch surface (the `.xterm` div + its viewport/screen children)
      // tells WebKit we own the gesture, so every touchmove reaches us cancelable
      // and `scrollLines` is the sole scroll mechanism (no native fight).
      touchTarget.style.touchAction = 'none';
      touchTarget.querySelectorAll<HTMLElement>('.xterm-viewport, .xterm-screen').forEach((el) => {
        el.style.touchAction = 'none';
      });
      let lastY = 0;
      // Accumulate fractional finger travel so small/slow drags (less than one
      // row of pixels) still scroll instead of being truncated to zero.
      let accum = 0;
      // Recent touchmove samples (position + timestamp), used at touchend to
      // derive a flick velocity for momentum scrolling. Pruned to the last
      // 100ms of travel so a long, slow drag doesn't skew the flick estimate.
      let samples: { t: number; y: number }[] = [];
      let momentumFrame: number | null = null;

      // Applies a raw pixel delta (already in "scroll" sign convention — see
      // onTouchMove) to the terminal: accumulates fractional row travel,
      // scrolls whole rows, and replicates the wheel handler's auto-scroll
      // toggle. Shared by plain dragging (onTouchMove) and the momentum loop
      // so both scroll identically.
      const applyDelta = (dyPx: number) => {
        accum += dyPx;
        const rowPx = term.element ? term.element.clientHeight / term.rows : 18;
        const rows = Math.trunc(accum / rowPx);
        if (rows === 0) return;
        // Retain the sub-row remainder for the next move.
        accum -= rows * rowPx;
        // TUI apps that own scrolling never move xterm's viewport, so scrollLines
        // is a silent no-op for them: claude code enables mouse tracking (wheel
        // becomes SGR mouse reports) and alt-screen apps have no scrollback (wheel
        // becomes arrow keys). Re-emit the finger travel as wheel events so
        // xterm's own wheel pipeline routes it exactly as it does on desktop.
        const appOwnsScroll =
          term.modes.mouseTrackingMode !== 'none' || term.buffer.active.type === 'alternate';
        if (appOwnsScroll) {
          const screenEl = term.element?.querySelector('.xterm-screen');
          if (screenEl) {
            for (let i = 0; i < Math.abs(rows); i++) {
              screenEl.dispatchEvent(
                new WheelEvent('wheel', {
                  deltaY: Math.sign(rows) * rowPx,
                  deltaMode: 0,
                  bubbles: true,
                  cancelable: true,
                })
              );
            }
          }
          return;
        }
        term.scrollLines(rows);
        // iOS never fires `wheel`, so replicate the wheel handler's
        // auto-scroll toggle here: pause the incoming-output snap-back while
        // the user reads scrollback, and restore it when they drag back to
        // the bottom. Read the terminal's CURRENT buffer position (post-scroll).
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
      };

      const cancelMomentum = () => {
        if (momentumFrame !== null) {
          cancelAnimationFrame(momentumFrame);
          momentumFrame = null;
        }
      };
      cancelMomentumRef.current = cancelMomentum;

      // Kicks off an iOS-like momentum loop after a flick. `v` is in px/ms,
      // already in the same sign convention as applyDelta's input. Decay is
      // time-normalized (per-16.7ms frame) so it feels the same on 120Hz and
      // 60Hz displays; the loop self-terminates once the terminal backing it
      // is disposed/replaced or the velocity decays below the stop threshold.
      const startMomentum = (initialV: number) => {
        let v = initialV;
        let lastFrameTime = performance.now();
        const step = (now: number) => {
          // Belt-and-braces: the terminal was disposed/replaced out from under
          // us (cancelMomentumRef should normally catch this first).
          if (termRef.current !== term) {
            momentumFrame = null;
            return;
          }
          const dt = now - lastFrameTime;
          lastFrameTime = now;
          applyDelta(v * dt);
          v *= Math.pow(0.95, dt / 16.7);
          if (Math.abs(v) < 0.05) {
            momentumFrame = null;
            return;
          }
          momentumFrame = requestAnimationFrame(step);
        };
        momentumFrame = requestAnimationFrame(step);
      };

      const onTouchStart = (e: TouchEvent) => {
        // Finger down = grab: kill any in-flight momentum immediately.
        cancelMomentum();
        lastY = e.touches[0].clientY;
        accum = 0;
        samples = [];
      };
      const onTouchMove = (e: TouchEvent) => {
        const y = e.touches[0].clientY;
        // Finger DOWN (y increases) reveals earlier scrollback (scroll up).
        const dy = -(y - lastY);
        lastY = y;
        applyDelta(dy);
        const now = performance.now();
        samples.push({ t: now, y });
        while (samples.length > 0 && now - samples[0].t > 100) {
          samples.shift();
        }
        e.preventDefault();
      };
      const onTouchEnd = () => {
        const now = performance.now();
        while (samples.length > 0 && now - samples[0].t > 100) {
          samples.shift();
        }
        lastY = 0;
        accum = 0;
        const collected = samples;
        samples = [];
        if (collected.length < 2 || now - collected[collected.length - 1].t > 80) {
          // Too few samples, or the finger paused before lifting off — no flick.
          return;
        }
        const first = collected[0];
        const last = collected[collected.length - 1];
        const dt = last.t - first.t;
        if (dt <= 0) return;
        // Same sign convention as onTouchMove's dy: negate finger movement.
        let v = -((last.y - first.y) / dt);
        v = Math.max(-5, Math.min(5, v));
        if (Math.abs(v) > 0.3) {
          startMomentum(v);
        }
      };
      const onTouchCancel = () => {
        cancelMomentum();
        lastY = 0;
        accum = 0;
        samples = [];
      };
      touchTarget.addEventListener('touchstart', onTouchStart, { passive: true });
      touchTarget.addEventListener('touchmove', onTouchMove, { passive: false });
      touchTarget.addEventListener('touchend', onTouchEnd, { passive: true });
      touchTarget.addEventListener('touchcancel', onTouchCancel, { passive: true });
    }

    return term;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArchived, termConfig, tc]);

  useEffect(() => {
    if (!termConfig) return;
    const term = initTerminal();
    if (!term) return;

    startedRef.current = false;

    // Tracks whether this effect instance is still mounted. Async callbacks
    // (getSessionOutput, EventsOn) check this before writing so they don't
    // touch a disposed terminal after a workspace switch / remount.
    const alive = { current: true };

    // Chunked replay state. While the initial buffer is being written we queue
    // any live `session:output` payloads here and flush them in order after
    // replay completes. This avoids the double-write storm where multi-megabyte
    // replay blocks the renderer and concurrent live events stack on top.
    const replayState = { replaying: false };
    const liveQueue: string[] = [];

    const writeChunked = (full: string, onDone?: () => void) => {
      if (!alive.current || !termRef.current) return;
      const chunkSize = 64 * 1024;
      let offset = 0;
      replayState.replaying = true;
      isWritingRef.current = true;

      const writeNext = () => {
        if (!alive.current || !termRef.current) {
          replayState.replaying = false;
          isWritingRef.current = false;
          return;
        }
        if (offset >= full.length) {
          replayState.replaying = false;
          if (autoScrollRef.current && termRef.current) {
            termRef.current.scrollToBottom();
          }
          // Drain any live events that arrived during replay.
          const queued = liveQueue.splice(0, liveQueue.length);
          if (queued.length > 0 && termRef.current) {
            termRef.current.write(queued.join(""), () => {
              if (autoScrollRef.current && termRef.current) {
                termRef.current.scrollToBottom();
              }
              isWritingRef.current = false;
              onDone?.();
            });
          } else {
            isWritingRef.current = false;
            onDone?.();
          }
          return;
        }
        const piece = full.slice(offset, offset + chunkSize);
        offset += chunkSize;
        termRef.current.write(piece, () => {
          // Yield to the browser between chunks so the UI stays responsive.
          requestAnimationFrame(writeNext);
        });
      };

      writeNext();
    };

    if (isArchived) {
      api
        .getSessionOutput(session.id)
        .then((output) => {
          if (!alive.current || !output || !termRef.current) return;
          writeChunked(output, () => {
            if (alive.current && termRef.current) {
              termRef.current.write("\r\n\x1b[33m// archived session (read-only)\x1b[0m\r\n");
            }
          });
        })
        .catch(() => {});

      return () => {
        alive.current = false;
        if (termRef.current) {
          cancelMomentumRef.current();
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
        if (!alive.current || data.sessionId !== session.id || !termRef.current) {
          return;
        }
        if (replayState.replaying) {
          // Hold live events until the initial buffer finishes writing.
          liveQueue.push(data.data);
          return;
        }
        isWritingRef.current = true;
        termRef.current.write(data.data, () => {
          if (!alive.current) return;
          if (autoScrollRef.current && termRef.current) {
            termRef.current.scrollToBottom();
          }
          isWritingRef.current = false;
        });
      }
    );

    const cancelExited = w.runtime.EventsOn(
      "session:exited",
      (data: { sessionId: string }) => {
        if (alive.current && data.sessionId === session.id && termRef.current) {
          termRef.current.write("\r\n\x1b[90m// session exited\x1b[0m\r\n");
        }
      }
    );

    // Remote-only recovery: the server emits `session:resync` after it had to
    // drop `session:output` events for a slow client (dropping mid-ANSI-stream
    // corrupts rendering). Re-fetch the full buffer and repaint from scratch,
    // reusing the same replay/liveQueue machinery as the mount replay so live
    // output arriving mid-resync stays ordered. Desktop mode never receives
    // this event. `active` guards against overlapping resyncs; `queued`
    // coalesces repeat signals into exactly one follow-up pass.
    const resyncState = { active: false, queued: false };
    const startResync = () => {
      if (resyncState.active) {
        resyncState.queued = true;
        return;
      }
      resyncState.active = true;
      const finish = () => {
        resyncState.active = false;
        if (resyncState.queued && alive.current) {
          resyncState.queued = false;
          startResync();
        }
      };
      api
        .getSessionOutput(session.id)
        .then((output) => {
          const write = () => {
            if (!alive.current || !termRef.current) return;
            if (replayState.replaying) {
              // A replay is still writing chunks; interleaving a second
              // chunked writer would garble the terminal. Wait for it.
              requestAnimationFrame(write);
              return;
            }
            termRef.current.reset();
            writeChunked(output ?? "", finish);
          };
          write();
        })
        .catch(finish);
    };

    const cancelResync = w.runtime.EventsOn(
      "session:resync",
      (data: { sessionIds: string[] }) => {
        if (!alive.current || !data?.sessionIds?.includes(session.id)) return;
        startResync();
      }
    );

    if (session.status === "running") {
      api
        .getSessionOutput(session.id)
        .then((output) => {
          if (!alive.current || !output || !termRef.current) return;
          writeChunked(output);
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
        alive.current = false;
        clearTimeout(timer);
        if (cancelOutput) cancelOutput();
        if (cancelExited) cancelExited();
        if (cancelResync) cancelResync();
        terminalIO.dispose(session.id);
        if (termRef.current) {
          cancelMomentumRef.current();
          termRef.current.dispose();
          termRef.current = null;
        }
      };
    }

    return () => {
      alive.current = false;
      if (cancelOutput) cancelOutput();
      if (cancelExited) cancelExited();
      if (cancelResync) cancelResync();
      terminalIO.dispose(session.id);
      if (termRef.current) {
        cancelMomentumRef.current();
        termRef.current.dispose();
        termRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, isArchived, termConfig]);

  // Re-apply the xterm theme LIVE when the theme colors change, without
  // recreating the terminal (which would otherwise require closing/reopening
  // the session to pick up a theme switch).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = {
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
    };
  }, [tc, isArchived]);

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
          terminalIO.sendResize(sessionIdRef.current, rows, cols);
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
      {/* custom scrollbar track — transparent overlay, matches the Apple-style
          thin scrollbar treatment in style.css (track is transparent everywhere) */}
      <div style={{ position: "absolute", right: 0, top: 0, width: 4, height: "100%", backgroundColor: "transparent", pointerEvents: "none" }} />
      {/* custom scrollbar thumb — pill radius to match migrated overlay scrollbars */}
      <div
        ref={thumbRef}
        style={{ position: "absolute", right: 0, top: 0, width: 4, height: 24, backgroundColor: "var(--q-scrollbar-thumb)", borderRadius: 999, pointerEvents: "none", display: "none" }}
      />
    </div>
  );
}
