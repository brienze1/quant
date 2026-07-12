/*
 * Configurable remote transport — the standalone-client counterpart of the
 * server-injected assets/shim.js. It fakes the Wails window.go / window.runtime
 * / window.__quantRemoteWS objects so the unmodified React app runs in a plain
 * browser, but unlike shim.js it is:
 *
 *   - configurable at runtime with { baseURL, token } instead of assuming
 *     same-origin, so the PWA (hosted at a stable origin) can talk to a
 *     rotating Cloudflare tunnel URL cross-origin;
 *   - authenticated with an Authorization: Bearer <token> header on RPC and a
 *     ?token= query on the WebSocket (cross-site cookies are blocked by mobile
 *     Safari's ITP, and WS handshakes cannot set custom headers);
 *   - non-fatal on 401 — it calls onUnauthorized() so the connection manager can
 *     re-prompt, instead of location.reload()-ing to a server login page that
 *     does not exist in this model.
 */

export interface TransportConfig {
  /** Absolute origin of the Quant remote server, e.g. https://xyz.trycloudflare.com (no trailing slash). */
  baseURL: string;
  /** Bearer token issued by POST {baseURL}/__quant_remote/auth. */
  token: string;
  /** Invoked when the server rejects the token (401). The manager should re-prompt. */
  onUnauthorized: () => void;
  /** Optional: notified as the event WebSocket connects / drops, for a status indicator. */
  onSocketState?: (open: boolean) => void;
}

const BASE = "/__quant_remote";

type Listeners = Record<string, Array<(data: unknown) => void>>;

/**
 * installBridge wires window.go / window.runtime / window.__quantRemoteWS to the
 * given remote endpoint and returns a teardown function that closes the socket
 * and stops reconnecting. The app should be (re)mounted only after this is
 * called, and unmounted before teardown.
 */
export function installBridge(cfg: TransportConfig): () => void {
  const w = window as unknown as Record<string, unknown>;
  const rpcURL = cfg.baseURL.replace(/\/$/, "") + BASE + "/rpc";
  const wsURL =
    cfg.baseURL.replace(/^http/, "ws").replace(/\/$/, "") +
    BASE +
    "/ws?token=" +
    encodeURIComponent(cfg.token);

  // Marker so the app hides desktop-only controls (e.g. the remote-access
  // settings tab, whose controller is not exposed over the tunnel).
  w.__quantRemote = true;

  let unauthorizedFired = false;
  function call(struct: string, method: string, args: unknown[]): Promise<unknown> {
    return fetch(rpcURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cfg.token,
      },
      body: JSON.stringify({ struct, method, args }),
    })
      .then((res) => {
        if (res.status === 401) {
          if (!unauthorizedFired) {
            unauthorizedFired = true;
            cfg.onUnauthorized();
          }
          // Never resolve — the app is about to be torn down and re-prompted.
          return new Promise<never>(() => {});
        }
        return res.json();
      })
      .then((payload: { error?: string; result?: unknown } | undefined) => {
        if (payload && payload.error) return Promise.reject(new Error(payload.error));
        return payload ? payload.result : undefined;
      });
  }

  const ignore = (prop: string | symbol) => typeof prop === "symbol" || prop === "then";
  const methodProxy = (struct: string, method: string) =>
    (...args: unknown[]) => call(struct, method, args);
  const structProxy = (struct: string) =>
    new Proxy({}, { get: (_t, m) => (ignore(m) ? undefined : methodProxy(struct, String(m))) });
  const pkgProxy = new Proxy({}, { get: (_t, s) => (ignore(s) ? undefined : structProxy(String(s))) });
  // Any package name (e.g. "controller") resolves to the same struct proxy.
  w.go = new Proxy({}, { get: (_t, pkg) => (ignore(pkg) ? undefined : pkgProxy) });

  // --- events: one shared WebSocket fans out to EventsOn listeners ---
  const listeners: Listeners = {};
  let ws: WebSocket | null = null;
  let torn = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (torn) return;
    try {
      ws = new WebSocket(wsURL);
    } catch {
      reconnectTimer = setTimeout(connect, 1500);
      return;
    }
    ws.onopen = () => cfg.onSocketState?.(true);
    ws.onmessage = (ev) => {
      let msg: { event?: string; data?: unknown };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      const cbs = msg.event ? listeners[msg.event] : undefined;
      if (cbs) {
        cbs.slice().forEach((cb) => {
          try {
            cb(msg.data);
          } catch {
            /* listener errors must not break fan-out */
          }
        });
      }
    };
    ws.onclose = () => {
      cfg.onSocketState?.(false);
      if (!torn) reconnectTimer = setTimeout(connect, 1500);
    };
    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }
  connect();

  // Raw-frame fast path for terminal input; returns false when the socket is not
  // open so terminalInput.ts falls back to the RPC POST path.
  w.__quantRemoteWS = {
    send(frame: unknown): boolean {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      try {
        ws.send(JSON.stringify(frame));
        return true;
      } catch {
        return false;
      }
    },
  };

  const runtime = (w.runtime || {}) as Record<string, unknown>;
  runtime.EventsOn = (name: string, cb: (data: unknown) => void) => {
    (listeners[name] = listeners[name] || []).push(cb);
    return () => {
      const arr = listeners[name];
      if (!arr) return;
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  };
  runtime.EventsOff = (name: string) => {
    delete listeners[name];
  };
  runtime.EventsEmit = () => {};
  w.runtime = runtime;

  return function teardown() {
    torn = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    ws = null;
    delete w.go;
    delete w.__quantRemoteWS;
    delete w.__quantRemote;
  };
}
