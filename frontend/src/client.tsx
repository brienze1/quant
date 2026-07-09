/*
 * Standalone PWA client entry.
 *
 * This build (dist-client, hosted at a stable origin — GitHub Pages) is NOT the
 * Wails desktop app and is NOT served over the tunnel. It boots a connection
 * manager: on launch it health-checks the saved remote endpoint and either
 * enters the app or shows a Connect/Reconnect screen. Once connected it installs
 * the configurable transport (window.go / window.runtime over the tunnel,
 * cross-origin, bearer-authenticated) and mounts the real <App/> unmodified.
 *
 * Rotating the tunnel URL is just pasting the new URL on the Connect screen — no
 * reinstall, because the PWA lives at this stable origin, not the tunnel.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import App from "./App";
import { ThemeProvider } from "./theme";
import { MenuHost } from "./components/MenuHost";
import { ConnectScreen } from "./remote/ConnectScreen";
import { installBridge } from "./remote/transport";
import {
  clearToken,
  health,
  loadConnection,
  saveConnection,
  type SavedConnection,
} from "./remote/connection";

// Scrollbar styling parity with main.tsx (WKWebView + mobile browsers).
;(function () {
  const s = document.createElement("style");
  s.textContent = `
    ::-webkit-scrollbar { width: 3px !important; height: 3px !important; }
    ::-webkit-scrollbar-thumb { background: var(--border, rgba(255,255,255,0.25)) !important; border-radius: 2px !important; }
  `;
  document.head.appendChild(s);
})();

type Phase =
  | { kind: "checking" }
  | { kind: "connect"; initialURL: string; reconnect: boolean }
  | { kind: "connected" };

function Splash() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        color: "var(--fg-3)",
        fontFamily: "var(--mono)",
        fontSize: 13,
      }}
    >
      <span style={{ animation: "pulseDot 1.2s ease-in-out infinite" }}>&gt;_ connecting…</span>
    </div>
  );
}

function Client() {
  const [phase, setPhase] = React.useState<Phase>({ kind: "checking" });
  const teardownRef = React.useRef<null | (() => void)>(null);

  const connect = React.useCallback((conn: SavedConnection) => {
    teardownRef.current?.();
    teardownRef.current = installBridge({
      baseURL: conn.baseURL,
      token: conn.token,
      onUnauthorized: () => {
        clearToken();
        teardownRef.current?.();
        teardownRef.current = null;
        setPhase({ kind: "connect", initialURL: conn.baseURL, reconnect: true });
      },
    });
    setPhase({ kind: "connected" });
  }, []);

  const onConnected = React.useCallback(
    (conn: SavedConnection) => {
      saveConnection(conn);
      connect(conn);
    },
    [connect]
  );

  // Launch: try the saved connection. Never discard it on a transient failure —
  // only fall to the (prefilled) reconnect screen.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const deepLink = params.get("connect") || "";
      const saved = loadConnection();

      if (!saved || !saved.baseURL) {
        setPhase({ kind: "connect", initialURL: deepLink, reconnect: false });
        return;
      }
      if (!saved.token) {
        setPhase({ kind: "connect", initialURL: saved.baseURL, reconnect: true });
        return;
      }
      const h = await health(saved.baseURL, saved.token);
      if (cancelled) return;
      if (h.ok && h.authed) {
        connect(saved);
      } else {
        // Reachable-but-expired OR unreachable → reconnect, URL prefilled,
        // saved connection preserved.
        setPhase({ kind: "connect", initialURL: saved.baseURL, reconnect: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connect]);

  if (phase.kind === "checking") return <Splash />;
  if (phase.kind === "connect") {
    return (
      <ConnectScreen
        initialURL={phase.initialURL}
        reconnect={phase.reconnect}
        onConnected={onConnected}
      />
    );
  }
  // Connected: the bridge is installed, so window.go/runtime exist before App's
  // first api call. MenuHost mirrors main.tsx.
  return (
    <MenuHost>
      <App />
    </MenuHost>
  );
}

const container = document.getElementById("root");
const root = createRoot(container!);
// No StrictMode: it double-invokes effects in dev, which would install the
// bridge twice; the connection flow is stateful and single-shot.
root.render(
  <ThemeProvider>
    <Client />
  </ThemeProvider>
);
