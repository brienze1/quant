// Package process contains the Claude CLI process manager implementation.
package process

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/creack/pty"

	"quant/internal/domain/persona"
	"quant/internal/infra/paths"
	"quant/internal/integration/adapter"
	"quant/internal/integration/remote"
)

// mcpConfigArgs returns the ["--mcp-config", <path>] argument pair to pass to the
// claude CLI when running in isolated mode (QUANT_HOME set) and the isolated
// .mcp.json file actually exists. Otherwise it returns nil:
//   - not isolated (production): the CLI reads the real ~/.mcp.json itself.
//   - isolated but no file (e.g. QUANT_SKIP_MCP_INJECT=1 wrote nothing): nothing
//     to point at, so we add no flag.
//
// We intentionally do NOT use --strict-mcp-config so the user's other MCP
// servers still load alongside the CLI-provided (trusted) quant entry.
func mcpConfigArgs() []string {
	if !paths.IsIsolated() {
		return nil
	}
	cfg := paths.MCPConfigPath()
	if _, err := os.Stat(cfg); err != nil {
		return nil
	}
	return []string{"--mcp-config", cfg}
}

// personaArgs returns the ["--append-system-prompt", "$QUANT_BASE_PERSONA"] argument
// pair to append to interactive claude sessions so they get Quant's base persona
// (awareness of Quant, the live mindmap, and the quant MCP tools) layered ON TOP
// of the user's project context. The literal token "$QUANT_BASE_PERSONA" is
// expanded newline-safely by the shellQuote+eval machinery from the env var of the
// same name (mirroring how job_manager passes $QUANT_AGENT_SYSTEM_PROMPT).
//
// It returns nil when QUANT_SKIP_PERSONA=1 so the feature can be opted out, and is
// only ever added to claude sessions (terminal sessions never call this).
func personaArgs() []string {
	if os.Getenv("QUANT_SKIP_PERSONA") == "1" {
		return nil
	}
	return []string{"--append-system-prompt", "$QUANT_BASE_PERSONA"}
}

// defaultMCPToolTimeoutMS is the MCP_TOOL_TIMEOUT value (milliseconds) injected
// into every claude session quant spawns. The claude CLI's MCP client aborts any
// tool call on HTTP-transport MCP servers after a hardcoded 60s default ("The
// operation timed out."), which would kill voice_listen/voice_converse mid
// recording: recording mode legitimately blocks up to the 15-min RECORDING_MAX_MS
// ceiling (frontend/src/voice/audioService.ts), plus STT time and a speak leg.
// Quant's own 120s ListenTimeout is already kept alive Go-side (Bridge.Extend),
// but only MCP_TOOL_TIMEOUT raises the client-side limit — verified empirically
// 2026-06-09: a 90s-blocking HTTP MCP tool fails at 60s by default and succeeds
// with MCP_TOOL_TIMEOUT set. 20 minutes comfortably exceeds the worst case.
const defaultMCPToolTimeoutMS = "1200000"

// withMCPToolTimeout appends MCP_TOOL_TIMEOUT=defaultMCPToolTimeoutMS to env
// unless the variable is already present (e.g. exported by the user's login
// shell, which shellEnv() inherits), so an explicit user value always wins.
func withMCPToolTimeout(env []string) []string {
	for _, kv := range env {
		if strings.HasPrefix(kv, "MCP_TOOL_TIMEOUT=") {
			return env
		}
	}
	return append(env, "MCP_TOOL_TIMEOUT="+defaultMCPToolTimeoutMS)
}

// claudeProcess holds the running process and its PTY master.
type claudeProcess struct {
	cmd *exec.Cmd
	ptm *os.File // PTY master
}

// processManager implements the adapter.ProcessManager interface using PTY.
type processManager struct {
	ctx              context.Context
	mu               sync.RWMutex
	processes        map[string]*claudeProcess // keyed by sessionID
	outputDir        string                    // base dir for output files (~/.quant/sessions/)
	claudeBinaryPath string                    // command name or path for the default claude binary
	commandOverrides map[string]string         // path substring -> resolved binary path
	basePersona      string                    // user-configured base persona; empty = built-in persona.Base
}

// NewProcessManager creates a new process manager for Claude CLI processes.
func NewProcessManager() adapter.ProcessManager {
	homeDir, _ := os.UserHomeDir()
	outputDir := filepath.Join(homeDir, ".quant", "sessions")
	_ = os.MkdirAll(outputDir, 0755)

	return &processManager{
		processes:        make(map[string]*claudeProcess),
		outputDir:        outputDir,
		commandOverrides: make(map[string]string),
	}
}

