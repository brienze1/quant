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
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"quant/internal/integration/adapter"
)

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
	claudeBinaryPath string                    // resolved full path to claude binary
}

// NewProcessManager creates a new process manager for Claude CLI processes.
func NewProcessManager() adapter.ProcessManager {
	homeDir, _ := os.UserHomeDir()
	outputDir := filepath.Join(homeDir, ".quant", "sessions")
	_ = os.MkdirAll(outputDir, 0755)

	return &processManager{
		processes:        make(map[string]*claudeProcess),
		outputDir:        outputDir,
		claudeBinaryPath: resolveClaudeBinary(),
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

// resolveClaudeBinary finds the full path to the claude binary using the user's login shell.
// GUI apps on macOS don't inherit the user's shell PATH, so we use the login shell to resolve it.
func resolveClaudeBinary() string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	// Ask the login shell for the full path to claude.
	cmd := exec.Command(shell, "-l", "-c", "which claude")
	output, err := cmd.Output()
	if err == nil {
		resolved := strings.TrimSpace(string(output))
		if resolved != "" {
			return resolved
		}
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
func (m *processManager) Spawn(sessionID string, sessionType string, directory string, conversationID string, skipPermissions bool, model string, extraCliArgs string, rows uint16, cols uint16) (int, error) {
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
		cmd = exec.Command(m.claudeBinaryPath, args...)
	}

	cmd.Dir = directory
	cmd.Env = append(shellEnv(), "TERM=xterm-256color")

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
						wailsRuntime.EventsEmit(m.ctx, "session:output", map[string]string{
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
			newPid, err := m.Spawn(sessionID, sessionType, directory, "", skipPermissions, model, extraCliArgs, rows, cols)
			if err == nil && m.ctx != nil {
				// Notify frontend of the new PID via a restart event.
				wailsRuntime.EventsEmit(m.ctx, "session:restarted", map[string]interface{}{
					"sessionId": sessionID,
					"pid":       newPid,
				})
			}
			return
		}

		// Notify frontend that the process exited.
		if m.ctx != nil {
			wailsRuntime.EventsEmit(m.ctx, "session:exited", map[string]string{
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

// GetOutput returns the persisted output for a session from disk.
func (m *processManager) GetOutput(sessionID string) ([]byte, error) {
	data, err := os.ReadFile(m.outputPath(sessionID))
	if err != nil {
		if os.IsNotExist(err) {
			return []byte{}, nil
		}
		return nil, fmt.Errorf("failed to read output file: %w", err)
	}
	return data, nil
}
