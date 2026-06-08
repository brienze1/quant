# Voice feature — v1 plan (quant)

> Status: **plan locked, not built.** Orb prototyped: `prototypes/voice-orb.html` (dark), `voice-orb-monokai.html`, `voice-orb-quietlight.html`. The **Crew** (orchestration) feature is **deferred** — Voice ships first and stands alone.
>
> **Architecture: B2 — quant owns the voice pipeline natively.** No dependency on the external `voicemode` MCP. Audio capture/VAD/playback run in the webview (JavaScript); STT/TTS HTTP calls are proxied through the Go backend so the API key never reaches the frontend.

## Decisions (locked)

- **Scope:** ship **Voice only**; defer Crew (assignments / inbox / scoped send_message).
- **Engine = B2, owned in-app.** quant runs its own converse loop. No external MCP required.
  - **Audio pipeline = browser-JS** (in the webview): `getUserMedia` + Web Audio for capture; **`@ricky0123/vad-web`** (Silero v5 WASM) for VAD/silence-detection; `<audio>` / Web Audio for playback. **Zero native deps.**
  - **STT/TTS = Go proxy.** Frontend posts audio to a Go controller; Go does `net/http` to an **OpenAI-compatible** provider (`/v1/audio/transcriptions`, `/v1/audio/speech`) and streams results back over the event bus. Key stays Go-side; works over the remote/Cloudflare-tunnel browser path too.
  - **Provider is configurable, not auto-injected.** Default for new users = **cloud OpenAI-compatible** (just an API key). Power users point at a **local URL** (their own whisper/kokoro). Default persona `am_onyx`, speed `1.2`.
- **Turn-taking:** **hands-free VAD** (Silero in `vad-web`; tune via positive/negative speech thresholds + redemption frames). No push-to-talk.
- **Voice session = structured mode (Option 1).** A voice session is an agent whose interaction loop is: speak reply → VAD-listen → STT → feed transcript back to the agent. Clean spoken text **by construction** — no TUI scraping.
- **UI:** a **toggleable voice pane** (mirrors the mindmap pane), orb as centerpiece + clean transcript + listen bar. Toggle = the green `voice` control in the session header.
- **Orb (built):** Three.js noise-displaced sphere + fresnel rim + UnrealBloom, audio-reactive (Web Audio `AnalyserNode`), 4 states `idle/listening/thinking/speaking`. **Theme-driven**: color = active theme accent (`--q-accent`); neon needs a dark stage, so the voice console is a dark radial **well** even inside light themes (app chrome still follows the theme); light themes bloom the orb's *colored* output (never white). Listening tuned calm; speaking is the flare.

### Superseded
- **voicemode-MCP reuse (old engine plan) — SUPERSEDED by B2.** Evaluation: voicemode is MIT but thin — STT/TTS are plain OpenAI-compatible HTTP POSTs, its "local-first/cloud-fallback" is a hardcoded ordered URL list with first-success failover, and its VAD is WebRTC GMM (not ML). Only the converse-loop sequencing is worth referencing. A faithful Go port (**B1**) was **rejected** because it drags in CGo (PortAudio + webrtcvad), breaking clean cross-compilation and quant's "no bundled native binaries, stay cross-platform" rule. voicemode remains a **possible optional power-user path** (point the proxy at it) but is **not the default architecture**. (If any voicemode code is reused, keep the MIT notice.)

## Architecture

Audio lives in the webview; secrets and outbound HTTP live in Go.

```
voice session (structured agent)                       [Go backend]
   speak reply → VAD-listen → STT → feed transcript    proxied STT/TTS

  ┌───────────────── webview (JS) ─────────────────┐   ┌──────── Go ────────┐
  │ getUserMedia → Web Audio (capture)             │   │ voiceController     │
  │   ├─ AnalyserNode → orb "listening" amplitude  │   │  net/http → provider│
  │   └─ @ricky0123/vad-web (Silero v5) → endpoint │   │  /v1/audio/         │
  │        on silence → POST audio ────────────────┼──▶│    transcriptions   │
  │                                                │   │  (STT) → transcript │
  │ transcript ◀───── event bus (session:output-ish)───┤  → agent turn       │
  │ agent reply text ──── POST text ───────────────┼──▶│  /v1/audio/speech   │
  │ <audio> plays TTS bytes ◀──── audio bytes ─────┼───┤  (TTS)              │
  │   play/playing/ended events → orb "speaking"   │   │  key (Go-side)      │
  └────────────────────────────────────────────────┘   └─────────────────────┘

orb state machine (frontend-owned, no external signal needed):
   idle      → no active turn
   listening → mic open; amplitude from AnalyserNode
   thinking  → VAD endpoint fired; STT + agent reply in flight
   speaking  → <audio> playing  ← driven by play/playing/ended events
```

