<p align="center">
    <img src="https://capsule-render.vercel.app/api?type=waving&color=0ABAB5&height=260&section=header&text=%3E_%20quant&fontSize=90&animation=fadeIn&fontAlignY=38&desc=Claude%20Code%20Session%20Orchestrator&descAlignY=56&descAlign=50">
</p>

<p align="center">
  <a href="#-what-is-quant">What is Quant</a>&nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="#-features">Features</a>&nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="#-install-with-homebrew">Install</a>&nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="#-updating">Update</a>&nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="#-build-from-source">Build</a>&nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="#-configuration">Configuration</a>&nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="#-stack">Stack</a>
</p>

<p align="center">
<a href="https://github.com/brienze1/quant/releases"><img alt="Release" src="https://img.shields.io/github/v/release/brienze1/quant?style=for-the-badge&color=0ABAB5&label=release"></a>
<a href="https://go.dev"><img alt="Go" src="https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=Go&logoColor=white"></a>
<a href="https://wails.io"><img alt="Wails" src="https://img.shields.io/badge/Wails-DF0000?style=for-the-badge&logo=go&logoColor=white"></a>
<a href="https://react.dev"><img alt="React" src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB"></a>
<a href="https://www.typescriptlang.org"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white"></a>
<a href="https://www.sqlite.org"><img alt="SQLite" src="https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white"></a>
</p>

## 💻 What is Quant

> **multiple agents. one dashboard. zero chaos.**

