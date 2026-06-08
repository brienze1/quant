# Quant Local Voice Mode — Setup & Onboarding Plan

> Goal: make quant's **LOCAL-ONLY** voice mode (local Whisper STT + local Kokoro TTS) easy for a brand-new user to set up, across macOS, Windows, and Linux.

## Guiding Constraints

| Constraint | What it means |
| --- | --- |
| **Local-only** | Local Whisper (STT) + local Kokoro (TTS). Never steer users to OpenAI/cloud. |
| **Cross-platform** | macOS (Apple Silicon + Intel), Windows, Linux must all be supported. |
| **No auto-download** | The app must **not** auto-download binaries or models. It **links** to official guides, **shows** copy-paste commands, and **tests** connections. |
| **No data-model change** | quant's Go `VoiceConfig` already supports separate STT and TTS base URLs. This is a **UX/onboarding** effort, not a schema change. |

Existing `VoiceConfig` fields (already present): `sttBaseUrl`, `ttsBaseUrl`, `baseUrl` (legacy), `sttModel`, `ttsModel`, `voice`, `speed`, `provider`.

---

## Recommended Stack at a Glance

| Component | Default choice | Base URL | Why |
| --- | --- | --- | --- |
| **STT** | whisper.cpp `whisper-server` | `http://localhost:2022/v1` | Single native binary, no Docker, Metal/CUDA accel, prebuilt Windows .exe |
| **TTS** | Kokoro-FastAPI (CPU Docker image) | `http://localhost:8880/v1` | Model weights baked into image, standard `/v1` path, all-platform CPU image |

Secondary STT option: **Speaches** (Docker, faster-whisper backend) at `http://localhost:8000/v1`.

---

# STT — Whisper (whisper.cpp)

**Default engine:** whisper.cpp `whisper-server` — a single native binary with no Docker dependency. Apple-Silicon builds get Metal acceleration; there is an official prebuilt Windows `.exe`; Linux is a one-line CMake build.

- **Base URL:** `http://localhost:2022/v1`
- **Critical flag:** must be launched with `--inference-path "/v1/audio/transcriptions"`. Without it, the server only serves `/inference` and quant gets a **404**.
- **Recommended models:** `small.en` (English) or `base.en` (low-end / CPU machines).
- **Repo:** https://github.com/ggml-org/whisper.cpp
- **Guide matching quant defaults:** https://voice-mode.readthedocs.io/en/stable/whisper.cpp/

### Secondary: Speaches

- faster-whisper backend, Docker, port `8000`, base `http://localhost:8000/v1`.
- CUDA / CPU support; **no Mac GPU acceleration**.
- Docs: https://speaches.ai/installation/

## Per-OS Install (whisper.cpp)

### macOS (Apple Silicon + Intel)

```bash
xcode-select --install
brew install cmake
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build
cmake --build build -j
# download a ggml model (e.g. small.en) into ./models, then run:
./build/bin/whisper-server \
  --model models/ggml-small.en.bin \
  --port 2022 \
  --inference-path "/v1/audio/transcriptions"
```

### Windows

1. Download the prebuilt `whisper-bin-x64.zip` from the releases page: https://github.com/ggml-org/whisper.cpp/releases
2. Install the **MSVC redistributable**.
3. Fetch a ggml model (e.g. `small.en`).
4. Run the server:

```bat
whisper-server.exe --model ggml-small.en.bin --port 2022 --inference-path "/v1/audio/transcriptions"
```

### Linux

```bash
sudo apt install build-essential cmake git
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build            # add -DGGML_CUDA=1 for NVIDIA GPUs
cmake --build build -j
# download a ggml model, then run:
./build/bin/whisper-server \
  --model models/ggml-small.en.bin \
  --port 2022 \
  --inference-path "/v1/audio/transcriptions"
```

## Verify STT

```bash
curl http://localhost:2022/v1/audio/transcriptions \
  -F file=@test.wav \
  -F model=whisper-1
# → {"text":"..."}
```

Then paste the base URL `http://localhost:2022/v1` into quant.

## STT Gotchas

