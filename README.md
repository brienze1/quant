<p align="center">
    <img src="https://capsule-render.vercel.app/api?type=waving&color=0ABAB5&height=260&section=header&text=%3E_%20quant&fontSize=90&animation=fadeIn&fontAlignY=38&desc=Claude%20Code%20Session%20Manager&descAlignY=56&descAlign=50">
</p>

<p align="center">
  <a href="#-product">Product</a>&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
  <a href="#-stack">Stack</a>&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
  <a href="#-objective">Objective</a>&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
  <a href="#-structure">Structure</a>&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
  <a href="#-installation">Installation</a>
</p>

<p align="center">
<a href="https://github.com/brienze1/quant"><img alt="GitHub" src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white"></a>
<a href="https://go.dev"><img alt="Go" src="https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=Go&logoColor=blue"></a>
<a href="https://wails.io"><img alt="Wails" src="https://img.shields.io/badge/Wails-DF0000?style=for-the-badge&logo=go&logoColor=white"></a>
<a href="https://react.dev"><img alt="React" src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB"></a>
<a href="https://www.typescriptlang.org"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white"></a>
<a href="https://tailwindcss.com"><img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white"></a>
<a href="https://www.sqlite.org"><img alt="SQLite" src="https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white"></a>
</p>

## 💻 Product

Quant is a native desktop application for managing [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions and development workflows. It provides a full GUI for organizing repositories, tasks, and interactive Claude Code sessions with integrated terminal emulation, allowing developers to run and manage multiple concurrent coding sessions from a single interface.

### Features

- **Session Management** — Create, start, resume, stop and pause Claude Code sessions with real-time terminal output via xterm.js
- **Repository Tracking** — Register and manage multiple Git repositories from one place
- **Task Organization** — Group sessions into tasks with tagging, archiving and drag-and-drop reordering
- **Git Worktree Support** — Optionally spin up isolated worktrees per session for parallel development
- **Action Logging** — Track all Claude interactions (reads, edits, creates, bash commands) per session
- **Configurable** — Customize git behavior, terminal appearance, Claude CLI args, session defaults and more

## ⚙ Stack

|                                        |                    Technologies                     |                                                           |
|:--------------------------------------:|:---------------------------------------------------:|:---------------------------------------------------------:|
|       [Go 1.26](https://go.dev/)       |   [React 18](https://react.dev/)                    |   [TypeScript](https://www.typescriptlang.org/)           |
|   [Wails v2](https://wails.io/)        |   [Tailwind CSS 4](https://tailwindcss.com/)        |   [xterm.js v5](https://xtermjs.org/)                     |
|   [SQLite 3](https://www.sqlite.org/)  |   [Vite](https://vite.dev/)                         |   [creack/pty](https://github.com/creack/pty)             |

## 🎯 Objective

To provide a streamlined, native desktop experience for managing Claude Code sessions across multiple projects — replacing the need to juggle terminal windows, track conversation IDs, and manually organize coding workflows.

## 🌌 Structure

```
quant/
├── main.go                     # Entry point; embeds frontend/dist
├── wails.json                  # Wails build configuration
├── internal/
│   ├── domain/                 # Business entities & enums
│   │   ├── entity/             # Session, Task, Repo, Action, Config
│   │   └── enums/              # SessionStatus, ActionType
│   ├── application/            # Business logic
│   │   ├── service/            # SessionManager, RepoManager, TaskManager, etc.
│   │   ├── adapter/            # Interface definitions
│   │   └── usecase/            # Use case orchestrators
│   ├── integration/            # External systems & adapters
│   │   ├── entrypoint/         # API controllers & DTOs
│   │   ├── persistence/        # SQLite operations & DTOs
│   │   ├── process/            # PTY / process manager
│   │   └── worktree/           # Git worktree manager
│   └── infra/                  # Bootstrap & configuration
│       ├── application.go      # Wails app setup
│       ├── db/                 # SQLite connection & migrations
│       └── dependency/         # Dependency injection
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Main app component
│   │   ├── api.ts              # Wails Go binding wrappers
│   │   ├── types.ts            # TypeScript interfaces
│   │   └── components/         # React components
│   └── wailsjs/                # Generated Wails bindings
└── build/
    ├── darwin/                 # macOS build assets
    └── windows/                # Windows build assets
```

## ⏩ Installation

### Prerequisites

- **Go 1.26+**
    - [Install Go](https://go.dev/doc/install)
- **Node.js** (latest LTS recommended)
    - [Install Node.js](https://nodejs.org/)
- **Wails v2 CLI**
    ```bash
    go install github.com/wailsapp/wails/v2/cmd/wails@latest
    ```

### Development

Run in live development mode with hot reload:

```bash
wails dev
```

This starts a Vite dev server for the frontend and a Go backend server at `http://localhost:34115`.

### Building

Build a redistributable production binary:

```bash
wails build
```

The output binary will be located at `build/bin/quant`.

### Running

After building, run the application directly:

```bash
./build/bin/quant
```

On macOS, the app can also be found as `build/bin/quant.app`.

### Data Storage

Quant stores its data at `~/.quant/quant.db` (SQLite with WAL journal mode).