// shellEnv returns the environment variables from the user's login shell.
// This ensures spawned processes have the same PATH as if started from a terminal.
func shellEnv() []string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	cmd := exec.Command(shell, "-l", "-c", "env")
	output, err := cmd.Output()
	if err != nil {
		return os.Environ()
	}

	var env []string
	for _, line := range strings.Split(string(output), "\n") {
		if strings.Contains(line, "=") {
			env = append(env, line)
		}
	}

	if len(env) == 0 {
		return os.Environ()
	}

	return env
}

// rcFileForShell returns the interactive startup file that should be sourced for
// the given shell so that aliases and functions defined there are available.
func rcFileForShell(shell string) string {
	switch filepath.Base(shell) {
	case "zsh":
		return "~/.zshrc"
	case "bash":
		return "~/.bashrc"
	default:
		return ""
	}
}

// shellQuote wraps a string in single quotes, escaping any embedded single quotes.
// This is safe to use when building a command string for `sh -c`.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// UpdateCliBinaryConfig stores the CLI command name and path-based overrides used when
// spawning new sessions. Commands are passed to the shell via eval, so aliases, functions,
// and PATH entries from ~/.zshrc are all resolved at runtime without pre-resolving here.
func (m *processManager) UpdateCliBinaryConfig(cliBinaryPath string, commandOverrides map[string]string) {
	overrides := make(map[string]string, len(commandOverrides))
	for pattern, cmd := range commandOverrides {
		overrides[pattern] = cmd
	}

	m.mu.Lock()
	m.claudeBinaryPath = cliBinaryPath
	m.commandOverrides = overrides
	m.mu.Unlock()
}

// UpdateBasePersona stores the user-configured base persona used when spawning new
// sessions. An empty string means "use the built-in persona.Base" (resolved at
// spawn time), so clearing the field in Settings reverts to the shipped default.
func (m *processManager) UpdateBasePersona(basePersona string) {
	m.mu.Lock()
	m.basePersona = basePersona
	m.mu.Unlock()
}

// resolvePersona returns the persona text to inject: the user override when set,
// otherwise the built-in default.
func (m *processManager) resolvePersona() string {
	m.mu.RLock()
	custom := m.basePersona
	m.mu.RUnlock()
	if strings.TrimSpace(custom) != "" {
		return custom
	}
	return persona.Base
}

// getClaudeBinary returns the binary to use for a session.
// It checks overrides against the original repo path first (so worktree sessions still match),
// then falls back to checking the working directory, then the configured default.
func (m *processManager) getClaudeBinary(directory string, repoPath string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for pattern, cmd := range m.commandOverrides {
		if pattern == "" {
			continue
		}
		// Prefer matching against the original repo path so that worktree sessions
		// (whose working directory is ~/.quant/worktrees/...) still match correctly.
		if repoPath != "" && strings.Contains(repoPath, pattern) {
			return cmd
		}
		if strings.Contains(directory, pattern) {
			return cmd
		}
	}

	if m.claudeBinaryPath != "" {
		return m.claudeBinaryPath
	}

	return "claude"
}

// SetContext sets the Wails runtime context for emitting events.
func (m *processManager) SetContext(ctx context.Context) {
	m.ctx = ctx
}

// outputPath returns the path to the output file for a session.
func (m *processManager) outputPath(sessionID string) string {
	return filepath.Join(m.outputDir, sessionID+".log")
}

