# Feature Plan — Agent-drawn live mindmap

> Status: **plan only** (no app code written yet). Visual/contract reference: `prototypes/mindmap-demo.html`.

## 1. Decisions locked in

- **Authoring model:** structured JSON (not free Mermaid/markdown text). The agent emits typed nodes via MCP tools.
- **Renderer:** `@xyflow/react` (React Flow v12) + `dagre` auto-layout. Themed with `--q-*` tokens.
- **Why not build from scratch:** `JobsView.tsx` already hand-rolls ~3700 lines of SVG pan/zoom/drag. React Flow gives all of that for free; we'd only be re-implementing it. Layout (dagre) is needed either way.

## 2. Scope: per-session (DECIDED)

The mindmap is **session-scoped** — "a map of what *this agent* is building" is inherently per-session, and workspace scope would collide when two sessions in one workspace both draw.

The agent never needs to know its own id. quant carries it on the **MCP transport via env-var expansion** (verified against Claude Code MCP config behavior — this beats per-session `--mcp-config`, whose same-name precedence vs. the global `quant` entry is undocumented/unreliable):

1. At spawn, quant sets `QUANT_SESSION_ID=<sessionID>` in the spawned process env. quant already builds the command + args at `internal/integration/process/manager.go:167-213` (it passes `--session-id` today), so adding an env var is a one-liner on the `exec.Cmd`.
2. The **existing global** `~/.mcp.json` quant entry (written at `internal/infra/application.go:130`) gains a headers field — Claude Code expands `${VAR}` inside `headers`:
   ```jsonc
   "quant": { "type": "http", "url": "http://localhost:52945/mcp",
     "headers": { "X-Quant-Session": "${QUANT_SESSION_ID}" } }
   ```
   Each session's Claude process expands *its own* env var → its own header. No per-session config files, no server-name collision.
3. The server reads it with `server.WithHTTPContextFunc` (confirmed in mcp-go **v0.46.0**) and stamps it into the request context:
   ```go
   server.NewStreamableHTTPServer(mcpServer,
     server.WithHTTPContextFunc(func(ctx context.Context, r *http.Request) context.Context {
       return context.WithValue(ctx, sessionKey, r.Header.Get("X-Quant-Session"))
     }))
   ```
4. Tool handlers read `ctx.Value(sessionKey)`. Header is sent per request, so it's stable and concurrency-safe.

Data model keeps a generic `scope_type`/`scope_id` so an external agent with no `X-Quant-Session` header falls back to the current workspace, but session is the primary path.

## 3. Data model

Mindmap = a set of nodes forming a tree (edges are implicit via `parent_id`, matching the prototype). One normalized table, mirroring the existing `job_group_members` style (not a JSON blob), so single-node upsert/delete is one SQL statement.

```sql
CREATE TABLE IF NOT EXISTS mindmap_nodes (
    id           TEXT NOT NULL,           -- agent-supplied stable id (so it can update its own nodes)
    scope_type   TEXT NOT NULL DEFAULT 'session',  -- 'session' | 'workspace'
    scope_id     TEXT NOT NULL,           -- the session id (or workspace id for the fallback path)
    parent_id    TEXT,                     -- NULL = root
    kind         TEXT NOT NULL DEFAULT 'node',      -- 'node' | 'note' (standalone sticky)
    label        TEXT,                     -- work-node label / null for sticky notes
    text         TEXT,                     -- sticky-note body
    status       TEXT NOT NULL DEFAULT 'planned',  -- planned|in_progress|done|blocked
    note         TEXT,                     -- annotation on a work node
    progress     INTEGER DEFAULT -1,       -- 0..100, -1 = no bar
    sort_order   INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (scope_type, scope_id, id)
);
```

