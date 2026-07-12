# Mobile PWA + Standalone Remote Client — Feature Plan

Status: **PLANNED, not built.** Design handoff lives in `Downloads/Quant Design System.zip`
(`design_handoff_quant_mobile_pwa/`). This file is the durable plan — safe to read
after a context compaction; it contains the condensed research needed to implement.

---

## 1. What the user asked for (requirements)

1. A **real installable PWA** (Add to Home Screen, standalone) that **opens offline**
   (cached shell, no network needed just to launch).
2. Inside the app, the user **fills in the remote-access URL + passcode** to connect to
   a running Quant desktop instance.
3. The connection **stays saved until it is no longer accessible** (persist, auto-reconnect,
   only prompt again when the endpoint actually fails / token is rejected).
4. **Rotating the remote-access URL must NOT require reinstalling the PWA.**
5. The mobile UI is the design handoff (touch-native shell: Chat/Terminal/Crew/Jobs/More,
   sessions drawer, voice mini-player + full-screen orb).

## 2. The load-bearing architectural constraint

Quant remote access uses a **Cloudflare *quick* tunnel** (`cloudflared tunnel --url ...`),
which mints a **new random `https://<rand>.trycloudflare.com` URL every session**
(`internal/integration/remote/tunnel.go`). A PWA is permanently bound to the **origin it
was installed from**. Therefore:

> A PWA *served over the tunnel* is bound to that session's random origin. When the URL
> rotates, the installed app points at a dead origin → you'd reinstall every time.

**Conclusion:** the PWA must be a **standalone client hosted at a STABLE origin**, that
connects to the (rotating) tunnel URL **cross-origin**. Install once from the stable
origin; rotating the tunnel is just "paste the new URL in the app."

This is a change from the first-pass plan (which assumed the Go server serves the PWA over
the tunnel). That model is now **Alternative B** below.

---

## 3. Recommended architecture — Standalone Remote Client

Two independent deliverables:

- **Desktop app** (Wails) — largely unchanged; gains a token/CORS-capable remote server.
- **Static PWA client** — a new, fully-static build of the frontend, hosted at a stable
  HTTPS origin (see §7 hosting decision). It is a *thin client* that talks to whatever
  Quant remote endpoint the user configures.

### 3.1 Transport: replace the server-injected shim with a bundled, configurable one

Today the remote browser gets `window.go` / `window.runtime` from `assets/shim.js`, which
the Go server **injects into the served `index.html`** and which assumes **same-origin**
(`credentials: "same-origin"` cookie, same-origin `/​__quant_remote/rpc`, same-origin WS).
See research §5 below.

For the standalone client we **do not** rely on server-side injection. Instead we bundle a
**configurable transport module** (a TS port of `shim.js`) into the client build that:

- Reads the active connection `{ baseURL, token }` from storage.
- Populates `window.go.<pkg>.<struct>.<method>` → `POST {baseURL}/__quant_remote/rpc`
  with `Authorization: Bearer <token>` (NOT a cookie — cross-site cookies are blocked by
  iOS ITP; a bearer header is clean and needs no credentialed CORS).
- Populates `window.runtime.EventsOn/EventsEmit` over a WebSocket to
  `wss://{baseURL host}/__quant_remote/ws?token=<token>` (WS handshakes can't send custom
  headers, so the token rides as a query param).
- Keeps the terminal fast-path (`window.__quantRemoteWS.send(frame)`) pointing at that WS.
- On `401`, signals the connection manager to re-prompt (don't hard-reload to a login page —
  there is no server login page in this model).

`frontend/src/api.ts` already dispatches purely through `window.go[pkg][struct][method]`
(`callGo`, api.ts:46), so **no `api.ts` change** is needed — only *who* provides `window.go`.

### 3.2 Connection manager (new)

- **Connect screen**: fields for **URL** (`https://<rand>.trycloudflare.com`) + **passcode**.
  On submit → `POST {url}/__quant_remote/auth` (form or JSON) → server returns the signed
  **token** (JSON). Store `{ baseURL, token, label, savedAt }` in `localStorage`
  (+ optionally IndexedDB for the SW). Then boot the mobile shell.
