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
/// <reference types="vite-plugin-pwa/client" />
import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
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

// Installed-PWA detection. iOS home-screen apps don't reliably match the
// `display-mode: standalone` media query, but Safari always sets the
// proprietary `navigator.standalone` there — check both and stamp the root so
// CSS (mobile.css) can key layout fixes off a signal that actually fires.
if (
  (navigator as unknown as { standalone?: boolean }).standalone === true ||
  window.matchMedia?.("(display-mode: standalone)").matches
) {
  document.documentElement.setAttribute("data-standalone", "1");

  // Measured on-device: iOS standalone subtracts the status-bar inset from the
  // layout viewport while rendering full-screen (screen 852 / layout 793 /
  // inset-top 59) — every dvh/fixed layer ends 59px above the real screen
  // bottom. When that signature is present, publish the true paintable height
  // (layout + top inset) as --standalone-h for mobile.css to size the shell.
  const fixStandaloneHeight = () => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden";
    document.body.appendChild(probe);
    const sat = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    const real = window.innerHeight + sat;
    if (sat > 0 && real <= window.screen.height + 2) {
      document.documentElement.style.setProperty("--standalone-h", `${real}px`);
    } else {
      document.documentElement.style.removeProperty("--standalone-h");
    }
  };
  fixStandaloneHeight();
  window.addEventListener("resize", fixStandaloneHeight);
  window.addEventListener("orientationchange", fixStandaloneHeight);
}

// ---- Service-worker update flow -------------------------------------------
// registerType is "prompt": a new deploy is downloaded by the waiting SW but
// NOT activated until the user confirms — we surface that as an in-app
// "Update" popup so nobody has to delete/re-add the home-screen app (or know
// the double-relaunch trick) to get new versions.
let swUpdateReady = false;
const swUpdateSubs = new Set<() => void>();
const updateSW = registerSW({
  onNeedRefresh() {
    swUpdateReady = true;
    swUpdateSubs.forEach((fn) => fn());
  },
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => reg.update().catch(() => {});
    // iOS PWAs only check for a new SW on cold launch by default — also check
    // whenever the app returns to the foreground, and periodically while open.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    setInterval(check, 15 * 60 * 1000);
  },
});

function UpdateToast() {
  const ready = React.useSyncExternalStore(
    (fn) => {
      swUpdateSubs.add(fn);
      return () => swUpdateSubs.delete(fn);
    },
    () => swUpdateReady
  );
  const [dismissed, setDismissed] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  if (!ready || dismissed) return null;
  return (
    <div
      role="alertdialog"
      aria-label="Update available"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: "calc(84px + env(safe-area-inset-bottom, 0px))",
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 14,
        background: "var(--panel-2, #1a1b1e)",
        border: "1px solid var(--border, rgba(255,255,255,0.12))",
        boxShadow: "0 8px 30px rgba(0,0,0,.45)",
        maxWidth: 420,
        margin: "0 auto",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg, #eee)" }}>
          Update available
        </div>
        <div style={{ fontSize: 12, color: "var(--fg-3, #9a9a9a)", marginTop: 2 }}>
          A new version of Quant is ready.
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Not now"
        style={{
          height: 40,
          padding: "0 12px",
          borderRadius: 10,
          border: "none",
          cursor: "pointer",
          background: "transparent",
          color: "var(--fg-3, #9a9a9a)",
          fontSize: 12.5,
        }}
      >
        Later
      </button>
      <button
        onClick={() => {
          setApplying(true);
          // Activate the waiting SW, then reload ourselves: updateSW(true)'s
          // built-in reload waits on a 'controlling' event that doesn't fire
          // reliably (observed: the new SW activates but the page never
          // reloads), so listen for controllerchange directly and keep a hard
          // fallback — by the time this toast shows the new version is fully
          // precached, so reloading always lands on it.
          let reloaded = false;
          const reload = () => {
            if (reloaded) return;
            reloaded = true;
            window.location.reload();
          };
          navigator.serviceWorker?.addEventListener("controllerchange", reload, { once: true });
          setTimeout(reload, 2500);
          void updateSW(true);
        }}
        disabled={applying}
        aria-label="Update now"
        style={{
          height: 40,
          padding: "0 16px",
          borderRadius: 10,
          border: "none",
          cursor: "pointer",
          background: "var(--accent, #2ed3a0)",
          color: "var(--on-accent, #08110d)",
          fontSize: 13,
          fontWeight: 700,
          opacity: applying ? 0.6 : 1,
        }}
      >
        {applying ? "Updating…" : "Update"}
      </button>
    </div>
  );
}

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
    <UpdateToast />
  </ThemeProvider>
);