(`kind` + `text` added so the agent can drop standalone sticky notes — see the prototype's two note flavors.)

This is the exact shape rendered in the prototype: `{ id, parentId, label, status, note?, progress? }`.

## 4. MCP tool contracts (what the agent calls)

Registered in `internal/integration/mcp/server.go` (`registerTools()` + handlers), following the `send_message` pattern.

Scope is resolved from the transport context (`X-Quant-Session`), **not** a tool param — the agent stays unaware of its id.

| Tool | Params | Effect |
|---|---|---|
| `mindmap_set_node` | `id` (req), `label` (req for work nodes), `parentId?`, `status?` (enum), `note?`, `progress?` (0-100), `kind?` (`node`\|`note`), `text?` (sticky body) | Upsert one node into the calling session's map. |
| `mindmap_remove_node` | `id` (req), `subtree?` (bool) | Delete node (and optionally its descendants). |
| `mindmap_clear` | — | Wipe this session's mindmap (e.g. at the start of a new task). |
| `mindmap_get` | — | Return current nodes (so the agent can read back state). |

Defaults: scope = calling session; `status` = `planned`; `kind` = `node`. Each mutation emits `mindmap:updated` (see §6).

## 5. Backend changes — file by file

Follows the established 13-layer convention (traced from the `job_group` feature).

**New files:**
1. `internal/domain/entity/mindmap_node.go` — `MindmapNode` struct (plain, `time.Time` fields).
2. `internal/application/usecase/find_mindmap_node.go` — `FindMindmapNodesByWorkspace`, `FindMindmapNodeByID`.
3. `internal/application/usecase/save_mindmap_node.go` — `SaveMindmapNode` (upsert).
4. `internal/application/usecase/delete_mindmap_node.go` — `DeleteMindmapNode`, `ClearMindmap`.
5. `internal/application/adapter/mindmap_manager.go` — service interface: `SetNode`, `RemoveNode`, `ClearMindmap`, `GetMindmap(sessionID)`.
6. `internal/application/service/mindmap_manager.go` — impl: stamps timestamps, delegates to usecases, then **emits `mindmap:updated`** via the event emitter (see §6).
7. `internal/integration/adapter/mindmap_persistence.go` — composite of the usecase interfaces.
8. `internal/integration/persistence/mindmap_node.go` — SQLite CRUD (`INSERT OR REPLACE`, `DELETE`, `SELECT ... WHERE workspace_id = ?`).
9. `internal/integration/persistence/dto/mindmap_node.go` — `MindmapNodeRow` + `ToEntity` / `FromEntity`.
10. `internal/integration/entrypoint/dto/mindmap.go` — `MindmapNodeResponse` (+ `json` tags: `id, parentId, label, status, note, progress`).
11. `internal/integration/adapter/mindmap_controller.go` — controller interface (`OnStartup/OnShutdown`, `GetMindmap(sessionID)`).
12. `internal/integration/entrypoint/controller/mindmap.go` — Wails-bound controller exposing `GetMindmap` to the frontend.

**Edited files:**
13. `internal/infra/db/sqlite.go` — add the `CREATE TABLE IF NOT EXISTS mindmap_nodes` to `runMigrations()`.
14. `internal/infra/dependency/injector.go` — add lazy singletons: `MindmapPersistence()`, `MindmapManager()`, `MindmapController()`, `EventEmitter()`.
15. `internal/infra/application.go`:
    - construct `mindmapCtrl`; add to the `Bind: []interface{}{...}` slice; call `mindmapCtrl.OnStartup(ctx)` / `OnShutdown`.
    - call `eventEmitter.SetContext(ctx)` in `OnStartup`.
    - extend `quantmcp.NewQuantMCPServer(...)` call to pass `injector.MindmapManager()`.
16. `internal/integration/mcp/server.go` — add `mindmapManager` field to `QuantMCPServer`, accept it in `NewQuantMCPServer`, register the 4 tools + handlers, and add the `WithHTTPContextFunc` hook (§2) when building the streamable server so handlers can read `X-Quant-Session`.
17. `internal/integration/process/manager.go` (spawn, ~line 167) — set `QUANT_SESSION_ID=<sessionID>` on the spawned `exec.Cmd` env.
18. `internal/infra/application.go` (~line 130) — add `"headers": {"X-Quant-Session": "${QUANT_SESSION_ID}"}` to the global `quant` `~/.mcp.json` entry.
19. **Session cleanup** — in the session-delete/archive service, delete `mindmap_nodes WHERE scope_type='session' AND scope_id = ?`. (Polymorphic `scope_id` can't use an FK cascade to `sessions`, so clean explicitly. `DeleteSession` is at `internal/integration/persistence/session.go:159`.)
20. **Validation** in `mindmapManagerService.SetNode`: reject unknown `status`, clamp `progress` to 0–100, ignore a `parentId` that doesn't exist or would create a cycle (mindmap = tree; dagre needs a DAG).

## 6. Live updates — the event emitter

The MCP path does **not** flow through a Wails controller, and services don't hold the Wails `ctx`. But `EventsEmit` needs it. The existing `processManager` solves this with `SetContext(ctx)` and emits `session:output`. We mirror that with a tiny shared emitter:

**New file** `internal/integration/events/emitter.go`:
```go
type Emitter struct{ ctx context.Context }
func (e *Emitter) SetContext(ctx context.Context) { e.ctx = ctx }
func (e *Emitter) Emit(name string, payload any) {
    if e.ctx != nil { wailsRuntime.EventsEmit(e.ctx, name, payload) }
}
```
- Singleton in the injector, injected into `mindmapManagerService`.
- `SetContext` called from `application.go` `OnStartup`.
- After every mutation, the service emits a **full snapshot** (mindmaps are small — simplest, idempotent):
  ```go
  emitter.Emit("mindmap:updated", map[string]any{"sessionId": sid, "nodes": nodes})
  ```

**Live-update quality details** (the difference between calm and janky):
- **Full snapshot, not patches** — switch to per-node patches only if maps ever get huge.
- **Relayout only on topology change** — re-run dagre when a node is added/removed; status/note/progress-only updates just patch node data in place so nothing jumps.
- **Coalesce emits (~100ms)** — an agent may fire many `set_node` calls in a burst; debounce on the service side to avoid relayout thrash.
- Frontend subscribes via `EventsOn("mindmap:updated")`, filters by `sessionId`, updates state → React Flow diffs per-node and **preserves pan/zoom**. Hydrate once via `getMindmap(sessionId)` on open; ~3s poll as a missed-event safety net.

## 7. Frontend changes

Deps to add (sit fine alongside React 18 / Tailwind 4):
```
@xyflow/react@^12   dagre@^0.8   -D @types/dagre
```

**Placement (DECIDED): a toggleable side pane inside the session**, reusing `SessionPanel`'s existing split layout — *not* a top-level view. The mindmap shows the active session's map next to its terminal.

**New file** `frontend/src/components/MindmapPane.tsx`:
- Port the prototype's `StatusNode` + `NoteNode` components and `layout()` (dagre LR) — fed by real data instead of the simulated `TIMELINE`.
- Props: `sessionId`. Hydrates via `getMindmap(sessionId)`, then lives off the `mindmap:updated` event.
- **Empty/loading state**: before the agent has drawn anything, show a muted placeholder ("No mindmap yet — the agent will draw here as it works") rather than a blank canvas.
- Wrap in `<ReactFlowProvider>`. Use `fitView`, `Background`, `Controls`.
- Theme: already done — every color is a `var(--q-*)` token + `color-mix` (see the prototype), so it inherits the user's quant theme automatically. No per-theme code.

**Edited files** (insertion points from the trace):
- `frontend/src/components/SessionPanel.tsx`:
  - add a "mindmap" toggle button next to the existing embedded-terminal toggle (~line 208-228) and render `<MindmapPane sessionId={session.id} />` as the secondary pane in the existing split layout (~line 333-444).
- `frontend/src/App.tsx`: add the `EventsOn("mindmap:updated", …)` subscription (copy the `session:output` effect at ~line 556, with `cancel()` cleanup); route payloads to the active `MindmapPane` by `sessionId`.
- `frontend/src/api.ts`: `export function getMindmap(sessionId: string): Promise<MindmapNode[]> { return callGo(PKG, "mindmapController", "GetMindmap", sessionId); }` + a `MindmapNode` type in `types.ts`.
- `wailsjs/go/controller/mindmapController.{js,d.ts}`: generated by `wails generate module` (committed to git, like the others).

## 7b. Agent adoption (the make-or-break)

Building the tools isn't enough — the agent has to *choose* to draw. Three levers:

1. **Tool descriptions** — write `mindmap_set_node`'s description to actively invite use: "Use this throughout a task to show the user a live mindmap of what you're building. Add a node per component/step, set status as you progress (planned→in_progress→done/blocked), attach notes for decisions." Good descriptions are the cheapest, highest-leverage adoption driver.
2. **System-prompt guidance** — quant builds agent system prompts (see `get_agent_system_prompt` / the prompt builder in `mcp/server.go`). Add an opt-in instruction so agents in a session keep the mindmap updated. Consider a per-agent toggle (`drawMindmap: bool`) so it's not forced on every agent.
3. **A skill** (optional) — a `/mindmap` skill or a short reusable instruction block that teaches the pattern, for users who want it on demand.

Without at least #1 and #2, the feature ships but stays empty. This section should be treated as in-scope, not a follow-up.

## 7c. Work items

PR-sized, dependency-ordered. Each is independently reviewable; "verify" = its acceptance check.

### Phase 0 — De-risk (do first)
- **WI-00 · Spike: per-session header reaches the server.** Set `QUANT_SESSION_ID` on a spawned session, add `headers:{X-Quant-Session:"${QUANT_SESSION_ID}"}` to the global `~/.mcp.json` quant entry, register a throwaway `WithHTTPContextFunc` that logs `r.Header`. *Depends:* none. *Verify:* the correct session id appears in the server log per tool call. Unblocks all session-scope work.

### Phase 1 — Backend slice (agent can draw; no UI)
- **WI-01 · Entity + migration.** `entity/mindmap_node.go` + `CREATE TABLE mindmap_nodes` in `sqlite.go`. *Depends:* none. *Verify:* table exists on startup; `go build`.
- **WI-02 · Persistence.** `persistence/mindmap_node.go` (upsert/delete/clear/list-by-scope) + `dto/mindmap_node.go` + `adapter/mindmap_persistence.go`. *Depends:* WI-01. *Verify:* unit test CRUD round-trips, scope isolation holds.
- **WI-03 · Usecases + service + validation.** usecase interfaces, `service/mindmap_manager.go` (`SetNode/RemoveNode/ClearMindmap/GetMindmap`), `adapter/mindmap_manager.go`. Validation: status enum, progress clamp 0–100, parent existence + cycle guard. *Depends:* WI-02. *Verify:* service unit tests incl. rejects bad status / cyclic parent.
- **WI-04 · DI wiring.** injector singletons (`MindmapPersistence/Manager`), no controller yet. *Depends:* WI-03. *Verify:* `go build`, app boots.
- **WI-05 · MCP tools + session context.** Register `mindmap_set_node/remove_node/clear/get` + handlers in `mcp/server.go`; add `mindmapManager` to `NewQuantMCPServer`; add `WithHTTPContextFunc` + `sessionKey` read; spawn env (`manager.go`) + `~/.mcp.json` header (`application.go`). *Depends:* WI-03, WI-04, WI-00. *Verify:* from a live session, `mindmap_set_node` then `mindmap_get` returns the node scoped to that session; a second session sees its own.
- **WI-06 · Session-delete cleanup.** Delete `mindmap_nodes WHERE scope_type='session' AND scope_id=?` in the session-delete/archive path. *Depends:* WI-02. *Verify:* deleting a session removes its nodes.

### Phase 2 — UI pane (read + poll)
- **WI-07 · Frontend deps + read binding.** `npm i @xyflow/react dagre -D @types/dagre`; `controller/mindmap.go` (`GetMindmap(sessionID)`) + adapter iface + entrypoint DTO; Bind in `application.go`; `wails generate module`; `api.ts` `getMindmap` + `MindmapNode` type. *Depends:* WI-03. *Verify:* `getMindmap(id)` returns nodes from the frontend.
- **WI-08 · MindmapPane component.** Port `StatusNode`/`NoteNode`/`layout()` from the prototype; empty state; `var(--q-*)` theming; hydrate via `getMindmap`. *Depends:* WI-07. *Verify:* renders a session's map from real data; looks right in both builtin themes.
- **WI-09 · SessionPanel integration.** Toggle button + render `<MindmapPane>` as the secondary pane in the existing split layout. *Depends:* WI-08. *Verify:* toggle shows/hides the pane next to the terminal for the active session.

### Phase 3 — Live updates
- **WI-10 · Event emitter (backend).** `events/emitter.go` + injector singleton + `SetContext` in `application.go` OnStartup; inject into service; emit `mindmap:updated` snapshot per mutation, debounced ~100ms. *Depends:* WI-04. *Verify:* mutations emit the event with `{sessionId, nodes}`.
- **WI-11 · Live subscription (frontend).** `EventsOn("mindmap:updated")` filtered by sessionId; relayout only on topology change; preserve pan/zoom; keep ~3s poll fallback. *Depends:* WI-09, WI-10. *Verify:* drawing from the agent updates the pane live without losing viewport.

### Phase 4 — Adoption (don't skip — §7b)
- **WI-12 · Tool descriptions.** Make `mindmap_*` descriptions actively invite use. *Depends:* WI-05. *Verify:* descriptions read as usage guidance.
- **WI-13 · System-prompt guidance + per-agent toggle.** Inject "keep the mindmap updated" guidance via the agent prompt builder; `drawMindmap` toggle. *Depends:* WI-05; **product decisions** (auto-draw aggressiveness, per-agent opt-in). *Verify:* a fresh agent spontaneously draws during a task.
- **WI-14 · (optional) `/mindmap` skill.** On-demand instruction block. *Depends:* WI-05.

**Critical path:** WI-00 → 01 → 02 → 03 → 05 (agent can draw) → 07 → 08 → 09 (visible) → 10 → 11 (live). WI-06/12/13 parallelizable once their deps land.

## 8. Build / generate / run

```
# backend types → frontend bindings
wails generate module
# frontend deps
cd frontend && npm i @xyflow/react dagre && npm i -D @types/dagre
# run the app (do NOT kill a running quant.app — see project memory)
wails dev
```

## 9. Testing

- Go: unit-test `mindmapManagerService` (upsert stamps timestamps; clear empties; get returns workspace-scoped) with a fake persistence, per existing service tests.
- Manual: from a Claude session call `mindmap_set_node` a few times and watch the Mindmap view update live; verify status colors, note, progress, and that `mindmap_clear` resets it.

## 10. Phasing suggestion

- **Phase 1 (backend slice):** entity + table + persistence + service + the 4 MCP tools + `mindmap_get`. Verify via MCP without any UI (read back with `mindmap_get`).
- **Phase 2 (UI):** `MindmapView` + view wiring + polling read.
- **Phase 3 (live):** event emitter + `mindmap:updated` subscription.

## 11. Decisions log

- **Authoring:** structured JSON + React Flow v12 + dagre. ✅
- **Scope:** per-session, via `${QUANT_SESSION_ID}`-expanded `X-Quant-Session` header + `WithHTTPContextFunc` (workspace fallback). ✅ (mechanism verified against Claude Code MCP config behavior)
- **Display:** toggleable side pane in `SessionPanel`, live via `mindmap:updated`. ✅
- **Theme:** `var(--q-*)` tokens only — inherits the active quant theme. ✅
- **Agent adoption:** in scope — tool descriptions + system-prompt guidance (§7b). ✅
- **Robustness:** session-delete cleanup + input validation specified (§5 items 19-20). ✅

No open blockers. Ready to build (suggest Phase 1 backend slice first, §10).

### One thing to validate during Phase 1 (not a blocker)
Confirm `${QUANT_SESSION_ID}` expands inside `headers` for an **http** server in the installed Claude Code version (behavior is documented but version-dependent). Cheap to test: set the env, add the header, log `r.Header` in `WithHTTPContextFunc`. If it ever regresses, the fallback is a per-session `--mcp-config` using a **distinct** server name (e.g. `quant-session`) to avoid the global-name collision.

---

## 12. Iteration 1 — built & validated ✅ (2026-05-30)

Iteration 1 (§§1–11) is **implemented in the `feat/mindmap` worktree and validated E2E** via `wails dev` + Playwright:
- MCP `initialize` → `mindmap_set_node`×13 (with `X-Quant-Session` header) → `mindmap_get` returns all 13, correctly scoped; a different session id returns 0 (scope isolation). `~/.mcp.json` carried the `${QUANT_SESSION_ID}` header (mechanism confirmed). The Wails binding `GetMindmap` and the live `mindmap:updated` event both work; deleting a session cascaded its nodes (WI-06).

**Post-validation fixes applied (user feedback):**
- **F1 — status colours:** `in_progress` now uses `--q-blue` (not `--q-cyan`); in Solarized themes `--q-cyan == --q-accent`, which made "building" and "done" both green. Now distinct in every theme.
- **F2 — overlap:** layout now uses **measured DOM node sizes** (two-pass: estimate → measure via `useNodesInitialized`/`getNodes().measured` → re-layout), so rows never collide. Also enables drag persistence (`useNodesState`/`onNodesChange`).
- **F3 — pane persistence:** mindmap-pane open/closed is a sticky preference (`localStorage` `quant.mindmapPaneOpen`); no longer reset on session-tab switch.
- **F4 — straight notes:** removed the `rotate(-1deg)` on sticky notes; added `overflow-wrap:anywhere` to titles/notes so long paths/URLs wrap instead of spilling.

## 13. Iteration 2 — boards, user authoring, simultaneous panes

Driven by user feedback after the live demo. **Folded into the same PR.** Decisions: multiple mindmaps per session = **named boards + switcher** (board is a string dimension; the agent targets it via an optional `board` MCP param, default `"default"`); the **user can author the mindmap** from the UI (add/edit/delete nodes & notes, connect parents), not just the agent; **terminal + mindmap must be visible simultaneously**.

### Phase 5 — backend: board dimension + write/list controller
- **WI-15 · Board dimension threaded through all layers.**
  - `entity.MindmapNode` += `Board string`; `dto.MindmapNodeRow` += `Board`; `dto.MindmapNodeResponse` += `board` json tag.
  - Usecase ifaces gain board: `FindMindmapNodesByScope(scopeType, scopeID, board)`, `FindMindmapNodeByID(scopeType, scopeID, board, id)`, `DeleteMindmapNode(..., board, id)`, `DeleteMindmapSubtree(..., board, id)`, `ClearMindmap(scopeType, scopeID, board)`. `SaveMindmapNode(node)` unchanged (board on entity). Add `DistinctBoards(scopeType, scopeID) ([]string, error)`.
  - `adapter.MindmapManager`: `SetNode(scopeType, scopeID, board, node)`, `RemoveNode(scopeType, scopeID, board, id, subtree)`, `ClearMindmap(scopeType, scopeID, board)`, `GetMindmap(scopeType, scopeID, board)`, `ListBoards(scopeType, scopeID)`.
  - Service threads board into validation/persistence/`emitSnapshot(scopeType, scopeID, board)`; emit payload gains `"board"`.
  - Persistence: column `board`; all WHERE clauses `AND board = ?`; INSERT includes board; subtree-delete scoped to board; add `DistinctBoards` (`SELECT DISTINCT board ... ORDER BY board`).
  - **Migration (`sqlite.go`):** current PK is `(scope_type, scope_id, id)`; board must enter the PK so the same node id can exist on different boards. SQLite can't `ALTER` a PK, so do a guarded **table rebuild** (only when the `board` column is absent — check `PRAGMA table_info`): create `mindmap_nodes_new(... board TEXT NOT NULL DEFAULT 'default' ..., PRIMARY KEY(scope_type, scope_id, board, id))` → `INSERT ... SELECT *, 'default'` → `DROP` old → `RENAME`. **Preserves existing rows under `'default'`** (don't drop — the user has live data). Fresh installs get the new `CREATE` directly.
  - *Verify:* `go build ./internal/...`; existing nodes survive under `default`; two boards can hold the same node id.
- **WI-16 · MCP tools board param.** Add optional `board` (string, default `"default"`) to `mindmap_set_node/remove_node/clear/get`; handlers read it (`stringArg`, default `"default"`) and pass through. Update descriptions to explain boards ("use a board per topic/workstream; default board if unsure"). *Verify:* set on board "a" then `get` board "b" empty; board "a" returns the node.
- **WI-17 · Controller write + list (UI authoring path).** Add `dto.MindmapNodeRequest` (`id,parentId,kind,label,text,status,note,progress,board`). Controller gains `SetMindmapNode(sessionID, board, req)`, `RemoveMindmapNode(sessionID, board, id, subtree)`, `ClearMindmap(sessionID, board)`, `ListBoards(sessionID)`, and `GetMindmap(sessionID, board)` (board param added; default when ""). All route to the existing `MindmapManager` with `scopeType="session"`. Update `adapter.MindmapController` iface. *Verify:* `go build`; bindings regenerate.

### Phase 6 — frontend: simultaneous panes
- **WI-18 · Terminal + mindmap at once.** Refactor `SessionPanel` so the mindmap is its own region, not sharing the terminal's secondary slot. Approach: keep the existing primary/terminal `SplitContainer`; when `showMindmap`, wrap it in an **outer** `SplitContainer` whose secondary pane is the mindmap (layout = `[ primary (+optional terminal split) | mindmap ]`). Decouple `showMindmap` from `secondaryOpen`. Independent divider; default vertical (mindmap on the right). *Verify:* terminal split AND mindmap visible together; no overlap; both dividers resize; existing terminal behaviour intact.

### Phase 7 — frontend: boards + user authoring
- **WI-19 · Board switcher.** `wails generate module` first. `MindmapPane` props += `board`. Header gets a board dropdown (reuse `CustomSelect`) + "＋ new board" + rename. Active board persisted per session (`localStorage` `quant.mindmapBoard.<sessionId>`, default `"default"`). `getMindmap(sessionId, board)`; filter `mindmap:updated` by `sessionId` **and** `board`; `listBoards(sessionId)` populates the dropdown (union with active/just-created). *Verify:* switching boards shows different maps; agent drawing on board X only updates board X.
- **WI-20 · User authoring.** `api.ts` += `setMindmapNode/removeMindmapNode/clearMindmap/listBoards`. In `MindmapPane`:
  - Toolbar "＋ node" / "＋ note" → edit form (reuse modal + `AdvancedInput`/`AdvancedSelect`: label, status, note, progress, kind, parent). Client-mint ids via `crypto.randomUUID()`.
  - Right-click node → `ContextMenu` (edit / delete / add-child); attach `onContextMenu` in `StatusNode`/`NoteNode`.
  - Enable `nodesConnectable`; `onConnect` sets the target's `parentId` (single-parent: drop an existing edge to that target); `onReconnect` re-parents; `onNodesDelete`/`onEdgesDelete` persist. Wrap inputs in `nodrag`.
  - **Co-authoring reconciliation (critical):** on a snapshot event, **merge by id** instead of replacing — preserve `measured`/`selected`/`dragging`, keep label while a node is in `editingIds`, keep user position when `data.pinned` (set on `onNodeDragStop`); agent owns status/progress/structure. Persist on commit/connect/drag-stop/delete (not per keystroke). Hybrid dagre: re-layout on structural change only, never reposition pinned nodes.
  - *Verify:* user creates/edits/deletes nodes & notes and connects them; edits survive a concurrent agent snapshot; changes persist across reload.
- **WI-21 · Re-validate E2E + screenshots + agent board guidance.** Update tool/system-prompt guidance to mention boards. Re-run `wails dev` + Playwright (seed via MCP on two boards; author a node from the UI; confirm simultaneous terminal+mindmap). Capture screenshots.

**Critical path (it. 2):** WI-15 → 16 → 17 → (18 ∥ 19) → 20 → 21. WI-18 is frontend-only and can land in parallel with 16/17.