- **Persistence / "keep until no longer accessible"**: on launch, if a saved connection
  exists, do a lightweight health check (`GET {baseURL}/__quant_remote/health` — new tiny
  endpoint, or a cheap RPC). Reachable → straight into the app. Unreachable → show a
  **Reconnect** screen *prefilled with the last URL* and a paste field for the new URL;
  **do not delete the saved connection on transient failure**. Only clear the token on an
  explicit `401` (then re-prompt passcode); only clear the URL when the user replaces it.
- **Rotate URL flow**: user re-enables remote access on desktop → new URL (+ maybe new
  passcode if the process restarted, since the signing key rotates on restart/regenerate —
  auth.go:26,51). In the PWA they paste the new URL, re-enter passcode if the old token is
  now rejected → new token. **No reinstall.** ✔ (requirement 4)
- Optionally support the manifest deep-links: `?connect=<url>` to prefill.

### 3.3 Offline behavior (requirement 1)

- SW precaches the **entire static client shell** (this build has NO server-injected shim,
  so the shell is self-contained and safe to cache — unlike the tunnel-served shell).
- Launching offline: shell loads from cache → shows last state / Reconnect screen (the
  live data obviously needs the tunnel, which needs network; "offline" = the app *opens*
  instead of a browser error, and cached UI/last-known state is visible where possible).

### 3.4 Backend (Go) changes — small, reuse existing crypto

`internal/integration/remote/`:

- **Token auth (cross-origin)**: `authedRequest` (auth.go:167) currently only reads the
  cookie. Extend it to also accept `Authorization: Bearer <token>` and `?token=` (WS),
  validating via the existing `validToken` (auth.go:141) — the cookie value already *is*
  this token, so this is additive and low-risk.
- **Auth endpoint returns the token**: `handleAuth` (server.go:147) currently sets a cookie
  and 303-redirects. Add a JSON response path (e.g. when `Accept: application/json` or a
  `?json=1`): `{ "token": signToken(...) }`, still rate-limited by the same
  `checkPasscode`. Keep the cookie path for the legacy browser-served flow (Alt B).
- **CORS**: add permissive-but-scoped CORS for `/__quant_remote/{auth,rpc}` — reflect the
  configured client origin (or allow the known Pages origin), `Allow-Headers: Authorization,
  Content-Type`, handle `OPTIONS` preflight. No `Allow-Credentials` needed (bearer, not
  cookies). WS `CheckOrigin` already returns true (server.go:60).
- **Health endpoint**: `GET /__quant_remote/health` → `200 {"ok":true,"name":...}` (no auth,
  or token-optional) for the reconnect check.
- **`.webmanifest` MIME** (only relevant if we ever also serve PWA assets from Go / Alt B):
  `mime.AddExtensionType(".webmanifest", "application/manifest+json")`.

Security posture unchanged in spirit: passcode-gated, HMAC token, per-IP rate limit,
12h TTL, key rotates on restart/regenerate. Bearer token is the same secret as the cookie.

### 3.5 Frontend build modes

- **Desktop/embedded** (existing): `vite build` → `dist/` (Wails embeds; Go injects shim
  for the legacy tunnel-served path).
- **Remote client** (new): a separate entry (`client.html` + `client.tsx`) built with a
  dedicated mode → `dist-client/` (or `client/`), including the bundled transport §3.1,
  connection manager §3.2, the mobile shell §4, manifest + SW + icons. Deployed to the
  stable host §7. `base` set to the host's path.

---

## 4. The mobile shell (design handoff → real components)

Recreate `design_source/mobile.jsx` (864 lines; ~700 portable UI/animation, ~150 the
integration seam) as TSX under `frontend/src/mobile/`, reusing real components. Rendered
when `useIsMobile()` (new `matchMedia("(max-width:900px)")` hook + `window.__forceMobile`)
is true — inserted at the **top of `App`'s return (App.tsx:2984)** so it has access to
`App`'s state + handlers (there is **no global store**; all data is `useState` in `App`).

