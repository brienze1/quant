// Package controller contains entrypoint controllers bound to the Wails runtime.
package controller

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"quant/internal/application/adapter"
	"quant/internal/domain/entity"
	intadapter "quant/internal/integration/adapter"
	"quant/internal/integration/entrypoint/dto"
	"quant/internal/integration/remote"
)

// sessionController implements the integration adapter.SessionController interface.
// It is bound to the Wails runtime and exposes session management operations to the frontend.
type sessionController struct {
	ctx            context.Context
	sessionManager adapter.SessionManager
}

// NewSessionController creates a new session controller.
// Returns the intadapter.SessionController interface, not the concrete type.
func NewSessionController(sessionManager adapter.SessionManager) intadapter.SessionController {
	return &sessionController{
		sessionManager: sessionManager,
	}
}

// OnStartup is called when the Wails app starts. The context is saved for runtime method calls.
func (c *sessionController) OnStartup(ctx context.Context) {
	c.ctx = ctx
}

// OnShutdown is called when the Wails app is shutting down.
func (c *sessionController) OnShutdown(_ context.Context) {
	// Clean up any running sessions if needed.
}

// CreateSession creates a new session and returns its response DTO.
func (c *sessionController) CreateSession(request dto.CreateSessionRequest) (*dto.SessionResponse, error) {
	opts := entity.SessionOptions{
		UseWorktree:       request.UseWorktree,
		SkipPermissions:   request.SkipPermissions,
		AutoPull:          request.AutoPull,
		PullBranch:        request.PullBranch,
		BranchNamePattern: request.BranchNamePattern,
		Model:             request.Model,
		ExtraCliArgs:      request.ExtraCliArgs,
		DirectoryOverride: request.DirectoryOverride,
		WorkspaceID:       request.WorkspaceID,
		NoFlicker:         true, // Regular sessions always use NO_FLICKER
		ClaudeSessionID:   request.ClaudeSessionID,
	}
	session, err := c.sessionManager.CreateSession(request.Name, request.Description, request.SessionType, request.RepoID, request.TaskID, opts)
	if err != nil {
		return nil, err
	}

	return dto.SessionResponseFromEntityPtr(session), nil
}

// StartAssistantSession creates and returns a fresh Quant Assistant session.
func (c *sessionController) StartAssistantSession(model string) (*dto.SessionResponse, error) {
	session, err := c.sessionManager.StartAssistantSession(model)
	if err != nil {
		return nil, err
	}
	return dto.SessionResponseFromEntityPtr(session), nil
}

// StartSession starts a new Claude process in a PTY for an idle session.
func (c *sessionController) StartSession(id string, rows int, cols int) error {
	return c.sessionManager.StartSession(id, rows, cols)
}

// ResumeSession resumes a paused session by re-spawning claude with --resume.
func (c *sessionController) ResumeSession(id string, rows int, cols int) error {
	return c.sessionManager.ResumeSession(id, rows, cols)
}

// StopSession stops a running session.
func (c *sessionController) StopSession(id string) error {
	return c.sessionManager.StopSession(id)
}

// DeleteSession deletes a session.
func (c *sessionController) DeleteSession(id string) error {
	return c.sessionManager.DeleteSession(id)
}

// ArchiveSession archives a session (soft delete).
func (c *sessionController) ArchiveSession(id string) error {
	return c.sessionManager.ArchiveSession(id)
}

// UnarchiveSession restores a previously archived session.
func (c *sessionController) UnarchiveSession(id string) error {
	return c.sessionManager.UnarchiveSession(id)
}

// ListSessions returns all sessions as response DTOs.
func (c *sessionController) ListSessions() ([]dto.SessionResponse, error) {
	sessions, err := c.sessionManager.ListSessions()
	if err != nil {
		return nil, err
	}

	return dto.SessionResponseListFromEntities(sessions), nil
}

// ListSessionsByRepo returns all sessions for a given repository as response DTOs.
func (c *sessionController) ListSessionsByRepo(repoID string) ([]dto.SessionResponse, error) {
	sessions, err := c.sessionManager.ListSessionsByRepo(repoID)
	if err != nil {
		return nil, err
	}

	return dto.SessionResponseListFromEntities(sessions), nil
}

// ListSessionsByTask returns all sessions for a given task as response DTOs.
func (c *sessionController) ListSessionsByTask(taskID string) ([]dto.SessionResponse, error) {
	sessions, err := c.sessionManager.ListSessionsByTask(taskID)
	if err != nil {
		return nil, err
	}

	return dto.SessionResponseListFromEntities(sessions), nil
}

