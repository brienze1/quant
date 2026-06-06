# Voice feature — BUILD PLAN (work items)

> **Purpose:** the execution guide for building the Voice feature in quant. This is the durable checklist to build from (survives context compaction). For the *why*/architecture rationale see `voice-feature-plan.md`; this doc is the *what to do*, broken into work items.
>
> **Status legend:** ✅ done · 🟡 in progress · ⬜ todo · 🔒 blocked

---

## 0. Context recap (read first)

**What we're building:** a per-session **Voice mode** for quant — talk to a Claude session hands-free; it talks back; an audio-reactive **orb** visualizes the conversation. The **Crew** (orchestration/assignments/inbox) feature is **deferred** — Voice ships first and stands alone.

**Architecture = "B2" (locked):** quant **owns** the voice pipeline natively. **No dependency on the external voicemode MCP** (it's an optional power-user provider endpoint only).
- **Audio pipeline lives in the webview (JS):** `getUserMedia` + Web Audio capture, `@ricky0123/vad-web` (Silero v5 WASM) for silence detection, `<audio>`/Web Audio for playback.
- **STT/TTS go through a thin Go proxy** so the API key never reaches the frontend (also works over quant's remote/Cloudflare-tunnel browser path). STT/TTS are plain OpenAI-compatible HTTP: `POST /v1/audio/transcriptions` (multipart: `model`, `file`, `response_format`, `prompt?`, `language?`) and `POST /v1/audio/speech` (json: `model`, `input`, `voice`, `response_format`, `speed?`, `instructions?`). Defaults: voice `am_onyx`, speed `1.2`.
- **Conversation loop = structured voice session (MCP voice tools).** A voice session is a normal hosted Claude session given a "you're in a voice conversation" persona; it drives the turn-taking by calling two new quant MCP tools — `voice_listen()` (capture+VAD+STT → returns the user's transcript) and `voice_speak(text)` (TTS → plays audio). **Clean spoken text by construction** (the agent hands us the exact text). The MCP handlers (Go) bridge to the frontend audio pipeline via a request/response over the event bus (see WI-2.3). *Fallback if the MCP round-trip proves awkward: run the voice session headless via `--output-format stream-json` and orchestrate in Go — documented in Risks.*
- **Orb is theme-driven:** color = active theme accent (`--q-accent`); neon needs a dark stage, so the orb sits in a dark radial "well" even in light themes; light themes bloom the orb's *colored* output (never white). 4 states `idle/listening/thinking/speaking`; listening calm, speaking flares.

**Already built (P0+P1):** see WI-0.x. The two big unknowns are retired — getUserMedia works in WKWebView (after a Wails patch, PROVEN live), and the orb renders theme-driven.

---

## Key integration points (codebase map — verified)

- **Wails v2.12.0.** Webviews: WKWebView (mac), WebView2 (win), WebKitGTK (linux).
- **Go↔React bridge:**
  - Bindings: controllers registered in `internal/infra/application.go` (`Bind: []interface{}{...}`, ~L323-336) → exposed at `window.go.controller.<Struct>.<Method>`, wrapped by `frontend/src/api.ts` `callGo(pkg, struct, method, ...)`.
  - Events (Go→JS push): `remote.Emit(ctx, "event:name", payload)` ↔ `window.runtime.EventsOn("event:name", cb)`. Example: `session:output` emitted at `internal/integration/process/manager.go:~295`, consumed in `frontend/src/App.tsx:~639`.
  - Remote transport: `internal/integration/remote/dispatch.go` reflectively invokes the *same* controllers over HTTP/WS, with a `window.go` shim so the React app runs unmodified in a remote browser.
- **Pane pattern to copy = mindmap pane** (the template for VoicePane):
  - Global config-backed flag in `frontend/src/App.tsx` (`mindmapPaneOpen`, ~L99), persisted via `api.setMindmapPaneOpen` (~L170) → `configController.SetMindmapPaneOpen` (`internal/integration/entrypoint/controller/config.go:~61`).
  - Cross-tab/remote sync via `mindmap:pane` event (`App.tsx:~627`).
  - Rendered as a split in `frontend/src/components/SessionPanel.tsx` (~L434-442); toggle button (~L295, themed with `--q-*`).
- **Settings:** `frontend/src/components/Settings.tsx` — `SettingsTab` union (~L7), `NAV_ITEMS` (~L9), switch (~L166-175); each tab a component using `<Section>` + `update(...)`. Persistence: `api.getConfig`/`saveConfig` (`api.ts:~255,259`) → `configController.GetConfig`/`SaveConfig` → `configManager`. Schema: `frontend/src/types.ts` (`Config`) + the Go config struct/DTO.
- **MCP server:** `internal/integration/mcp/server.go` — `NewQuantMCPServer` (~L48), `registerTools` (~L122) via `mcpServer.AddTool(mcp.NewTool(...), handler)`; Streamable HTTP at `/mcp`. **Per-session scope:** reads `X-Quant-Session` header into ctx (~L65-67). `send_message` handler (~L707) + auto-submit primitive (PR #66, v3.1.29).
- **MCP injection into sessions:** `injectQuantMCP(port)` in `internal/infra/application.go:~113` writes `~/.mcp.json` (type http, url `http://localhost:<port>/mcp`, header `X-Quant-Session: ${QUANT_SESSION_ID}`) + enables it in `~/.claude*/settings.local.json`; spawned Claude gets `QUANT_SESSION_ID` env (`process/manager.go:~223`).
- **Process spawning:** `internal/integration/process/manager.go` — `pty.Start` (~L226), `Spawn` (~L151), `SendMessage` (~L370).
- **Mic permission (done):** `build/darwin/Info.plist:62` + `Info.dev.plist:67` — `NSMicrophoneUsageDescription`.
- **No pre-existing audio code** anywhere in the repo (other than these new additions).

---

## P0 — De-risk (✅ DONE)

### WI-0.1 — macOS WKWebView mic permission patch ✅
- **Problem:** Wails v2.12 declares `<WKUIDelegate>` but never implements the media-capture method → macOS 12+ auto-denies `getUserMedia`.
- **Done:** vendored patched Wails at `third_party/wails-v2.12.0-patched/` + `replace github.com/wailsapp/wails/v2 => ./third_party/wails-v2.12.0-patched` in `go.mod`. Added the WKUIDelegate `requestMediaCapturePermissionForOrigin:...decisionHandler:` method (returns `WKPermissionDecisionGrant`; OS TCC still gates via the existing `NSMicrophoneUsageDescription`) in `.../darwin/WailsContext.m`. Also added the analogous Linux patch in `.../linux/window.c` (`webkit_settings_set_enable_media_stream(true)` + `permission-request` handler) — **not yet compile-checked on Linux** (see WI-5.4). Windows WebView2 needs nothing.
- **Verified:** compiles + links clean; grant method present in the Mach-O; **PROVEN live** — `getUserMedia({audio:true})` returned SUCCESS in WKWebView (sandboxed `wails dev` + MicProbe button, 2026-06-06).
- **Gotcha:** local-path `replace` bypasses go.sum (no checksum entry needed). Full manual link needs `-framework UniformTypeIdentifiers` (pre-existing upstream quirk; the normal `wails build` toolchain injects it automatically).
- **Source location pre-consolidation:** worktree `agent-a6e03901819d593b8`.

### WI-0.2 — Orb React component ✅
- **Done:** `frontend/src/components/VoiceOrb.tsx` (raw Three.js in `useEffect`, not R3F) + `frontend/src/components/voiceOrbTheme.ts` (reads `--q-accent`/`--q-bg`/`--q-blue`/`--q-warning` off `<html>`; luminance → light/dark recipe; `MutationObserver` re-reads on theme change) + dev harness `VoiceOrb.dev.tsx` / `voice-orb-dev.html` / `vite.orb.config.ts` (port 5180). Dep added: `three@0.160` (+ `@types/three`).
- **Props:** `state: 'idle'|'listening'|'thinking'|'speaking'`, optional `analyser?: AnalyserNode`, `level?: number`, `size?`, `themeKey?`, `className`/`style`. State/analyser/level read via refs (WebGL context never rebuilt on prop change; only `size`/`themeKey` rebuild).
- **Verified:** `tsc --noEmit` + `vite build` clean; Playwright screenshots across dark/light × 4 states match prototypes.
- **Follow-up (P5):** the **speaking flare overflows the pane frame** — dial back ~10-15% (WI-5.1).
- **Source location pre-consolidation:** worktree `agent-a0175d46e9de22449`.

---

## Consolidation

### WI-C.1 — Merge both worktrees into `feat/voice` ⬜ (in progress now)
- Create branch `feat/voice` and bring together: the Wails patch (`third_party/` + `go.mod` replace) and the orb (`VoiceOrb*.tsx`, `voiceOrbTheme.ts`, `three` dep, dev harness).
- Decide on `MicProbe.tsx`: keep the file as a dev utility but **unmounted** (remove the `App.tsx` import + mount) so the branch is clean. The patch is the durable part; the probe is recoverable for re-testing other platforms.
- **Acceptance:** `feat/voice` checks out, `go build ./...` compiles (with the replace), `cd frontend && npm i && npx tsc --noEmit && npm run build` pass.

---

## P2 — Audio pipeline + plumbing (the engine)

> Goal: a working capture→STT and TTS→playback path, plus the Go↔frontend bridge the MCP voice tools need. No fancy UI yet; validate with a temp dev trigger.

### WI-2.1 — Go STT/TTS proxy controller ⬜
- **New:** `internal/integration/voice/` package + a controller (e.g. `VoiceController`) bound in `application.go` (~L323) and surfaced in `frontend/src/api.ts`.
- **Methods:**
  - `Transcribe(audio []byte, mime string) (string, error)` → multipart `POST {providerBaseURL}/v1/audio/transcriptions` with `model` (e.g. `whisper-1` cloud / `Systran/faster-whisper-base` local), `file`, `response_format=text`, optional `language`. Returns transcript text.
  - `Synthesize(text, voice string, speed float64) ([]byte, string, error)` → `POST {providerBaseURL}/v1/audio/speech` json `{model, input:text, voice, response_format:"mp3", speed}`. Returns audio bytes + content-type.
- **Config source:** read provider base URL + API key + model names + default voice/speed from `configManager` (WI-4.x). Key stays Go-side; never returned to frontend.
- **Provider selection:** implement the simple local-first/cloud-fallback = ordered list of base URLs, first success wins (mirrors voicemode). `isLocal` = URL host is localhost/127.0.0.1.
- **Acceptance:** unit/integration test (or temp CLI) round-trips a short WAV → transcript, and text → audio bytes, against a configured endpoint.

### WI-2.2 — Frontend audio service ⬜
- **New:** `frontend/src/voice/audioService.ts` (+ types). Responsibilities:
  - **Capture:** `getUserMedia({audio:true})`, build an `AudioContext` + `AnalyserNode` (exposed for the orb), feed frames to VAD.
  - **VAD:** integrate `@ricky0123/vad-web` (Silero v5). **Self-host the WASM/onnx assets** (set `baseAssetPath` to a bundled path — do NOT rely on CDN; must work offline + over the tunnel). On speech-start → orb `listening`; on speech-end (VAD) → stop, assemble the recorded PCM/WAV, hand off for STT.
  - **STT:** POST recorded audio to the Go proxy (`api.transcribe`), return transcript.
  - **TTS+playback:** given text, call `api.synthesize`, play via an `<audio>` element / Web Audio; `play`/`playing` → orb `speaking`, `ended` → back to `idle`/next turn. Expose the playback node to an AnalyserNode too (optional, for speaking-reactive orb).
  - **Barge-in hook (stub for P5):** if VAD detects speech while TTS is playing, pause playback.
- **Add deps:** `@ricky0123/vad-web` (+ `onnxruntime-web` if required), bundle assets.
- **Acceptance:** a temp dev button (or the dev harness) does: click → speak → see transcript logged; type text → hear TTS; orb reacts (listening on capture, speaking on playback).

### WI-2.3 — Go↔frontend voice request/response bridge ⬜
- **Why:** MCP voice tools run in Go, but audio I/O is in the frontend. Need a request→do-audio→reply round-trip.
- **Mechanism:**
  - Go: when a voice tool fires, emit a targeted event `voice:request` `{sessionId, requestId, kind:"listen"|"speak", text?}` and block on a Go channel keyed by `requestId` (with timeout).
  - Frontend: the VoicePane for that `sessionId` handles `voice:request` → runs `audioService` (listen → transcript, or speak → done) → calls a controller method `VoiceResult(requestId, {transcript?|done})`.
  - Go: `VoiceResult` controller pushes onto the channel, unblocking the tool handler, which returns the transcript (listen) or ack (speak).
- **Edge cases (note for v1):** which client responds if multiple tabs/remote have the pane open → target the active/primary; timeout → tool returns an error the agent can recover from.
- **Acceptance:** a Go test (or temp tool) can call "listen" and receive a transcript captured in the frontend, and "speak" and have audio play, end to end.

### WI-2.4 — MCP voice tools ⬜
- **In `internal/integration/mcp/server.go` (`registerTools`):** add
  - `voice_listen()` → via WI-2.3 returns the user's transcript (orb `listening`→`thinking`).
  - `voice_speak(text string)` → via WI-2.3 plays TTS of `text` (orb `speaking`), returns when done.
  - (Optional sugar) `voice_converse(text string)` = speak then listen in one call (mirrors voicemode `converse`).
- Scope to the calling session via the existing `X-Quant-Session` ctx.
- **Acceptance:** a hosted session can call `voice_speak`/`voice_listen` and the loop works against a live pane.

---

## P3 — Voice pane UI + session mode

### WI-3.1 — VoicePane component ⬜
- **New:** `frontend/src/components/VoicePane.tsx` — centerpiece `<VoiceOrb state={...} analyser={...} />` + a clean transcript (`you ▸` / `quant ▸`) + a listen/status bar. Themed via `--q-*`. Drives orb `state` from `audioService` signals (WI-2.2) and/or `voice:request` events (WI-2.3).
- **Acceptance:** renders in isolation (dev harness) and reflects listening/thinking/speaking/idle.

### WI-3.2 — Pane toggle + global state (mirror mindmap) ⬜
- Add `voicePaneOpen` global flag in `App.tsx` (mirror `mindmapPaneOpen` ~L99); persist via a new `configController.SetVoicePaneOpen`; sync via a `voice:pane` event; render the pane as a split in `SessionPanel.tsx` (~L434-442); add a toggle button (mirror ~L295). The green `voice` control in the session header is the toggle.
- **Acceptance:** toggling opens/closes the pane, persists, and syncs across tabs/remote (like mindmap).

### WI-3.3 — Structured voice session (persona) ⬜
- Define the voice-session **system prompt/persona**: "You're in a spoken conversation. Use `voice_listen` to hear the user and `voice_speak` to reply. Keep replies concise and speech-friendly. Loop: listen → think → speak." Decide UX: **create-as-voice** (a new session pre-wired) vs **enter-voice** (toggle an existing session into voice mode). Recommend: toggling the pane on a session starts the voice loop (kick the agent with an initial `voice_converse`/`voice_listen`).
- **Acceptance:** opening the voice pane on a session starts a natural hands-free conversation loop.

---

## P4 — Settings → Voice + onboarding

### WI-4.1 — Voice config schema ⬜
- Add to `frontend/src/types.ts` `Config` and the Go config struct/DTO: `voice: { enabled, provider: "auto"|"local"|"cloud", baseUrl?, apiKey, sttModel, ttsModel, voice (default "am_onyx"), speed (default 1.2) }`. Ensure `SaveConfig`/`GetConfig` round-trip them. **API key must not be exposed to remote clients** (mask in DTO sent to frontend, keep raw Go-side).
- **Acceptance:** settings persist and the proxy (WI-2.1) reads them.

### WI-4.2 — Settings "Voice" tab ⬜
- Add `"voice"` to `SettingsTab` + `NAV_ITEMS` + switch in `Settings.tsx`; new `VoiceTab` component: enable toggle, provider (auto/local/cloud), base URL (advanced), API key, voice (`am_onyx`), speed (`1.2`), and a **"Test voice"** button (calls `Synthesize` + plays).
- **Acceptance:** a new user can enable voice with just an API key and hear the test voice.

### WI-4.3 — Onboarding / provider defaults ⬜
- New users default to **cloud** (OpenAI-compatible, key) — zero local install. Power users: local URLs (their own whisper/kokoro). Per cross-platform rule: **link install guides, never auto-download binaries**. Provide a short "use local engines" help link.
- **Acceptance:** with only a cloud key set, the full loop works; local is documented, not bundled.

---

## P5 — Polish

- **WI-5.1 — Orb flare tuning ⬜:** reduce the `speaking` flare ~10-15% so it stays inside the pane frame (tune bloom strength + expansion in `VoiceOrb.tsx`). Re-screenshot to confirm.
- **WI-5.2 — Barge-in ⬜:** interrupt TTS when the user starts speaking (VAD-during-playback → pause `<audio>`, switch to listening).
- **WI-5.3 — Sentence streaming ⬜:** stream TTS per sentence for lower latency (optional; `voice_speak` could chunk).
- **WI-5.4 — Cross-platform verify ⬜:** compile-check the Linux WebKitGTK patch (WI-0.1) on a Linux build; confirm WebView2 mic on Windows (should work as-is). Document.
- **WI-5.5 — States ⬜:** error / empty / mic-permission-denied / no-network UI states in the pane + Settings.
- **WI-5.6 — VAD tuning ⬜:** expose/auto-tune `vad_aggressiveness`, min/max listen durations.

---

## P6 — Ship

- **WI-6.1 — Tests ⬜:** implement the full **Testing & E2E plan** below (Go proxy + bridge + MCP tools + headless full-loop via fake audio + orb visual regression). Frontend: typecheck + build green.
- **WI-6.2 — Changelog ⬜:** add a `changelog.json` entry (feature: native voice mode + orb). Bump version.
- **WI-6.3 — PR ⬜:** open PR from `feat/voice` (GabiHert github account for quant). **Commit messages: do NOT mention co-authoring** (global rule for `/Documents/Projects/`). Update memory `project_voice_orchestrator_feature.md` on merge.

---

## Testing & E2E plan

> **Headline:** ~80% is automatable with **no human in the loop**. The enabler is Chromium's fake-audio device: feed a `.wav` as the microphone and auto-grant permission, so Playwright drives the whole pipeline deterministically. The **only** human-required checks are the native WKWebView mic grant (Playwright can't attach to the native window) and subjective audio quality/latency.

### A. Testability matrix

| Layer (WI) | Automatable? | How | Needs human? |
|---|---|---|---|
| Go STT/TTS proxy (2.1) | ✅ full | Go test vs `httptest` mock provider | no |
| Frontend audioService: capture+VAD+STT+playback (2.2) | ✅ full | Playwright + Chromium fake-audio + mock provider | no |
| Go↔frontend bridge (2.3) | ✅ full | Go test: emit `voice:request`, simulate `VoiceResult`, assert channel round-trip + timeout | no |
| MCP voice tools (2.4) | ✅ full | e2e over MCP-HTTP (mirror `session_submit_test.go`) + stub frontend responder | no |
| Full conversation loop (3.x) | ✅ mostly | Playwright drives the **real quant frontend over the remote/browser transport**, fake audio + mock provider + stub agent | no (functional); feel = human |
| Orb visual (P1) | ✅ | Playwright screenshot regression across 4 states × dark/light (baselines exist) | no |
| **Native WKWebView mic grant (0.1)** | ❌ | native window — not Playwright-reachable | **yes** (MicProbe click per Wails bump) |
| Audio quality / TTS naturalness / latency / barge-in feel | ❌ | subjective | **yes** |
| Real cloud provider accuracy + cost | ⚠️ optional | env-gated test hitting a real endpoint | one-off |
| Windows WebView2 / Linux WebKitGTK native mic | ⚠️ | per-platform manual or device-lab | yes (rare) |

### B. Key enabler — Chromium fake audio (Playwright)

Launch headless Chromium with:
```
--use-fake-ui-for-media-stream          # auto-accept the getUserMedia prompt
--use-fake-device-for-media-stream      # synthetic media devices
--use-file-for-fake-audio-capture=<fixtures>/utterance.wav%noloop   # feed a WAV as the mic
```
This makes `getUserMedia({audio:true})` resolve with a stream whose audio is the WAV's contents → real VAD sees real speech-shaped audio and endpoints correctly → the capture→VAD→STT path runs end to end with **zero human input**. (Caveat: this validates the *browser* pipeline in Chromium, not WKWebView specifically — the WKWebView patch is covered separately/manually.)

### C. Fixtures & determinism (mirror the existing `R42Z` echo trick)

- `fixtures/utterance.wav` — a short spoken phrase (e.g. "what is six times seven"). Keep a couple of variants (short, long-with-pause to exercise VAD endpointing).
- **Mock provider** (`httptest` in Go; or an in-test fetch stub in the browser): `/v1/audio/transcriptions` returns a **known transcript marker**; `/v1/audio/speech` returns a tiny valid MP3. Deterministic in/out → exact assertions.
- **Stub agent** for the full-loop test: a session/persona instructed to reply with a fixed marker (e.g. answer "42") so the loop asserts `transcript-in → marker-out → TTS-called → audio played`.

### D. Concrete test cases (per WI)

1. **WI-2.1 proxy (Go):** asserts multipart fields (`model`/`file`/`response_format`), API key header injected, key NEVER in any frontend-facing DTO; **fallback ordering** (first base URL → 500 → second succeeds); `isLocal` detection.
2. **WI-2.2 audioService (Playwright):** feed `utterance.wav` → assert returned transcript === marker; assert VAD fired speech-start then speech-end (no infinite record); `speak(text)` → assert `<audio>` emitted `play`+`ended`; assert AnalyserNode yields non-zero levels (orb has data).
3. **WI-2.3 bridge (Go):** tool emits `voice:request{requestId}` → test calls `VoiceResult(requestId, transcript)` → handler returns it; **timeout path** returns a recoverable error; wrong/duplicate `requestId` ignored.
4. **WI-2.4 MCP tools (e2e):** call `voice_speak`/`voice_listen` over MCP-HTTP with `X-Quant-Session` (mirror `internal/e2e/session_submit_test.go` `callRaw`), stub frontend responder; assert `voice_listen` returns the marker transcript and `voice_speak` acks after playback.
5. **WI-3.x full loop (Playwright over remote transport):** start the app in browser/remote mode (`internal/integration/remote/dispatch.go`; auth passcode per `project_remote_access`), open the voice pane on a stub-agent session, run one turn with fake audio → assert transcript pair renders (`you ▸ …` / `quant ▸ 42`), orb transitioned listening→thinking→speaking→idle, TTS endpoint was hit.
6. **Orb visual (Playwright):** screenshot regression vs committed baselines across 4 states × dark/light; fail on diff over threshold.

### E. CI strategy

- **Default CI (no secrets, headless):** Go tests (proxy/bridge/MCP) + Playwright project (fake audio + mock provider + stub agent + orb visual). Fully hermetic.
- **Nightly/optional (gated by env):** one real-cloud-provider smoke test (accuracy + cost sanity) behind `VOICE_E2E_REAL=1` + a key.
- **Self-host VAD assets** so the headless run is offline (no CDN) — same requirement as WI-2.2.

### F. Manual checklist (the human-only set — keep it small)

- [ ] **WKWebView mic grant** after any Wails bump: `wails dev` (sandboxed HOME) → MicProbe → SUCCESS. *(The one true blocker for automation.)*
- [ ] Subjective: TTS naturalness, end-to-end latency, barge-in responsiveness.
- [ ] Real cloud provider: transcription accuracy + cost sanity (one-off).
- [ ] Windows WebView2 + Linux WebKitGTK native mic (per-platform, rare).

---

## Open risks / decisions

1. **Conversation loop mechanism (the one real architectural choice):** MCP voice tools (chosen — clean text by construction, native, reuses MCP + per-session scope) vs headless `stream-json` orchestration (fallback). If the WI-2.3 round-trip (Go tool blocking on a frontend reply) proves fragile, switch the loop to: frontend captures → STT → `send_message` (auto-submit, already built) into a session run with `--output-format stream-json` → parse clean assistant text → TTS. Keep this fallback in mind during P2.
2. **Multi-client targeting:** which frontend handles `voice:request` when multiple tabs/remote clients have the pane open. v1: target the active/primary client; document.
3. **Cloud cost visibility** for cloud STT/TTS users — surface usage somewhere (later).
4. **VAD assets offline:** must self-host `@ricky0123/vad-web` WASM/onnx (no CDN) for offline + tunnel.
5. **Remote/tunnel mic:** getUserMedia in the remote browser is a *different* context than WKWebView (real browser, needs HTTPS secure context — the tunnel is https). Validate the remote path separately in P5.

---

## Build order (suggested)

`WI-C.1` → `WI-2.1` + `WI-2.2` (parallel) → `WI-2.3` → `WI-2.4` → `WI-3.1` → `WI-3.2` → `WI-3.3` → `WI-4.1` → `WI-4.2` → `WI-4.3` → P5 polish → P6 ship.

First proof-of-life milestone: after WI-2.4, a hosted session can hold a spoken turn (speak + listen) even before the nice pane exists. After WI-3.x it's a real feature. P4 makes it onboardable. P5/P6 ship it.
