# Feature Plan — Voice-driven session orchestration (Supervision Tree)

> Status: **plan only** (no app code written yet). Visual reference: `prototypes/voice-orchestrator-session.html`.
> Builds on the shipped auto-submit `send_message` (PR #66, v3.1.29), which is the enabling primitive for the report-back path.

## 0. One-line pitch

Turn quant into a **voice-driven orchestrator over the sessions it already hosts**: any session can take on a mic and a crew, delegate work to assigned sessions, and receive their results as messages — push, not polling. Mentally it's an **actor model with a supervision tree** layered over quant sessions.

Inspired by the maxsatt `/voice-orchestrate` slash command, but native to quant because quant already owns the session registry, the PTY streams, the mindmap, and remote access — things a project-level slash command has to discover the hard way.

## 1. Decisions locked in

- **Capabilities, not a session type.** Two independent, composable toggles any session can have:
  - *Voice mode* — per-session mic (STT) + speech (TTS).
  - *Orchestrator mode* — a session that has worker assignments + the delegation system-prompt injected.
  Either works without the other (orchestrate by text; voice a solo session).
- **Strict scope.** `send_message` **rejects** a target that is not assigned to the caller. An orchestrator can only drive (and be reported to by) its own crew.
- **Inbox from the start.** Session→session reports do **not** go through raw PTY writes. They go through an enveloped, queued mailbox (see §4). Human→session input keeps using the existing auto-submit `send_message`.
- **No loop/storm guards** (no DAG enforcement, no per-session rate limits) for now. Revisit if chatter becomes a problem.
- **Push-based completion.** Workers report when done/blocked/needing input via `report_to_supervisor`; a watchdog timeout is the only fallback.
- **Pluggable worker backends.** An "assigned worker" abstracts over: a real interactive session, a background agent, an Agent-Teams teammate, or a quant job. The orchestrator routes by objective.

## 2. The model

```
            ┌─ orchestrator session (voice on) ─┐
            │  - has assignments (its "crew")    │
            │  - delegation system-prompt        │
            │  - drains its INBOX each turn       │
            └───────────────┬────────────────────┘
        assign │   assign │           │ assign
               ▼          ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ worker A │ │ worker B │ │ worker C │   ← each may itself be an
        │ (session)│ │ (bg agent)│ │  (job)   │     orchestrator → tree
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │ report_to_supervisor(envelope)
             └────────────┴────────────┘ ──▶ supervisor INBOX (chime)
```

- **Assignment relation** `supervisor_id → worker_id`, stored in the DB. Workers can have their own crews → supervision **tree** for free.
- **UI gesture:** drag a session card onto another session to assign it (mirrors the existing "drag a mindmap board onto a session" move at the sidebar).

## 3. Outbound path (orchestrator → worker)

Reuse the shipped primitive. `send_message(workerId, prompt)` now auto-submits (Enter as a separate keystroke after ~120ms). New behavior: **scope check** — if `workerId` is not in the caller's assignment set, return an error (strict mode). The caller can request an assignment instead.

At delegation time the orchestrator hands the worker its own identity and the report contract, e.g. *"…when done, call `report_to_supervisor` with a one-line summary."*

## 4. Inbound path (worker → orchestrator): the INBOX

The centerpiece, and the reason reports can't be raw PTY writes:

- **Concurrency** — 3 workers finishing at once would interleave 3 auto-submits into one input line and garble it.
- **Provenance** — a worker report auto-submitting looks identical to the human typing.
- **Timing** — a report landing mid-turn interrupts the orchestrator instead of folding in at the next pause.

So reports are **envelopes**:

```jsonc
{ "from": "web-frontend", "fromId": "...", "type": "done|progress|question|blocked",
  "summary": "12 tests pass, fixed the expired-token guard", "ts": "..." }
```

- Stored in a per-session **inbox queue** (DB-backed, survives restart).
- **Drained serially at turn boundaries** into the orchestrator's context, each tagged with provenance (`[done · web-frontend] …`), so the model cleanly separates crew reports from the user's voice.
- **Chime + visual badge** on arrival; folded into the live conversation at the next natural pause (matches the maxsatt voice discipline).
- `report_to_supervisor(type, summary)` is sugar: it resolves the caller's parent from the assignment graph, so workers never juggle the supervisor's id.

**Watchdog:** each delegation carries an expected-by timeout; on expiry the orchestrator is nudged ("no word from `infra` in 10m — check?"). This is the only safety net we keep (per decision #3 we skip rate/loop guards).

## 5. Build list (new primitives)

1. **Session self-identity** — extend the existing `QUANT_SESSION_ID` env / `X-Quant-Session` header plumbing (already used by mindmap) so a session/tool knows "who am I".
2. **Assignment API + storage** — `assign_session`, `unassign_session`, scope listing; DB relation; sidebar drag gesture.
3. **Scoped `send_message`** — strict reject of unassigned targets.
4. **Inbox layer** — envelope schema, per-session queue, serial drain at turn boundaries, chime + badge; `report_to_supervisor` sugar tool.
5. **Watchdog/timeout** on delegations.
6. **Voice capability** — per-session mic toggle + native voice-mode setup (§6).

## 6. Native voice setup (so a new user can actually use it)

Quant owns the whole `voice-mode` MCP lifecycle — no terminal yak-shaving:

- **Auto-inject the `voice-mode` MCP** into a session's MCP config the same way quant already injects its own server into `~/.mcp.json` (`internal/infra/application.go:130`).
- **Settings → Voice, one-click enable** that either:
  - starts local STT+TTS engines (whisper + kokoro) via voicemode's own `service(status|start)` calls, **or**
  - points at a **cloud OpenAI-compatible** STT/TTS endpoint (just an API key) — the **zero-local-install default** for first-run users.
- **Persona defaults** baked in + configurable: `voice: am_onyx`, `speed: 1.2`.
- **Mic permission** already declared on macOS (v3.1.28). For Windows/Linux, per the cross-platform rule: **link install guides, do not auto-download binaries**; default new users to the cloud endpoint so voice works with only a key.

## 7. Suggested first slice (prove the round-trip)

`assign_session` + scoped `send_message` + `report_to_supervisor` → wire **one orchestrator to one worker** (both real sessions, text-only, no inbox UI yet) and watch: orchestrator delegates → worker runs (auto-submit) → worker reports → message lands in orchestrator. Then layer the inbox envelope/drain, then the voice capability, then the fleet/inbox UI.

## 8. Strategic note

Anthropic's official **Agent Teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) attacks inter-agent messaging from inside the CLI. Quant's differentiated layer is **voice + a visual bridge over sessions it already hosts** — lean into the cockpit/visualization/voice, and let Agent Teams be one of the pluggable backends rather than something to reinvent.