**Prop bag** (`mobileApp`), mirror of `app.jsx:419`:
`{ t, setTweak, repos, onAction, activeSession, openSession(name), newSession(),
openPalette(), openSettings() }` — fed from existing `App` state (`repos`/`tasksByRepo`/
`sessionsByRepo`…) and `useTheme()`.

**Tab mapping (LOCKED — Quant sessions are PTYs, not markdown chat):**
- **Chat** = the **Claude session PTY** — reuse `TerminalPane` (xterm) of the active parent
  session (`session:output` events + `api.sendMessage`/`resizeTerminal`).
- **Terminal** = the **embedded shell session** — a *separate child* session lazily created
  via `onCreateEmbeddedTerminal(session)` (SessionPanel.tsx:130). Add the handoff's touch
  quick-key row.
- **Crew** = real `CrewPane` data (`crew:updated`); tap-to-assign (drag is dead on touch).
- **Jobs / Files / Mindmap / Agents** = reuse desktop `JobsView` / `FilesPanel` /
  `MindmapPane` / `AgentsView` inside `MoSheet`/`MoWideWrap`.
- **More** = appearance controls via `useTheme()` (theme/accent/density) + row nav.

**Voice** = port `VoiceOrb` **verbatim including its clamp helpers** `A()` (alpha),
`cs()` (color-stop offset), and the `shp` sheen clamp — unclamped `addColorStop` throws
`IndexSizeError` on some frames. Mini-player above the tab bar + full-screen sheet. Wire
the turn machine to the **existing** Whisper+Kokoro voice runtime (`src/voice/voiceBridge.ts`,
`voice:runtime` events, MCP voice tools) instead of the scripted mock timers.

**Reused components that already exist** (path → export):
`FilesPanel` (`components/FilesPanel.tsx`), `MindmapPane`, `JobsView`, `AgentsView`,
`Icon` + `ICONS` (`components/Icon.tsx`, has sparkles/terminal/mic/layout/… ~55 icons),
`StatusDot`, `Pill`, `CountBadge`, `MenuHost`/`MenuContext`/`useMenu`, `CommandPalette`,
`Settings`, `TerminalPane`, `CrewPane`/`CrewSessionPanel`, `SessionPanel`, `QuantAssistant`
(the separate markdown "Quanti").

**CSS**: merge the handoff `theme.css` mobile block into `src/style.css` — safe-area vars
(`--safe-t/b/l/r` via `env()`), the `@media (max-width:900px)` rules (kill iOS rubber-band,
tap highlight, `.mo-scroll`), `@media (display-mode: standalone)`, `.mo-shell{height:100dvh}`,
and `mo*` keyframes (`moSheetUp/moFadeIn/moPopIn/moRing/moMsgIn`). Tokens already exist in
`src/style.css` driven by `data-theme`/`data-accent`/`data-density` on `<html>` via
`ThemeProvider` (`src/theme/provider.tsx`, `useTheme()`), so tokens just need aligning, not
re-adding. Fonts: Geist / Geist Mono (self-host to keep offline; avoid CDN dependency).

**Interaction specs to preserve**: haptics (`navigator.vibrate`, guarded), **all text inputs
≥16px** (stops iOS zoom-on-focus), overscroll containment, turn-machine timings
(thinking 900ms, speaking 3400ms), `prefers-reduced-motion` honored.

---

## 5. Condensed research reference (so this plan is standalone)

**Remote serving** (`internal/integration/remote/`): Go `http.ServeMux` on `127.0.0.1:<port>`
behind the quick tunnel. Routes: `/__quant_remote/{shim.js,auth,rpc,ws}` + `/` catch-all
(`handleAssets`, server.go:101). Assets = `embed.FS` of `frontend/dist`
(`main.go` `//go:embed all:frontend/dist`, wired in `internal/infra/application.go:290`).
Auth = HMAC-signed cookie `quant_remote_session` (auth.go); **pre-auth, every path returns
the login HTML at 200** (server.go:102) — irrelevant to the standalone client (it never
hits that login page) but fatal to Alt B without an allowlist. RPC dispatch = reflection on
bound controllers (`dispatch.go`); `remoteController` is deliberately NOT exposed remotely
(application.go:310). Events + terminal I/O = one shared WS via `EventHub` (`hub.go`).
The shim sets `window.__quantRemote = true` (used by `Settings.tsx:40`).