quant builds: **browser audio pipeline + Go STT/TTS proxy + orb React component + voice pane + structured session + Settings→Voice.** It owns the whole loop.

### Integration points (codebase)
- **Stack:** Wails v2.12.0. Webviews: WKWebView (mac), WebView2 / Chromium (win), WebKitGTK (linux).
- **Bridge:** Wails bindings (`window.go.controller.*`, wrapped by `frontend/src/api.ts` `callGo`) + events (`remote.Emit` / `window.runtime.EventsOn`); a remote transport reflectively invokes the same controllers over HTTP/WS for the browser/tunnel client. STT/TTS streaming reuses the event-bus pattern (like `session:output`).
- **Voice pane** copies the **mindmap pane**: global config-backed flag in `frontend/src/App.tsx` (`mindmapPaneOpen` → `voicePaneOpen`), persisted via `configController.SetMindmapPaneOpen` → `SetVoicePaneOpen`, synced cross-tab via a `mindmap:pane` → `voice:pane` event, rendered as a split in `frontend/src/components/SessionPanel.tsx`.
- **Settings** copies `frontend/src/components/Settings.tsx` (SettingsTab union + NAV_ITEMS + switch); config persists via `api.getConfig`/`saveConfig` → `configController` → `configManager`; schema in `frontend/src/types.ts` (`Config`) + the Go config struct.
- **STT/TTS proxy** = a new Go controller method, bound in `internal/infra/application.go` (~line 323) and exposed via `api.ts`, doing `net/http` to the provider and streaming partials over the event bus.
- **Mic permission** already declared: `build/darwin/Info.plist` + `Info.dev.plist` (`NSMicrophoneUsageDescription`), v3.1.28.
- No existing audio code in the repo.

## Build phases

- **P0 — Spike (de-risk): does `getUserMedia` work inside quant's webviews?** This is the one real unknown. macOS **WKWebView** likely needs a `WKUIDelegate` media-capture permission handler and a secure-context origin; Windows **WebView2** (Chromium) is fine; Linux **WebKitGTK** is uncertain. Spike = a ~30-line `getUserMedia` probe rendered in the mac webview. **Fallback if WKWebView refuses:** a Go-side capture helper on **macOS only** (rest stays browser-JS).
- **P1 — Orb component:** port the prototype to a React/R3F component; read colors from `--q-*` tokens (`--q-accent`); derive `isLight` from `--q-bg` luminance to pick the glow recipe. Verify across all 19 themes (`../../Personal/quant-themes/`). The orb already consumes a Web Audio `AnalyserNode`, so listening-reactivity is free; `<audio>` `play`/`playing`/`ended` events drive `speaking`.
- **P2 — Voice pane + structured session:** header toggle (`voicePaneOpen` / `voice:pane` / `SetVoicePaneOpen`); build the browser converse loop (capture → `vad-web` → endpoint) and the structured voice session (agent loop: speak → listen → STT → feed transcript); render orb + transcript + listen bar.
- **P3 — Settings → Voice + STT/TTS Go proxy:** new Settings tab; enable; **provider endpoint** (cloud OpenAI-compatible default, or a local URL); **API key** (stored Go-side); **voice** (`am_onyx`); **speed** (`1.2`); "test voice." Implement the Go proxy controller (`/v1/audio/transcriptions`, `/v1/audio/speech`), streaming partials over the event bus. Local-engine path is guided — **link install guides, never auto-download binaries** (cross-platform rule).
- **P4 — Polish:** barge-in (interrupt `<audio>` when the mic analyser detects speech), sentence/partial streaming, VAD threshold tuning, error/empty/permission states, cloud-cost visibility.

## Open risks

1. **`getUserMedia` in the webview (esp. macOS WKWebView).** Highest unknown; needs the WKUIDelegate permission handler + secure-context origin. Linux WebKitGTK uncertain. → **P0 spike**, Go-side mac capture fallback if it refuses.
2. **Session-mode coexistence** — a voice session is structured, distinct from the interactive TUI. Decide UX: create-as-voice vs let a normal session "enter" voice.
3. **Cloud cost visibility** for cloud STT/TTS users.
4. **Remote/tunnel parity** — confirm the proxy + event-bus audio path behaves over the Cloudflare-tunnel browser client (secure context should hold; verify).

## Already done
- Auto-submit `send_message` (PR #66, v3.1.29) — input-delivery primitive (reusable later).
- Orb visual + theme behavior (3 prototypes: `voice-orb.html`, `voice-orb-monokai.html`, `voice-orb-quietlight.html`).
- Mic permission declared on macOS (`NSMicrophoneUsageDescription`, v3.1.28).