| Symptom | Cause / fix |
| --- | --- |
| **404** on transcription | Missing `--inference-path` flag — server only serves `/inference`. |
| Port refused / in use | Port conflict on 2022 — remap and update the base URL. |
| Long first-run wait | Model download time (`small.en` ≈ 466 MB). |
| Very slow transcription | CPU-only machine — recommend `small`/`base` models on CPU. |
| Remote access concerns | whisper.cpp binds `127.0.0.1`. Fine for local desktop. Remote access must be **proxied server-side by quant**, never exposed publicly. |
| Mic enabled but engine down | Health-check the port **before** enabling the mic. |

---

# TTS — Kokoro (Kokoro-FastAPI)

**Default engine:** Kokoro-FastAPI (`remsky/Kokoro-FastAPI`) prebuilt **CPU Docker image** — model weights are baked into the image (no separate model download), and it exposes the standard `/v1` base path.

- **Base URL:** `http://localhost:8880/v1`
- **List voices:** `GET /v1/audio/voices`
- **Repo:** https://github.com/remsky/Kokoro-FastAPI
- **Voices reference:** https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md

### Available Images

| Image | Target |
| --- | --- |
| `ghcr.io/remsky/kokoro-fastapi-cpu:latest` | All platforms (CPU) |
| `ghcr.io/remsky/kokoro-fastapi-gpu:latest` | NVIDIA CUDA |
| `ghcr.io/remsky/kokoro-fastapi-gpu:...-cu128` | RTX 50-series |
| `ghcr.io/remsky/kokoro-fastapi-rocm:latest` | AMD / Linux |

> **Apple-Silicon MPS** acceleration is available only via the native `./start-gpu_mac.sh` script (needs `uv`), **not** via Docker. On Apple Silicon, use the **CPU image** under Docker.

## Per-OS Install (Kokoro-FastAPI)

### Step 1 — Install Docker (link, don't auto-install)

- macOS / Windows: **Docker Desktop** — https://www.docker.com/products/docker-desktop/
- Linux: **Docker Engine** — https://docs.docker.com/engine/install/
- Windows additionally requires the **WSL2 backend**.

### Step 2 — Run Kokoro

```bash
# CPU (all platforms, incl. Apple Silicon)
docker run -d --name kokoro \
  --restart unless-stopped \
  -p 8880:8880 \
  ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

```bash
# NVIDIA GPU
docker run -d --name kokoro \
  --restart unless-stopped \
  --gpus all \
  -p 8880:8880 \
  ghcr.io/remsky/kokoro-fastapi-gpu:latest
```

```bash
# AMD (ROCm) — add the appropriate --device flags for your setup
docker run -d --name kokoro \
  --restart unless-stopped \
  -p 8880:8880 \
  ghcr.io/remsky/kokoro-fastapi-rocm:latest
```

## Voices

Naming pattern: `[lang][gender]_[name]`. English families:

| Prefix | Family |
| --- | --- |
| `af_` | American female |
| `am_` | American male |
| `bf_` | British female |
| `bm_` | British male |

Common voices: `af_heart` (default), `am_onyx`, `af_bella`, `bf_emma`, `bm_george`.

> **Voice mixing:** kokoro-fastapi supports mixing via `"af_bella+af_sky"` syntax. This is **kokoro-fastapi-specific and not portable** — treat it as an advanced extra, not a baseline feature.

## Verify TTS

```bash
curl -X POST http://localhost:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input":"Hello from quant","voice":"af_heart","response_format":"mp3"}' \
  --output output.mp3
# then play output.mp3
```

Paste the base URL `http://localhost:8880/v1` into quant. The API key can be **any placeholder**.

## TTS Gotchas

| Symptom | Cause / fix |
| --- | --- |
| Port 8880 busy | Remap (`-p 9880:8880`) and update the base URL. |
| Slow first synthesis | Model warmup — **warn, don't time out**. Set TTS request timeout ≥ 30s. |
| Connection refused | **Most common failure: Docker not running.** Detect connection-refused, link the install guide. |
| Apple-Silicon GPU image fails | Must use the **CPU image** under Docker on Apple Silicon. |
| Lost after reboot | Add `--restart unless-stopped` so the container survives reboots. |

---

# In-App Onboarding UX Plan

## Current State (grounded in code)

