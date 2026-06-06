# Voice feature — E2E tests

Automated end-to-end coverage for the Voice feature (WI-6.1). The browser-side
pipeline is driven **deterministically and headlessly** by Chromium's fake-audio
device: a real speech WAV is fed in as the microphone so the **real Silero VAD**
endpoints it, with `getUserMedia` auto-granted. STT/TTS are mocked by the audio
dev harness (a fixed transcript marker + a tiny valid WAV), so assertions are
exact and the run needs no network and no human.

## Run

From `frontend/`:

```bash
npm run test:e2e          # = playwright test
# or
npx playwright test
```

Playwright launches both vite dev harnesses automatically (and reuses them if
already running):

- audio harness on **:5181** (`vite.audio.config.ts`) — exposes `window.__voice*`
- orb harness on **:5180** (`vite.orb.config.ts`) — orb state/theme controls

First-time setup (already done in this worktree):

```bash
npm i -D @playwright/test
npx playwright install chromium
```

To (re)generate the orb visual baselines (see the platform note below):

```bash
npx playwright test orbVisual --update-snapshots
```

## What's covered (fully automated)

| Spec | Asserts |
|---|---|
| `audioService.spec.ts` › `listen()` | fake-audio `utterance.wav` → **real Silero VAD endpoints it** (state passes through `listening` → `thinking` → `idle`, where `thinking` is only reachable from the VAD's speech-end callback) → STT mock returns the marker → DOM transcript === marker. Bounded (resolves well before `maxListen`, never infinite-records). Input AnalyserNode present (orb has live mic data). |
| `audioService.spec.ts` › `speak()` | TTS → `<audio>` emits `play` then `ended`; state goes `speaking` → `idle`; no playback error (output AnalyserNode wired best-effort for the speaking-reactive orb). |
| `bargeIn.spec.ts` | Barge-in **contract** (WI-5.2): with `bargeIn` enabled and the service `speaking`, the speech-start callback the VAD fires stops playback, resolves the in-flight `speak()`, and flips state to `listening`. Skips (not fails) if the very short mock TTS clip can't reach `speaking` in this env. The live-VAD-during-playback timing is on the manual checklist. |
| `orbVisual.spec.ts` | 4 states × {dark, light}: (1) a tolerant, animation-aware screenshot baseline of the orb stage (catches a blank/broken orb or wrong theme while allowing the per-frame WebGL pulse), and (2) a deterministic **flare-containment** guard (WI-5.1) — the speaking flare must not bleed to the stage frame. The harness mirrors production geometry (a 220px orb in a 240px dark well). |

Plus the Go side (run from the repo root):

```bash
go test ./internal/integration/voice/... ./internal/e2e/...
```

- `internal/integration/voice` — the Go STT/TTS proxy (multipart fields, API-key
  header injection, key never in any frontend DTO, local-first/cloud fallback
  ordering, `isLocal` detection) and the Go↔frontend bridge (request/resolve,
  timeout, ctx-cancel, unknown/duplicate `requestId`, concurrent no-cross-wires).
- `internal/e2e/voice_tools_test.go` › `TestVoiceToolsRoundTrip` — the MCP voice
  tools over MCP-HTTP with a stub frontend responder: `voice_listen` returns the
  transcript, `voice_speak` acks, `voice_converse` returns the reply.

## Fixtures

`tests/fixtures/utterance.wav` — real speech ("what is six times seven") so the
ML VAD actually endpoints it (a pure tone will **not** trigger Silero). Generated
on macOS:

```bash
say -o /tmp/utt.aiff "what is six times seven"
afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/utt.aiff tests/fixtures/utterance.wav
```

Format: **16000 Hz, mono, 16-bit PCM** (verified in the WAV header).
`utterance-long.wav` is a variant with a longer trailing silence to exercise
endpointing.

## Visual baselines are platform-specific

The orb screenshot baselines in `orbVisual.spec.ts-snapshots/` were generated on
**macOS Chromium** (`*-chromium-darwin.png`). They will mismatch on Linux/Windows
or a different Chromium build — regenerate per platform with
`--update-snapshots`. The flare-containment ratio check is platform-robust (it
measures mean edge-vs-core luminance, not exact pixels).

## Needs a human (manual checklist)

These cannot be automated by Playwright (it drives Chromium, not the native
WKWebView, and audio quality is subjective):

- [ ] **WKWebView mic grant** after any Wails bump — `wails dev` (sandboxed HOME)
      → MicProbe → SUCCESS. (The one true blocker for full automation.)
- [ ] Subjective: TTS naturalness, end-to-end latency, **live** barge-in feel.
- [ ] Real cloud provider: transcription accuracy + cost sanity (one-off, can be
      env-gated with `VOICE_E2E_REAL=1` + a key).
- [ ] Windows WebView2 + Linux WebKitGTK native mic (per-platform, rare).
</content>
</invoke>
