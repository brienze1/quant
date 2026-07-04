import * as api from "../api";

// Ordered, coalescing send queue for terminal input and resize.
//
// Every xterm onData event used to fire an independent fire-and-forget RPC; in
// remote (tunnel) mode those requests ride separate HTTP POSTs handled on
// separate server goroutines, so PTY writes raced and keystrokes arrived out
// of order. This module serializes them client-side.

export interface InputTransport {
  sendInput(sessionId: string, data: string): Promise<void>;
  sendResize(sessionId: string, rows: number, cols: number): Promise<void>;
}

export interface TerminalIO {
  sendInput(sessionId: string, data: string): void;
  sendResize(sessionId: string, rows: number, cols: number): void;
  dispose(sessionId: string): void;
}

const MAX_CHUNK = 16 * 1024;

interface SessionState {
  pending: string;
  inputInFlight: boolean;
  desired: { rows: number; cols: number } | null;
  lastSent: { rows: number; cols: number } | null;
  resizeInFlight: boolean;
}

export function createTerminalIO(transport: InputTransport): TerminalIO {
  const sessions = new Map<string, SessionState>();

  const state = (sessionId: string): SessionState => {
    let s = sessions.get(sessionId);
    if (!s) {
      s = {
        pending: "",
        inputInFlight: false,
        desired: null,
        lastSent: null,
        resizeInFlight: false,
      };
      sessions.set(sessionId, s);
    }
    return s;
  };

  const pumpInput = (sessionId: string) => {
    const s = sessions.get(sessionId);
    if (!s || s.inputInFlight || s.pending.length === 0) return;
    const chunk = s.pending.slice(0, MAX_CHUNK);
    s.pending = s.pending.slice(chunk.length);
    // Invariant: at most ONE in-flight input send per session. The next chunk
    // only leaves after this one settles, so data reaches the PTY in FIFO
    // order no matter how concurrent the underlying transport is.
    s.inputInFlight = true;
    const settle = () => {
      const cur = sessions.get(sessionId);
      if (!cur) return; // disposed while in flight
      cur.inputInFlight = false;
      pumpInput(sessionId);
    };
    // Settle on reject too, WITHOUT retrying: re-sending keystrokes risks
    // duplicates; dropping on error matches the old `.catch(() => {})`.
    transport.sendInput(sessionId, chunk).then(settle, settle);
  };

  const pumpResize = (sessionId: string) => {
    const s = sessions.get(sessionId);
    if (!s || s.resizeInFlight || !s.desired) return;
    const d = s.desired;
    if (s.lastSent && s.lastSent.rows === d.rows && s.lastSent.cols === d.cols) {
      return;
    }
    s.resizeInFlight = true;
    const settle = () => {
      const cur = sessions.get(sessionId);
      if (!cur) return;
      cur.resizeInFlight = false;
      cur.lastSent = d;
      // Last-write-wins: if the desired size changed while this send was in
      // flight, send the latest one now; intermediate sizes are skipped.
      pumpResize(sessionId);
    };
    transport.sendResize(sessionId, d.rows, d.cols).then(settle, settle);
  };

  return {
    sendInput(sessionId: string, data: string): void {
      if (!data) return;
      state(sessionId).pending += data;
      pumpInput(sessionId);
    },
    sendResize(sessionId: string, rows: number, cols: number): void {
      state(sessionId).desired = { rows, cols };
      pumpResize(sessionId);
    },
    dispose(sessionId: string): void {
      sessions.delete(sessionId);
    },
  };
}

// Default transport: in a remote browser the shim exposes
// window.__quantRemoteWS whose send() returns true only when the frame went
// out over the open event WebSocket — one tunnel traversal instead of a full
// RPC POST round trip. When the socket is down (or in the desktop webview,
// where __quantRemoteWS is undefined) fall back to the regular api calls.
const defaultTransport: InputTransport = {
  sendInput(sessionId: string, data: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws = (window as any).__quantRemoteWS;
    if (ws?.send({ type: "input", sessionId, data })) return Promise.resolve();
    return api.sendMessage(sessionId, data);
  },
  sendResize(sessionId: string, rows: number, cols: number): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws = (window as any).__quantRemoteWS;
    if (ws?.send({ type: "resize", sessionId, rows, cols })) {
      return Promise.resolve();
    }
    return api.resizeTerminal(sessionId, rows, cols);
  },
};

export const terminalIO = createTerminalIO(defaultTransport);