**Quant** is a native desktop app that turns [Claude Code](https://docs.anthropic.com/en/docs/claude-code) from a single terminal window into a full **agent orchestrator**. Organize your work as **repos → tasks → sessions**, run many live Claude Code agents in parallel, and dock the tools each one needs around it: a file explorer and code editor, a git diff/commit surface, a live mindmap the agent draws its plan on, and a hands‑free voice conversation. Two higher‑order surfaces automate whole fleets — a **Jobs** workflow engine (scheduled/triggered pipelines with human‑in‑the‑loop) and reusable **Agent** personas. Everything is workspace‑scoped, deeply themeable, keyboard‑driven, and reachable from any **browser** over a secure tunnel.

Quant is built with **Go + [Wails v2](https://wails.io/)** (React/TypeScript frontend), stores its data locally in SQLite, and — including voice — runs **fully on your machine**.

## ✨ Features

### Sessions & organization
- **Multi‑session orchestration** — create, start, resume, restart, stop and pause Claude Code sessions, each a live terminal (xterm.js) with real‑time output.
- **Repo → Task → Session tree** — register Git repositories, group work into tagged tasks, drag‑and‑drop reorder, archive/unarchive.
- **Workspaces** — isolate repos, sessions, jobs and agents into separate contexts; switch with `Ctrl+1..9`. Each workspace can point at its own `.claude` / `.mcp.json`.
- **Git worktrees** — optionally spin up an isolated worktree per session for conflict‑free parallel development.
- **Adopt external sessions** — pull terminal‑born Claude conversations into Quant, or re‑point a session to a different Claude conversation id.
- **Tabs** — sessions and open files share one scrollable tab bar; `Cmd+]`/`Cmd+[` to cycle, `Cmd+1..9` to jump, `Cmd+W` to close.

### Files & code
- **File explorer + editor** — VSCode‑style per‑session file tree, CodeMirror editor with 100+ languages, unsaved‑changes guard, live file‑change updates.
- **Rich viewers** — rendered Markdown (GFM + live **Mermaid** diagrams), sandboxed HTML preview, zoomable images, SVG preview/source toggle.
- **Agent‑driven reveal** — an agent can open any file in the UI via the `files_open` MCP tool.

### Git
- **Full‑screen diff view** — side‑by‑side before/after with char‑level highlights and a change‑map strip, per‑file staging, commit message with prefix and “push after commit.”
- **Commit / pull / push** dialogs available straight from a session's context menu.

### Live mindmap
- **Per‑session board** that both the **agent and you** draw on (React Flow + dagre) — status nodes (`planned` → `in_progress` → `done` / `blocked`, with progress bars) and sticky notes.
- Named, multiple boards per session; agents can read and draw on other sessions' boards over MCP for orchestrator patterns.

### Voice — local & private
- **Hands‑free conversation** — local **Whisper (STT)** + **Kokoro (TTS)** via embedded sherpa‑onnx (no Python, no cloud). Audio‑reactive WebGL orb with idle/listening/thinking/speaking states, live transcript, turn‑taking, barge‑in, per‑language config (EN/PT) and sound cues.
- **Push‑to‑talk dictation** — hold `Cmd+Shift+Space` (or toggle `Cmd+Shift+V`) to stream speech into the session input; never auto‑submits.
- **Agent voice tools** — `voice_listen`, `voice_speak`, `voice_converse` over MCP.

### Automation & agents
- **Jobs** — a DAG canvas of scheduled/triggered jobs (Claude session or bash script) wired by success/failure edges, with typed input/output contracts, triage prompts for **human‑in‑the‑loop** waiting states, run history, tokens/duration, and pipeline executions.
- **Agents** — reusable personas (role, goal, model, color) with MCP‑server access, environment variables, boundary rules and enabled skills — visualized in a playful pixel‑art “office.”

### Crew orchestration
- **Supervisor / worker crews** — dispatch long‑running work to worker sessions that report back to a supervisor automatically, with watchdogs and an auto‑injected inbox.

### Cross‑cutting
- **Remote / browser access** — reach the full app from any browser via a Cloudflare quick tunnel + passcode, with cross‑client state sync.
- **Command palette** (`Cmd+K`), **theme quick‑picker** (`Cmd+Shift+T`), fully **rebindable keybindings**, and deep theming (CSS‑variable system, dark/light/high‑contrast, **import any VS Code theme**).
- **Native notifications** when a session finishes while you're looking elsewhere.

## ⏬ Install with Homebrew

Quant ships as a Homebrew formula from the [`brienze1/tap`](https://github.com/brienze1/homebrew-tap) tap. Tap it once, then install:

```bash
brew tap brienze1/tap
brew install quant
```

Or in a single command:

```bash
brew install brienze1/tap/quant
```

Then launch the app:

```bash
quant
```

> **Requires** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to be installed and authenticated — Quant drives the `claude` CLI. Some optional features have extra prerequisites (e.g. `cloudflared` for remote browser access); Quant checks for these and links install instructions in‑app.

## 🔄 Updating

Homebrew handles upgrades. To update Quant to the latest release:

```bash
brew update
brew upgrade quant
```

To see the installed version, click the version badge in the Quant sidebar (opens the changelog), or run `brew info quant`.

### Uninstalling

```bash
brew uninstall quant
```

## 🛠 Build from Source

### Prerequisites
- **[Go 1.26+](https://go.dev/doc/install)**
- **[Node.js](https://nodejs.org/)** (latest LTS)
- **[Wails v2 CLI](https://wails.io/docs/gettingstarted/installation)**
  ```bash
  go install github.com/wailsapp/wails/v2/cmd/wails@latest
  ```

### Develop (hot reload)
```bash
wails dev        # or: make dev
```
Starts a Vite dev server for the frontend and the Go backend (dev URL `http://localhost:34115`).

> **macOS note:** avoid running `wails dev` from inside `~/Documents` — it can trip macOS TCC file‑access protections. Prefer a directory outside `~/Documents`.

### Build a production binary
```bash
wails build      # or: make build
```
The bundle is written to `build/bin/quant` (and `build/bin/quant.app` on macOS).

### Test
```bash
make test        # go test -race ./...
```

## ⚙️ Configuration

- **Data** — SQLite database at `~/.quant/quant.db` (WAL mode). App configuration lives in `~/.quant/config.json` (voice, persona, model defaults, etc.).
- **In‑app settings** — a tabbed Settings panel covers: general, keybindings, themes, git & branches, sessions/worktrees, storage & data (relocate data / worktree / log dirs), terminal appearance, Claude CLI command + args + agent persona, voice (Whisper/Kokoro install, VAD, barge‑in, per‑language voices), and remote access.
- **Environment variables** (advanced):
  - `QUANT_HOME` — override the `~/.quant` config/data root (useful for running a second isolated instance).
  - `QUANT_SKIP_MCP_INJECT=1` — skip Quant's MCP injection into sessions.

## ⚙ Stack

|                                        |                    Technologies                     |                                                           |
|:--------------------------------------:|:---------------------------------------------------:|:---------------------------------------------------------:|
|       [Go 1.26](https://go.dev/)       |   [React 18](https://react.dev/)                    |   [TypeScript](https://www.typescriptlang.org/)           |
|   [Wails v2](https://wails.io/)        |   [Tailwind CSS 4](https://tailwindcss.com/)        |   [xterm.js v5](https://xtermjs.org/)                     |
|   [SQLite 3](https://www.sqlite.org/)  |   [Vite](https://vite.dev/)                         |   [creack/pty](https://github.com/creack/pty)             |

## 🌌 Project Structure

```
quant/
├── main.go            # Entry point; embeds frontend/dist
├── wails.json         # Wails build configuration
├── Makefile           # dev / build / test / release helpers
├── internal/
│   ├── domain/        # Business entities & enums
│   ├── application/   # Services, adapters, use cases
│   ├── integration/   # Controllers, SQLite, PTY, worktree, MCP
│   └── infra/         # Bootstrap, DB, dependency injection
├── frontend/          # React + TypeScript UI (Vite)
├── scripts/           # macOS dylib fixup, Windows packaging, changelog
└── build/             # Platform build assets (darwin / windows)
```

## 📦 Requirements

- **macOS** and **Windows** are supported (Homebrew install is macOS/Linux). The codebase is kept cross‑platform.
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** installed and authenticated.

## 📄 License

See [LICENSE](LICENSE).