**Frontend**: React 18 + Vite 7 + Tailwind v4. Single giant `App()` (`src/App.tsx`, ~3500
lines), **no global store** (only `ThemeProvider` context). Backend calls via `src/api.ts`
`callGo` → `window.go.controller.<x>Controller.<Method>`; streaming via
`window.runtime.EventsOn`. No responsive/PWA code exists today. Build → `dist/`.
Embedded-terminal model: `App` tracks `parentSessionId → terminalSessionId`
(App.tsx:177), created lazily (SessionPanel.tsx:130).

**Design handoff** (`design_source/`): `mobile.jsx` (864L, exports `useIsMobile`,
`MobileShell` onto `window`), `app.jsx` (`isMobile` swap L449, `mobileApp` bag L419),
`theme.css` (mobile block L263-301), `index.html` (PWA head + SW reg), `manifest.webmanifest`
(standalone, portrait, `#0b0c0e`, icons 192/512/maskable-512, shortcuts `?new=session` /
`?voice=1`), `sw.js` (precache shell, network-first navigations, cache-first same-origin,
SWR cross-origin), `icons/` (180/192/512/maskable-512 — placeholders, replace with real mark).

---

## 6. Phases

- **Phase 0 — Backend token/CORS/health** (`remote/auth.go`, `server.go`): bearer + `?token=`
  in `authedRequest`; JSON token from `handleAuth`; scoped CORS + preflight on auth/rpc;
  `/__quant_remote/health`. (~small, reuses existing HMAC.)
- **Phase 1 — Client transport + connection manager**: TS port of `shim.js` (configurable
  baseURL + bearer/WS-query), connection store + persistence + health-check/reconnect,
  `client.tsx`/`client.html` entry + `dist-client` build mode.
- **Phase 2 — Mobile shell**: port the `Mo*` layer to TSX, wire tabs to real backends
  (Chat=Claude PTY, Terminal=embedded shell, Crew, Jobs/Files/Mindmap/Agents, More),
  `useIsMobile` swap in `App`, merge mobile CSS, self-host Geist.
- **Phase 3 — Voice**: port `VoiceOrb` (keep clamps) + mini-player + sheet, wire to real
  voice runtime.
- **Phase 4 — PWA + hosting**: manifest + SW (offline shell, skip `/__quant_remote/*` in
  fetch), real icons, install; **CI deploy** of `dist-client` to the stable host (§7).
- **Phase 5 — Polish + device QA**: install once → rotate URL (no reinstall) → offline open
  → reconnect after tunnel death; reduced-motion; shortcut deep-links; changelog + PR
  (`feat/mobile-pwa`, single PR).

---

## 7. DECISION (LOCKED) — host the static PWA client on GitHub Pages

Chosen: **GitHub Pages.** Free, aligns with the existing GitHub + Homebrew-tap release flow.
CI publishes `dist-client` on release to `https://<owner>.github.io/quant-remote/` (repo/path
TBD). Implications this pins down:
- Vite `base` for the client build = the Pages sub-path (`/quant-remote/`).
- Manifest `start_url`/`scope` = that sub-path.
- Backend CORS `Allow-Origin` = the Pages origin (`https://<owner>.github.io`).
- Add a GitHub Actions job to build `dist-client` and deploy to Pages (gh-pages branch or
  Pages action).

Rejected alternatives (kept for context):
- **Cloudflare Pages**: equivalent, `*.pages.dev`; different deploy target + allow-origin.
- **Cloudflare Pages**: stays in the Cloudflare ecosystem (`*.pages.dev`), also free.
- **Alt-B — no separate host**: keep serving the PWA over the tunnel from Go, but make the
  tunnel URL **stable** via a *named* Cloudflare tunnel (needs a CF account + a domain).
  Install once from the stable hostname; passcode still rotates. Avoids cross-origin entirely,
  but does NOT satisfy "rotate the URL freely" and adds account/domain setup.