// GetSession returns a single session by ID as a response DTO.
func (c *sessionController) GetSession(id string) (*dto.SessionResponse, error) {
	session, err := c.sessionManager.GetSession(id)
	if err != nil {
		return nil, err
	}

	return dto.SessionResponseFromEntityPtr(session), nil
}

// SendMessage writes raw terminal input to the PTY for a session.
func (c *sessionController) SendMessage(id string, message string) error {
	return c.sessionManager.SendMessage(id, message)
}

// ResizeTerminal resizes the PTY for the given session.
func (c *sessionController) ResizeTerminal(id string, rows int, cols int) error {
	return c.sessionManager.ResizeTerminal(id, rows, cols)
}

// MoveSessionToTask moves a session to a different task.
func (c *sessionController) MoveSessionToTask(sessionID string, newTaskID string) error {
	return c.sessionManager.UpdateSessionTask(sessionID, newTaskID)
}

// RenameSession updates the name of a session.
func (c *sessionController) RenameSession(id string, newName string) error {
	return c.sessionManager.RenameSession(id, newName)
}

// SetClaudeSessionID attaches an existing claude CLI conversation to a session,
// or detaches the current one when claudeID is empty.
func (c *sessionController) SetClaudeSessionID(sessionID string, claudeID string) error {
	return c.sessionManager.SetClaudeSessionID(sessionID, claudeID)
}

// ListAdoptableSessions returns claude CLI sessions found on disk for a directory
// that are not yet attached to any quant session.
func (c *sessionController) ListAdoptableSessions(directory string) ([]dto.ExternalSessionResponse, error) {
	sessions, err := c.sessionManager.ListAdoptableSessions(directory)
	if err != nil {
		return nil, err
	}

	return dto.ExternalSessionResponseListFromEntities(sessions), nil
}

// CheckBranchExists checks if a git branch already exists in the given repo.
func (c *sessionController) CheckBranchExists(repoID string, branchName string) (bool, error) {
	return c.sessionManager.CheckBranchExists(repoID, branchName)
}

// GetSessionOutput returns the persisted output for a session.
func (c *sessionController) GetSessionOutput(id string) (string, error) {
	return c.sessionManager.GetSessionOutput(id)
}

// RunShortcut executes a shell command in the session's working directory.
func (c *sessionController) RunShortcut(sessionID string, command string) error {
	return c.sessionManager.RunShortcut(sessionID, command)
}

// GitCommit runs `git commit -m <message>` in the session's working directory.
func (c *sessionController) GitCommit(sessionID string, message string) error {
	return c.sessionManager.GitCommit(sessionID, message)
}

// GitPull runs `git pull origin <branch>` in the session's working directory.
func (c *sessionController) GitPull(sessionID string, branch string) error {
	return c.sessionManager.GitPull(sessionID, branch)
}

// GitPush runs `git push` in the session's working directory.
func (c *sessionController) GitPush(sessionID string) error {
	return c.sessionManager.GitPush(sessionID)
}

// GetUnpushedCommits returns commits not yet pushed to the upstream branch.
// Returns an empty slice when no upstream is configured.
func (c *sessionController) GetUnpushedCommits(sessionID string) ([]string, error) {
	return c.sessionManager.GetUnpushedCommits(sessionID)
}

// GetCurrentBranch returns the name of the current git branch in the session's working directory.
func (c *sessionController) GetCurrentBranch(sessionID string) (string, error) {
	return c.sessionManager.GetCurrentBranch(sessionID)
}

// ListBranches returns all local and remote git branches in the session's working directory.
func (c *sessionController) ListBranches(sessionID string) ([]string, error) {
	return c.sessionManager.ListBranches(sessionID)
}

// GitDiffFiles returns the list of changed files in the session's working directory as response DTOs.
func (c *sessionController) GitDiffFiles(sessionID string) ([]dto.DiffFileResponse, error) {
	files, err := c.sessionManager.GitDiffFiles(sessionID)
	if err != nil {
		return nil, err
	}
	return dto.DiffFileResponseListFromEntities(files), nil
}

// GitDiffFile returns the unified diff string for a single file in the session's working directory.
func (c *sessionController) GitDiffFile(sessionID string, filePath string) (string, error) {
	return c.sessionManager.GitDiffFile(sessionID, filePath)
}