- **Settings → Voice** (`frontend/src/components/Settings.tsx`, `VoiceTab` ~line 1721) is a **flat config dump**: provider select (auto/local/cloud), STT/TTS/legacy URL text fields, API key, STT/TTS model + voice free-text, speed slider, single TTS "test voice" button. **Still surfaces OpenAI cloud links/guidance.**
- **Go config** (`internal/domain/entity/config.go`, `VoiceConfig`) and **TS types** (`frontend/src/types.ts` ~line 289) already have `sttBaseUrl`/`ttsBaseUrl` — **no data-model change needed**.
- **URL resolution + local-only errors** live in `internal/integration/voice/voice.go` (~lines 226–270).

## Gaps

- No guided flow.
- URLs default empty (correct ports appear only as placeholders, not saved values).
- No per-engine connection test (only TTS playback exists).
- No STT test.
- Voice/model fields are free-text with no discovery.
- No copy-paste install commands.
- Cloud is still steered (violates local-only).
- No first-run entry point.

## Proposed Experience

**Local-first defaults:**

- `provider = "local"`.
- Pre-fill `sttBaseUrl = http://localhost:2022` and `ttsBaseUrl = http://localhost:8880` as **real saved values**, not just placeholders.
- Demote cloud to a collapsed **"Advanced" escape hatch**.
- Drop OpenAI links.

**A 4-step "Voice setup" stepper** inside the Voice tab (also opened as a **modal on first voice-pane enable** when unconfigured):

| Step | Content |
| --- | --- |
| **1. Install Whisper** | Explainer + official link + OS-aware copy-command + STT URL field + **"Test connection"**. |
| **2. Install Kokoro** | Same pattern with TTS URL field. |
| **3. Pick a voice** | Dropdown populated from `GET /v1/audio/voices` (with a curated fallback) + speed slider. |
| **4. Test end-to-end** | Mic → text (`api.transcribe`) + voice playback (`api.synthesize`) → **"Voice is ready"**. |

Persistent **STT● / TTS● health chips** at the top of the tab.

## Implied Code Changes

| Layer | Change |
| --- | --- |
| **Go** | Add `Ping(op)` — cheap `GET /v1/models` or `/health` on the resolved URL → `{ok, detail}`. Add `ListVoices()` and `ListModels(op)`. |
| **`api.ts`** | Add `pingVoiceEndpoint`, `listVoices`, `listModels`. |
| **`types.ts`** | Add `VoicePingResult`. |
| **`Settings.tsx`** | Rewrite `VoiceTab` into a stepper with `StatusChip` / `CopyCommand` / `VoiceSelect` helpers (reuse existing `Section`/`SettingRow`/`SelectInput`/`Toggle`). |
| **First-run hook** | Trigger where the voice pane toggles on. |
| **Policy** | Honor no-auto-download: copy-only commands + external links. |

---

# Implementation Roadmap

> Ordered biggest-win-first. **Phases 1 and 2 are independently shippable.**

| Phase | Scope | Status |
| --- | --- | --- |
| **Phase 1** | Local-first defaults + per-engine **"Test connection"** (Go `Ping` + button + health chip). | Planned |
| **Phase 2** | Voice/model **discovery dropdowns** (`ListVoices`/`ListModels` + comboboxes). | **Being implemented now** |
| **Phase 3** | **Stepper UI** + copy-command install cards + **remove cloud steering**. | Planned |
| **Phase 4** | **End-to-end** mic → text test + first-run launch hook. | Planned |

---

# Keep it running after reboot

The install cards get the local STT/TTS servers running, but a foreground process dies on reboot. Each install card exposes a collapsed **"Auto-start on login (optional)"** subsection (per engine, OS-aware via the existing `OsSwitch`). The **headline approach is a copy-paste SETUP SCRIPT** that is **truly zero-edit** — there are **no** user-editable variables. The user reaches this step right after install + Test-connection succeeds, so the server **is** running. The script **detects the live server on its known port** (Whisper `2022`, Kokoro `8880` — the only baked-in constant per card), reads back that process's **exact command and working directory**, and reproduces them into a plist / systemd unit / scheduled task that it **writes AND registers** end-to-end (idempotently). Crucially, after capturing the command + cwd it **stops the manually-started instance and waits for the port to free**, then registers and starts the managed copy — so launchd/systemd/Task Scheduler's copy can **bind the port cleanly** in one shot (no restart-loop flapping on a port conflict), and the user's voice keeps working immediately. If nothing is listening on the port, the script prints a clear message (`start the server (and Test connection) first, then paste this again`) and exits non-zero. The user just pastes it into a terminal — nothing to edit.

