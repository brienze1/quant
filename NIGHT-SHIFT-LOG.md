# Voice feature — Night Shift build log

Orchestrator (Claude) building the Voice feature autonomously per `prototypes/voice-build-plan.md`.
Workspace: `.claude/worktrees/feat-voice` (branch `feat/voice`). Started from `e59fbb3`.

## Hard constraints (do not violate)
- DO NOT touch the running production quant (`/opt/homebrew/.../quant.app`, PID 33573).
- DO NOT touch `/Users/gabriel.herter/Documents/Personal/maxsatt/` (maxsatt workspace in use).
- Any app/dev run uses a sandboxed `HOME=$(mktemp -d)` (caches passed via env) so the real `~/.mcp.json` / `~/.claude` are never rewritten.
- Commits: NO co-author line (global rule for /Documents/Projects/).
- Cross-platform: link install guides, never auto-download dep binaries.

## Status
- [x] Baseline: feat-voice Go build clean, no uncommitted changes (e59fbb3)
- [x] WI-4.1 + WI-2.1 — config schema + Go STT/TTS proxy (commit ed1da2f). Go tests green, tsc green.
- [x] WI-2.2 — frontend audioService (getUserMedia + vad-web + playback) (commit 4ad78fc). tsc+vite green. Injectable transport for mocks; window.__voiceService exposed. NOTE: public/vad assets = 41M (trim unused ort wasm variants at ship).
- [x] WI-2.3 + WI-2.4 — Go<->frontend voice bridge + MCP voice tools (commit 39053d4). PROOF-OF-LIFE: e2e TestVoiceToolsRoundTrip green (listen/speak/converse over MCP-HTTP w/ X-Quant-Session). bridge unit tests green.
- [x] WI-3.1 + WI-3.2 — VoicePane component + pane toggle/global state (commit d2c8ec9). tsc+vite+go green. Transcript via registerVoiceBridge callbacks {onUserTranscript,onAgentSpeak}. Dock layout stacks voice+mindmap.
- [x] WI-3.3 — structured voice session persona + kickoff (commit c902494). enter-voice UX; hydration-safe guard; gating note for P4.
- [x] WI-4.2 + WI-4.3 — Settings "Voice" tab + onboarding/provider defaults (commit c8b9503). masked-key UX, Test Voice, gating on enabled.
- [x] P5 — polish (orb flare, barge-in, error/empty states, VAD tuning, x-platform docs) (commit 0c17089). tsc+vite green.
- [x] P6 WI-6.1 — E2E suite GREEN (commit 5a8d946): Playwright 11 passed (fake-audio listen/speak/barge-in + orb visual ×8), Go voice+e2e green incl TestVoiceToolsRoundTrip. Real Silero VAD confirmed endpointing the fixture WAV.
- [x] P6 WI-6.2 — changelog v3.1.30 (commit 6271702).
- [x] LOCAL-ONLY — separate STT/TTS endpoints + optional auth (commit 820915c). User wants local models only (Whisper STT + Kokoro TTS, no OpenAI). Config: provider=local, sttBaseUrl(whisper), ttsBaseUrl=http://localhost:8880, ttsModel=kokoro, voice=am_onyx, no key.
- [ ] P6 WI-6.3 — PR (GabiHert acct, no co-author). PENDING.
- [ ] LIVE TALK-TEST — sandboxed wails dev; waiting on user's Whisper URL + Kokoro running.

## Live debugging (wails dev + Playwright MCP @ localhost:34115) — 2026-06-06/07
Real bugs found ONLY via live testing (mocked unit/E2E missed them) and fixed + verified live:
1. Wails binding namespace: voiceController is in Go pkg `voice`, api.ts called it under `controller` → "Binding not available" → every voice call failed (the true cause of "couldn't start voice mode"). Fix 6d4a498 (VOICE_PKG="voice"). Verified: window.go.voice.voiceController resolves.
2. Misleading kickoff error masked #1. Fix 0d30d97.
3. AudioContext suspended (no gesture) → dead mic level meter. Fix a457956 (resumeContext on gesture).
4. VAD failed to load in vite dev (ort .mjs ?import → 500). Fix 56456c7 (vite middleware serves /vad/* raw). Verified: "...finished loading VAD".
5. Voice toggle gated on "running" only → blocked waiting/done (live) sessions. Fix cea263d.
6. Bridge emitted voice:request with the MCP request ctx, not the Wails lifecycle ctx → "invalid context" → loop hung ("app broke"). Fix b481a68 (bridge.SetContext in OnStartup). Verified live: voice_speak → frontend received voice:request → VoiceResult round-trip OK.
7. TTS "starts playing then breaks": self-barge-in. VoicePane ran with bargeIn:true and the mic had NO echo cancellation → the agent's own TTS leaked from speakers into the mic, VAD fired speechStart, handleSpeechStart→stopSpeaking cut the reply mid-word (loop then retried). Fix (this run): default barge-in OFF in VoicePane (half-duplex: speak fully, then listen); mic constraints now request echoCancellation+noiseSuppression+autoGainControl; new barge-in guard window (bargeInGuardMs default 1200, setBargeInGuardMs setter) suppresses speechStart for the first 1.2s of playback so the agent's opening syllable can't self-interrupt. bargeIn.spec.ts updated to setBargeInGuardMs(0). Verified: tsc ✓, vite build ✓, 11/11 Playwright voice tests ✓.
8. Orb didn't react to the USER's voice (only to the agent speaking). Root cause: the input AnalyserNode was source→analyser with NO path to ctx.destination. Chrome auto-pulls such a node (verified via oscillator probe: freqSum~1500), but WebKit/Safari leaves it un-pulled → getByteFrequencyData (orb) and getByteTimeDomainData (meter) read flat. The output analyser worked because it's connected to destination. Fix (this run): route the input analyser through a muted GainNode (gain=0) → destination so it's pulled in all engines without echo (inputSink field, disconnected in teardownCapture).
9. Transcript not persistent. It lived only in React useState → lost on pane close / refresh / session switch (and switching sessions showed the prior session's lines). Fix (this run): new src/voice/transcriptStore.ts (loadTranscript/saveTranscript/nextLineId, localStorage keyed quant.voiceTranscript.<sessionId>, capped 200 lines); VoicePane hydrates on mount, reloads on session switch, persists on change, with a linesSessionRef guard so the persist effect can't write the prior session's lines under a new sessionId. Mirrors the mindmap board + input-device localStorage pattern. Verified: tsc ✓, vite build ✓, 11/11 Playwright voice tests ✓.
Verified live: binding ✓, Synthesize→Kokoro MP3 ✓, mic devices ✓, VAD load ✓, orb ✓, bridge emit/round-trip ✓.
Testing approach (per user): wails dev (real HOME + QUANT_HOME isolated + normal MCP injection) at http://localhost:34115 + Playwright MCP — see [[reference_quant_wails_binding_and_testing]].

## Build complete summary
Full Voice feature built, committed on feat/voice, all automated tests green. Commits: ed1da2f, 4ad78fc, 39053d4, d2c8ec9, c902494, c8b9503, 0c17089, 6271702, 5a8d946, 820915c. Remaining: live hands-on test (needs user Whisper URL + Kokoro) then open PR.

## Decisions / findings (newest first)
- 2026-06-06: Night shift started. Combining WI-4.1+2.1 (Go config+proxy) into one agent for coherent ownership; rest sequenced to avoid same-file conflicts in the shared worktree.