// GitGetFileContent returns the content of a file at the given version ("head" or "current").
func (c *sessionController) GitGetFileContent(sessionID string, filePath string, version string) (string, error) {
	return c.sessionManager.GitGetFileContent(sessionID, filePath, version)
}

// GitSaveFileContent writes content to a file within the session's working directory.
func (c *sessionController) GitSaveFileContent(sessionID string, filePath string, content string) error {
	return c.sessionManager.GitSaveFileContent(sessionID, filePath, content)
}

// GitCommitFiles stages and commits only the specified files with the given message.
func (c *sessionController) GitCommitFiles(sessionID string, message string, files []string) error {
	return c.sessionManager.GitCommitFiles(sessionID, message, files)
}

// QuantiChat sends a message to Quanti using claude -p --output-format stream-json.
// This gives newline-delimited JSON events with typed messages. We parse each event
// and emit "quanti:token" for text deltas so the UI shows a streaming response.
// Returns the complete response text when done.
func (c *sessionController) QuantiChat(convID string, message string, model string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}

	quantiDir := filepath.Join(homeDir, ".quant", "quanti")

	claudeBin := "claude"
	for _, candidate := range []string{
		"/usr/local/bin/claude",
		filepath.Join(homeDir, ".local/bin/claude"),
		filepath.Join(homeDir, "bin/claude"),
	} {
		if _, statErr := os.Stat(candidate); statErr == nil {
			claudeBin = candidate
			break
		}
	}

	args := []string{"-p", message, "--output-format", "stream-json", "--dangerously-skip-permissions", "--verbose"}
	if convID != "" {
		args = append(args, "--resume", convID)
	} else {
		// First call — let Claude create a new conversation
	}
	if model != "" && model != "cli default" {
		args = append(args, "--model", model)
	}

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}
	parts := make([]string, 0, len(args)+1)
	parts = append(parts, shellQuoteSession(claudeBin))
	for _, a := range args {
		parts = append(parts, shellQuoteSession(a))
	}
	shellCmd := strings.Join(parts, " ")

	cmd := exec.Command(shell, "-l", "-c", shellCmd)
	cmd.Dir = quantiDir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("failed to start claude: %w", err)
	}

	// Parse newline-delimited JSON events from stream-json output.
	// Key event types:
	//   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
	//   {"type":"result","subtype":"success","result":"..."}
	var fullResponse strings.Builder
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer for large events
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		// Quick JSON parse — extract type and text content
		var event map[string]interface{}
		if jsonErr := json.Unmarshal([]byte(line), &event); jsonErr != nil {
			continue
		}

		eventType, _ := event["type"].(string)

		switch eventType {
		case "system":
			// Capture session_id from init event so frontend can resume later
			if subtype, _ := event["subtype"].(string); subtype == "init" {
				if sessionID, ok := event["session_id"].(string); ok && sessionID != "" {
					if c.ctx != nil {
						remote.Emit(c.ctx, "quanti:session", sessionID)
					}
				}
			}

		case "assistant":
			// Extract text from message.content[].text
			msg, _ := event["message"].(map[string]interface{})
			if msg == nil {
				continue
			}
			contentArr, _ := msg["content"].([]interface{})
			for _, block := range contentArr {
				blockMap, _ := block.(map[string]interface{})
				if blockMap == nil {
					continue
				}
				if blockMap["type"] == "text" {
					text, _ := blockMap["text"].(string)
					if text != "" {
						fullResponse.WriteString(text)
						if c.ctx != nil {
							remote.Emit(c.ctx, "quanti:token", text)
						}
					}
				}
			}

		case "result":
			// Final result — use this as the canonical response if we didn't get text events
			if result, ok := event["result"].(string); ok && fullResponse.Len() == 0 {
				fullResponse.WriteString(result)
				if c.ctx != nil {
					remote.Emit(c.ctx, "quanti:token", result)
				}
			}
		}
	}

	if err := cmd.Wait(); err != nil {
		errText := stderr.String()
		if errText == "" {
			errText = err.Error()
		}
		// Still emit done event even on error
		if c.ctx != nil {
			remote.Emit(c.ctx, "quanti:done", nil)
		}
		return "", fmt.Errorf("claude failed: %s", errText)
	}

	if c.ctx != nil {
		remote.Emit(c.ctx, "quanti:done", nil)
	}

	return strings.TrimSpace(fullResponse.String()), nil
}

// shellQuoteSession quotes a string for safe shell use (same logic as process manager).
func shellQuoteSession(s string) string {
	if !strings.ContainsAny(s, " \t\n\"'\\$`&|;<>(){}") {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}
