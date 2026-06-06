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
- [ ] WI-4.1 + WI-2.1 — config schema + Go STT/TTS proxy
- [ ] WI-2.2 — frontend audioService (getUserMedia + vad-web + playback)
- [ ] WI-2.3 — Go<->frontend voice bridge (voice:request / VoiceResult)
- [ ] WI-2.4 — MCP voice tools (voice_listen / voice_speak)
- [ ] WI-3.1 — VoicePane component
- [ ] WI-3.2 — pane toggle + global state (mirror mindmap)
- [ ] WI-3.3 — structured voice session persona
- [ ] WI-4.2 — Settings "Voice" tab
- [ ] WI-4.3 — onboarding/provider defaults
- [ ] P5 — polish (orb flare, barge-in, states, VAD tuning)
- [ ] P6 — tests, changelog, PR

## Decisions / findings (newest first)
- 2026-06-06: Night shift started. Combining WI-4.1+2.1 (Go config+proxy) into one agent for coherent ownership; rest sequenced to avoid same-file conflicts in the shared worktree.