> **Whisper vs. Kokoro launch shape.** Whisper's binary needs no extra env, so its script reproduces the exact leaf command of the running process. **Kokoro is different**: it is launched through a wrapper **start script** (`start-gpu_mac.sh` on Apple Silicon, `start-cpu.sh` on Intel/CPU, `start-gpu.sh` for an NVIDIA GPU) that exports the env it needs (`PYTHONPATH`, `MODEL_DIR`, `VOICES_DIR`, `DEVICE_TYPE`, …) and runs uvicorn via `uv`. If launchd/systemd were registered with the bare `uvicorn …` leaf command, **it would exit immediately** (missing env / `uv`). So on macOS + Linux the Kokoro auto-start script detects only the **working directory** of the running server, then registers the **start script** (with `uv` on `PATH`) instead of the leaf command. First start after boot warms up in ~10-20s. (Kokoro on Windows uses Docker `--restart` instead — see the Kokoro/Docker row.)

The UI and this doc use the same mechanisms:

| OS | Mechanism | The script does |
| --- | --- | --- |
| **macOS** (bash) | LaunchAgent plist | **Whisper:** finds the listener PID with `lsof -nP -iTCP:$PORT -sTCP:LISTEN -t`, reads its command via `ps -o command=` and cwd via `lsof -a -p $PID -d cwd -Fn`, then writes `~/Library/LaunchAgents/com.local.whisper.plist` whose `ProgramArguments` run `/bin/bash -lc 'cd "$CWD" && exec $CMD'` with `WorkingDirectory` + `RunAtLoad` + `KeepAlive`. **Kokoro:** reads only the cwd (same `lsof` cwd lookup), resolves `UVDIR=$(dirname "$(command -v uv …)")`, picks `SCRIPT` = `./start-gpu_mac.sh` on `arm64` else `./start-cpu.sh`, and writes `com.local.kokoro.plist` whose `ProgramArguments` run `/bin/bash -lc 'cd "$CWD" && export PATH="$UVDIR:$PATH" && exec $SCRIPT'` (so the start script sets Kokoro's env). Both then `kill "$PID"`, wait for the port to free, then `launchctl unload` (ignore errors) + `launchctl load -w` so launchd's copy binds cleanly. Status hint: `launchctl list | grep com.local`. |
| **Linux** (bash) | systemd **user** service | **Whisper:** finds the listener PID via `lsof -nP -iTCP:$PORT -sTCP:LISTEN -t` (fallback `ss -lptnH "sport = :$PORT"`), reads its command via `tr '\0' ' ' < /proc/$PID/cmdline` and cwd via `readlink /proc/$PID/cwd`, then writes `~/.config/systemd/user/whisper.service` with `ExecStart=/bin/bash -lc 'cd "$CWD" && exec $CMD'`. **Kokoro:** reads only the cwd (`readlink /proc/$PID/cwd`), resolves `UVDIR`, sets `SCRIPT=./start-cpu.sh` (`./start-gpu.sh` for an NVIDIA GPU), and writes `kokoro.service` with `ExecStart=/bin/bash -lc 'cd "$CWD" && export PATH="$UVDIR:$PATH" && exec $SCRIPT'`. Both add `WorkingDirectory=$CWD` + `Restart=always` + `[Install] WantedBy=default.target`, then `kill "$PID"`, wait for the port to free, then `systemctl --user daemon-reload && systemctl --user enable --now <name>` (which starts it) and `sudo loginctl enable-linger "$USER"`. Status hint: `systemctl --user status <name>`. |
| **Windows** (PowerShell) | Scheduled Task at logon | Finds the listener via `Get-NetTCPConnection -LocalPort $Port -State Listen`, resolves the owning process with `Get-CimInstance Win32_Process`, builds the action from its `ExecutablePath` + parsed arguments (working dir = the exe's directory; falls back to running the full `CommandLine` via `cmd /c` when the exe path can't be resolved), then `Stop-Process` (the manual copy) + short `Start-Sleep`, then `Unregister-ScheduledTask` + `Register-ScheduledTask` with `New-ScheduledTaskTrigger -AtLogOn`, then `Start-ScheduledTask` so the managed copy runs immediately (not only at next logon). Status hint: `Get-ScheduledTask -TaskName '<name>'`. |
| **Kokoro / Docker** | `--restart` flag | No script needed — `docker run -d --restart unless-stopped --name kokoro -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest` already brings the container back after reboot once Docker starts (ensure Docker itself starts on login). |

### Script shape (macOS / Linux / Windows)

**macOS (bash)** — this is the **whisper** script (reproduces the leaf command). Kokoro uses the wrapper-script variant described above (`PORT=8880` / `LABEL=com.local.kokoro`; registers `./start-gpu_mac.sh`/`./start-cpu.sh` with `uv` on `PATH` instead of `$CMD`):

```bash
#!/bin/bash
set -e
PORT=2022; LABEL=com.local.whisper
PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -z "$PID" ]; then
  echo "Nothing is listening on :$PORT — start the server (and Test connection) first, then paste this again."
  exit 1
fi
CMD=$(ps -o command= -p "$PID")
CWD=$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "$CWD" && exec $CMD</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$CWD</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
PLIST_EOF

# take over from the manually-started instance so launchd's copy can bind the port
kill "$PID" 2>/dev/null || true
for i in $(seq 1 20); do
  lsof -nP -iTCP:$PORT -sTCP:LISTEN -t >/dev/null 2>&1 || break
  sleep 0.3
done

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
echo "✅ $LABEL installed — it will auto-start at login. Check: launchctl list | grep com.local"
```

**Linux (bash)** — this is the **whisper** script (reproduces the leaf command). Kokoro uses the wrapper-script variant described above (`PORT=8880` / `NAME=kokoro`; `ExecStart` runs `./start-cpu.sh` — or `./start-gpu.sh` for an NVIDIA GPU — with `uv` on `PATH` instead of `$CMD`):

```bash
#!/bin/bash
set -e
PORT=2022; NAME=whisper
PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -z "$PID" ]; then
  PID=$(ss -lptnH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
fi
if [ -z "$PID" ]; then
  echo "Nothing is listening on :$PORT — start the server (and Test connection) first, then paste this again."
  exit 1
fi
CMD=$(tr '\0' ' ' < /proc/$PID/cmdline | sed 's/ *$//')
CWD=$(readlink /proc/$PID/cwd)
UNIT="$HOME/.config/systemd/user/$NAME.service"
mkdir -p "$HOME/.config/systemd/user"

cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=$NAME (local voice engine)

[Service]
ExecStart=/bin/bash -lc 'cd "$CWD" && exec $CMD'
WorkingDirectory=$CWD
Restart=always

[Install]
WantedBy=default.target
UNIT_EOF

# take over from the manually-started instance so systemd's copy can bind the port
kill "$PID" 2>/dev/null || true
for i in $(seq 1 20); do
  lsof -nP -iTCP:$PORT -sTCP:LISTEN -t >/dev/null 2>&1 || ss -lntH "sport = :$PORT" 2>/dev/null | grep -q . || break
  sleep 0.3
done

systemctl --user daemon-reload
systemctl --user enable --now "$NAME"
sudo loginctl enable-linger "$USER"   # so it runs without an active login session
echo "✅ $NAME installed — it will auto-start at login. Check: systemctl --user status $NAME"
```

**Windows (PowerShell)** — for whisper (kokoro: `$Port = 8880`, task name `Kokoro TTS`):

```powershell
# Paste this into PowerShell
$Port = 2022
$c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $c) {
  Write-Host "Nothing is listening on :$Port - start the server (and Test connection) first, then paste this again."
  exit 1
}
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
$exe = $p.ExecutablePath
$dir = if ($exe) { Split-Path -Parent $exe } else { (Get-Location).Path }
if ($exe) {
  $cmd = $p.CommandLine
  $quoted = '"' + $exe + '"'
  if ($cmd.StartsWith($quoted)) { $argline = $cmd.Substring($quoted.Length).Trim() }
  elseif ($cmd.StartsWith($exe)) { $argline = $cmd.Substring($exe.Length).Trim() }
  else { $argline = "" }
  if ($argline) {
    $action = New-ScheduledTaskAction -Execute $exe -Argument $argline -WorkingDirectory $dir
  } else {
    $action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $dir
  }
} else {
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c $($p.CommandLine)" -WorkingDirectory $dir
}
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
# take over from the manually-started instance so the managed copy can bind the port
Stop-Process -Id $($c.OwningProcess) -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Unregister-ScheduledTask -TaskName "Whisper STT" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "Whisper STT" -Action $action -Trigger $trigger -Settings $settings
Start-ScheduledTask -TaskName "Whisper STT"
Write-Host "OK Whisper STT installed - it will auto-start at login. Check: Get-ScheduledTask -TaskName 'Whisper STT'"
```

### Kokoro wrapper-script variant (macOS / Linux)

Kokoro must be started through its wrapper start script (so the required env is exported and `uv` resolves), **not** the bare uvicorn command. These are the validated scripts the UI emits. Windows uses Docker `--restart` instead (no script).

**macOS (bash)** — registers the arch-appropriate start script with `uv` on `PATH`:

```bash
#!/bin/bash
set -e
PORT=8880; LABEL=com.local.kokoro
PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -z "$PID" ]; then
  echo "Nothing is listening on :$PORT — start Kokoro (and Test connection) first, then paste this again."
  exit 1
fi
CWD=$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
UVDIR=$(dirname "$(command -v uv 2>/dev/null || echo /opt/homebrew/bin/uv)")
SCRIPT=$([ "$(uname -m)" = "arm64" ] && echo ./start-gpu_mac.sh || echo ./start-cpu.sh)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string><string>-lc</string>
    <string>cd "$CWD" && export PATH="$UVDIR:\$PATH" && exec $SCRIPT</string>
  </array>
  <key>WorkingDirectory</key><string>$CWD</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
PLIST_EOF
kill "$PID" 2>/dev/null || true
for i in $(seq 1 20); do lsof -nP -iTCP:$PORT -sTCP:LISTEN -t >/dev/null 2>&1 || break; sleep 0.3; done
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
echo "✅ $LABEL installed — Kokoro auto-starts at login (first start warms up in ~10-20s)."
```

**Linux (bash)** — systemd user unit running the start script with `uv` on `PATH`:

```bash
#!/bin/bash
set -e
PORT=8880; NAME=kokoro
PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -z "$PID" ]; then
  PID=$(ss -lptnH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
fi
if [ -z "$PID" ]; then
  echo "Nothing is listening on :$PORT — start Kokoro (and Test connection) first, then paste this again."
  exit 1
fi
CWD=$(readlink /proc/$PID/cwd)
UVDIR=$(dirname "$(command -v uv 2>/dev/null || echo "$HOME/.local/bin/uv")")
SCRIPT=./start-cpu.sh   # use ./start-gpu.sh if you have an NVIDIA GPU
UNIT="$HOME/.config/systemd/user/$NAME.service"
mkdir -p "$HOME/.config/systemd/user"
cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=$NAME (local voice engine)

[Service]
ExecStart=/bin/bash -lc 'cd "$CWD" && export PATH="$UVDIR:\$PATH" && exec $SCRIPT'
WorkingDirectory=$CWD
Restart=always

[Install]
WantedBy=default.target
UNIT_EOF
kill "$PID" 2>/dev/null || true
for i in $(seq 1 20); do
  lsof -nP -iTCP:$PORT -sTCP:LISTEN -t >/dev/null 2>&1 || ss -lntH "sport = :$PORT" 2>/dev/null | grep -q . || break
  sleep 0.3
done
systemctl --user daemon-reload
systemctl --user enable --now "$NAME"
sudo loginctl enable-linger "$USER"   # so it runs without an active login session
echo "✅ $NAME installed — Kokoro auto-starts at login (first start warms up in ~10-20s)."
```

---

# Reference Links

| Topic | Link |
| --- | --- |
| whisper.cpp repo | https://github.com/ggml-org/whisper.cpp |
| whisper.cpp releases (Windows .exe) | https://github.com/ggml-org/whisper.cpp/releases |
| whisper.cpp guide (quant defaults) | https://voice-mode.readthedocs.io/en/stable/whisper.cpp/ |
| Speaches (secondary STT) | https://speaches.ai/installation/ |
| Kokoro-FastAPI repo | https://github.com/remsky/Kokoro-FastAPI |
| Kokoro voices reference | https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md |
| Docker Desktop (macOS/Windows) | https://www.docker.com/products/docker-desktop/ |
| Docker Engine (Linux) | https://docs.docker.com/engine/install/ |
