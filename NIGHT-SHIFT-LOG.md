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
- [ ] P6 — E2E tests (WI-6.1), changelog (WI-6.2), PR (WI-6.3)

## Decisions / findings (newest first)
- 2026-06-06: Night shift started. Combining WI-4.1+2.1 (Go config+proxy) into one agent for coherent ownership; rest sequenced to avoid same-file conflicts in the shared worktree.