// Spawn starts a process in a PTY and streams output to the frontend.
// For "claude" sessions it launches the Claude CLI; for "terminal" sessions it launches a shell.
func (m *processManager) Spawn(sessionID string, sessionType string, directory string, repoPath string, conversationID string, skipPermissions bool, model string, extraCliArgs string, rows uint16, cols uint16, noFlicker bool) (int, error) {
	// Stop any existing process for this session.
	m.mu.RLock()
	_, exists := m.processes[sessionID]
	m.mu.RUnlock()
	if exists {
		_ = m.Stop(sessionID)
	}

	var cmd *exec.Cmd

	if sessionType == "terminal" {
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/zsh"
		}
		cmd = exec.Command(shell, "-l")
	} else {
		args := []string{}
		if conversationID != "" {
			args = append(args, "--resume", conversationID)
		} else {
			// First start: use our session ID as Claude's session ID so we can resume later.
			args = append(args, "--session-id", sessionID)
		}
		if skipPermissions {
			args = append(args, "--dangerously-skip-permissions")
		}
		if model != "" && model != "cli default" {
			args = append(args, "--model", model)
		}
		if extraCliArgs != "" {
			args = append(args, strings.Fields(extraCliArgs)...)
		}
		// In isolated mode, point claude at the isolated $QUANT_HOME/.mcp.json so
		// the child loads the quant server from there (trusted, no per-project
		// approval) instead of the real ~/.mcp.json. The flag and path are two
		// separate args, both quoted via shellQuote below.
		args = append(args, mcpConfigArgs()...)
		// Append Quant's base persona (via --append-system-prompt) so the agent is
		// aware it runs inside Quant and knows the mindmap + quant MCP tools. The
		// $QUANT_BASE_PERSONA token flows through the same shellQuote+eval path as the
		// other args; the env var is set below. Opt-out via QUANT_SKIP_PERSONA=1.
		args = append(args, personaArgs()...)

		// Build the full command string and run it via a login shell.
		// We explicitly source the user's interactive shell config (~/.zshrc or ~/.bashrc)
		// so that aliases and shell functions (e.g. `alias claude-bl='...'`) are available.
		// Relying on `-i` is not sufficient: zsh checks whether stdin is a TTY *before*
		// the PTY is attached, so it may run non-interactively and skip ~/.zshrc entirely.
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/zsh"
		}
		parts := make([]string, 0, len(args)+1)
		parts = append(parts, shellQuote(m.getClaudeBinary(directory, repoPath)))
		for _, a := range args {
			parts = append(parts, shellQuote(a))
		}
		// Source the interactive shell config so aliases/functions are defined,
		// then use eval to re-parse the command. This is necessary because zsh
		// expands aliases at parse time: in `zsh -c ". ~/.zshrc; alias-cmd"`,
		// the whole string is parsed before .zshrc runs, so the alias is not
		// yet known. eval re-parses after .zshrc has already executed, so the
		// alias is found.
		rcFile := rcFileForShell(shell)
		var shellCmd string
		if rcFile != "" {
			shellCmd = fmt.Sprintf("[ -f %s ] && . %s 2>/dev/null; eval %s", rcFile, rcFile, strings.Join(parts, " "))
		} else {
			shellCmd = fmt.Sprintf("eval %s", strings.Join(parts, " "))
		}
		cmd = exec.Command(shell, "-l", "-c", shellCmd)
	}

	cmd.Dir = directory
	baseEnv := append(shellEnv(), "TERM=xterm-256color")
	if noFlicker {
		baseEnv = append(baseEnv, "CLAUDE_CODE_NO_FLICKER=1")
	}
	// Carry the session id so the child claude process can scope its mindmap
	// MCP calls (the quant MCP server reads this via the X-Quant-Session header).
	baseEnv = append(baseEnv, fmt.Sprintf("QUANT_SESSION_ID=%s", sessionID))
	// Provide the base persona text for the $QUANT_BASE_PERSONA token added to the
	// claude args above. Only set it when persona is not skipped (and it is never
	// referenced by terminal sessions, which take the other branch). Passing it via
	// env keeps newlines intact through the shellQuote+eval machinery.
	if os.Getenv("QUANT_SKIP_PERSONA") != "1" {
		baseEnv = append(baseEnv, "QUANT_BASE_PERSONA="+m.resolvePersona())
	}
	// Raise claude's client-side MCP tool-call timeout so long voice recordings
	// survive past the hardcoded 60s HTTP-MCP default (see defaultMCPToolTimeoutMS).
	// Skipped when the user already exports MCP_TOOL_TIMEOUT themselves.
	baseEnv = withMCPToolTimeout(baseEnv)
	cmd.Env = baseEnv

	ptm, err := pty.Start(cmd)
	if err != nil {
		return 0, fmt.Errorf("failed to start claude in PTY: %w", err)
	}

	// Set initial PTY size.
	_ = pty.Setsize(ptm, &pty.Winsize{Rows: rows, Cols: cols})

	cp := &claudeProcess{cmd: cmd, ptm: ptm}

	m.mu.Lock()
	m.processes[sessionID] = cp
	m.mu.Unlock()

	pid := cmd.Process.Pid

	// Open output file. Truncate on resume since Claude re-renders conversation history.
	flags := os.O_CREATE | os.O_WRONLY
	if conversationID != "" {
		flags |= os.O_TRUNC
	} else {
		flags |= os.O_APPEND
	}
	outputFile, err := os.OpenFile(m.outputPath(sessionID), flags, 0644)
	if err != nil {
		outputFile = nil // non-fatal, just skip persistence
	}

	// Stream PTY output in a goroutine.
	go func() {
		buf := make([]byte, 32*1024)
		var carry []byte     // buffer for incomplete UTF-8 sequences at chunk boundaries
		var allOutput []byte // collect output to detect errors after exit

		for {
			n, readErr := ptm.Read(buf)
			if n > 0 {
				data := buf[:n]

				// Prepend any carry from previous read.
				if len(carry) > 0 {
					data = append(carry, data...)
					carry = nil
				}

				// Check for incomplete UTF-8 at the end.
				// Find the last valid UTF-8 boundary.
				validEnd := len(data)
				for validEnd > 0 && !utf8.Valid(data[:validEnd]) {
					validEnd--
				}

				// If the tail is an incomplete sequence, carry it over.
				if validEnd < len(data) {
					carry = make([]byte, len(data)-validEnd)
					copy(carry, data[validEnd:])
					data = data[:validEnd]
				}

				if len(data) > 0 {
					allOutput = append(allOutput, data...)

					// Write to disk for persistence.
					if outputFile != nil {
						_, _ = outputFile.Write(data)
					}

					// Send to frontend via Wails event.
					if m.ctx != nil {
						remote.Emit(m.ctx, "session:output", map[string]string{
							"sessionId": sessionID,
							"data":      string(data),
						})
					}
				}
			}

			if readErr != nil {
				break
			}
		}

		// Wait for process to finish.
		_ = cmd.Wait()

		if outputFile != nil {
			_ = outputFile.Close()
		}

		m.mu.Lock()
		delete(m.processes, sessionID)
		m.mu.Unlock()

		// If the process exited because the conversation ID doesn't exist,
		// automatically respawn with --session-id (fresh start) instead of --resume.
		if sessionType != "terminal" && conversationID != "" && strings.Contains(string(allOutput), "No conversation found") {
			// Truncate the error output so it doesn't persist.
			_ = os.Truncate(m.outputPath(sessionID), 0)

			// Respawn fresh with --session-id.
			newPid, err := m.Spawn(sessionID, sessionType, directory, repoPath, "", skipPermissions, model, extraCliArgs, rows, cols, noFlicker)
			if err == nil && m.ctx != nil {
				// Notify frontend of the new PID via a restart event.
				remote.Emit(m.ctx, "session:restarted", map[string]interface{}{
					"sessionId": sessionID,
					"pid":       newPid,
				})
			}
			return
		}

		// Notify frontend that the process exited.
		if m.ctx != nil {
			remote.Emit(m.ctx, "session:exited", map[string]string{
				"sessionId": sessionID,
			})
		}
	}()

	return pid, nil
}

// Stop terminates a running Claude process by session ID.
func (m *processManager) Stop(sessionID string) error {
	m.mu.RLock()
	cp, exists := m.processes[sessionID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("no process running for session: %s", sessionID)
	}

	// Close PTY master — this sends SIGHUP to the process.
	_ = cp.ptm.Close()

	// Also kill the process explicitly in case it doesn't respond to SIGHUP.
	if cp.cmd.Process != nil {
		_ = cp.cmd.Process.Kill()
	}

	return nil
}

// SendMessage writes raw data to the PTY (for terminal input).
func (m *processManager) SendMessage(sessionID string, message string) error {
	m.mu.RLock()
	cp, exists := m.processes[sessionID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("no process running for session: %s", sessionID)
	}

	_, err := cp.ptm.Write([]byte(message))
	if err != nil {
		return fmt.Errorf("failed to write to PTY: %w", err)
	}

	return nil
}

// Resize resizes the PTY for the given session.
func (m *processManager) Resize(sessionID string, rows uint16, cols uint16) error {
	m.mu.RLock()
	cp, exists := m.processes[sessionID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("no process running for session: %s", sessionID)
	}

	return pty.Setsize(cp.ptm, &pty.Winsize{Rows: rows, Cols: cols})
}

// maxReplayBytes caps the size of the session output replay returned to the
// frontend on terminal remount. Larger histories are truncated to the tail so
// that mounting a TerminalPane never blocks the renderer with a multi-megabyte
// xterm write. The visible terminal scrollback still grows beyond this via
// live "session:output" events.
const maxReplayBytes int64 = 256 * 1024

// GetOutput returns the persisted output for a session from disk. The result
// is capped at the last maxReplayBytes bytes; if the file is larger, a short
// grey notice is prepended so the user knows earlier output was elided.
func (m *processManager) GetOutput(sessionID string) ([]byte, error) {
	path := m.outputPath(sessionID)
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []byte{}, nil
		}
		return nil, fmt.Errorf("failed to open output file: %w", err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("failed to stat output file: %w", err)
	}

	size := info.Size()
	if size <= maxReplayBytes {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("failed to read output file: %w", err)
		}
		return data, nil
	}

	tail := make([]byte, maxReplayBytes)
	if _, err := f.ReadAt(tail, size-maxReplayBytes); err != nil {
		return nil, fmt.Errorf("failed to read output tail: %w", err)
	}

	// Advance to the next valid utf8 start so we don't slice through a multi-byte
	// rune. Worst case we drop up to 3 bytes, which is acceptable.
	start := 0
	for start < len(tail) && start < 4 && !utf8.RuneStart(tail[start]) {
		start++
	}
	tail = tail[start:]

	notice := []byte("\x1b[90m// [earlier output truncated]\x1b[0m\r\n")
	out := make([]byte, 0, len(notice)+len(tail))
	out = append(out, notice...)
	out = append(out, tail...)
	return out, nil
}
