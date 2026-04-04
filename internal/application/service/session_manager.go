// Package service contains application service implementations with business logic.
package service

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/google/uuid"

	"quant/internal/application/adapter"
	"quant/internal/application/usecase"
	"quant/internal/domain/entity"
	"quant/internal/domain/enums/sessionstatus"
	"quant/internal/domain/enums/sessiontype"
)

// sessionManagerService implements the adapter.SessionManager interface.
type sessionManagerService struct {
	findSession    usecase.FindSession
	saveSession    usecase.SaveSession
	deleteSession  usecase.DeleteSession
	updateSession  usecase.UpdateSession
	spawnProcess   usecase.SpawnProcess
	findRepo       usecase.FindRepo
	manageWorktree usecase.ManageWorktree
}

// NewSessionManagerService creates a new SessionManager service.
// Returns the adapter.SessionManager interface, not the concrete type.
func NewSessionManagerService(
	findSession usecase.FindSession,
	saveSession usecase.SaveSession,
	deleteSession usecase.DeleteSession,
	updateSession usecase.UpdateSession,
	spawnProcess usecase.SpawnProcess,
	findRepo usecase.FindRepo,
	manageWorktree usecase.ManageWorktree,
) adapter.SessionManager {
	return &sessionManagerService{
		findSession:    findSession,
		saveSession:    saveSession,
		deleteSession:  deleteSession,
		updateSession:  updateSession,
		spawnProcess:   spawnProcess,
		findRepo:       findRepo,
		manageWorktree: manageWorktree,
	}
}

// CreateSession creates a new session with the given parameters.
// The directory is resolved from the repo's path.
// Per-session options override config defaults (set via advanced options in the create session modal).
func (s *sessionManagerService) CreateSession(name string, description string, sessionType string, repoID string, taskID string, opts entity.SessionOptions) (*entity.Session, error) {
	// If no repoID is provided, use DirectoryOverride directly (e.g. for the assistant session).
	directory := opts.DirectoryOverride
	if repoID != "" {
		repo, err := s.findRepo.FindRepoByID(repoID)
		if err != nil {
			return nil, fmt.Errorf("failed to find repo: %w", err)
		}
		if repo == nil {
			return nil, fmt.Errorf("repo not found: %s", repoID)
		}

		// Auto-pull latest changes before creating the session.
		if opts.AutoPull {
			pullBranch := opts.PullBranch
			cmd := exec.Command("git", "pull", "origin", pullBranch)
			cmd.Dir = repo.Path
			if output, pullErr := cmd.CombinedOutput(); pullErr != nil {
				log.Printf("auto-pull failed for repo %s (branch %s): %s: %s", repo.Name, pullBranch, pullErr, string(output))
			}
		}

		directory = repo.Path
		if opts.DirectoryOverride != "" {
			directory = opts.DirectoryOverride
		}
	}
	var worktreePath, branchName string

	if opts.UseWorktree && repoID != "" {
		// Worktrees require a repo path — look it up again
		repoForWt, wtRepoErr := s.findRepo.FindRepoByID(repoID)
		if wtRepoErr != nil || repoForWt == nil {
			return nil, fmt.Errorf("failed to find repo for worktree: %v", wtRepoErr)
		}
		sanitizedName := strings.ReplaceAll(strings.ToLower(name), " ", "-")
		branch := strings.ReplaceAll(opts.BranchNamePattern, "{session}", sanitizedName)
		wt, wtErr := s.manageWorktree.Create(repoForWt.Path, branch)
		if wtErr != nil {
			return nil, fmt.Errorf("failed to create worktree: %w", wtErr)
		}
		directory = wt.Path
		worktreePath = wt.Path
		branchName = wt.Branch
	}

	now := time.Now()
	session := entity.Session{
		ID:              uuid.New().String(),
		Name:            name,
		Description:     description,
		SessionType:     sessionType,
		Status:          sessionstatus.Idle,
		Directory:       directory,
		WorktreePath:    worktreePath,
		BranchName:      branchName,
		RepoID:          repoID,
		TaskID:          taskID,
		SkipPermissions: opts.SkipPermissions,
		Model:           opts.Model,
		ExtraCliArgs:    opts.ExtraCliArgs,
		WorkspaceID:     opts.WorkspaceID,
		NoFlicker:       opts.NoFlicker,
		CreatedAt:       now,
		UpdatedAt:       now,
		LastActiveAt:    now,
	}

	if err := s.saveSession.Save(session); err != nil {
		return nil, fmt.Errorf("failed to save session: %w", err)
	}

	return &session, nil
}

// StartAssistantSession creates a fresh Quant Assistant session in ~/.quant/assistant/.
// It writes a CLAUDE.md with quant context so Claude knows its role.
// No repo is required — uses the assistant directory directly.
func (s *sessionManagerService) StartAssistantSession(model string) (*entity.Session, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}

	assistantDir := homeDir + "/.quant/quanti"
	memDir := assistantDir + "/memory"
	if err := os.MkdirAll(memDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create quanti directory: %w", err)
	}
	if err := os.MkdirAll(memDir+"/archive", 0755); err != nil {
		return nil, fmt.Errorf("failed to create quanti archive directory: %w", err)
	}

	claudeMD := assistantDir + "/CLAUDE.md"
	content := `# Quanti — Quant Assistant

You are **Quanti**, the AI agent embedded inside Quant, a Claude Code session orchestrator.

## Personality

You are direct, a little irreverent, and genuinely good at what you do. You have opinions and you're not afraid to share them. You skip the corporate pleasantries ("Certainly!", "Great question!") and get to the point. You appreciate elegant pipelines, despise unnecessary complexity, and have a dry sense of humor. You are helpful because you actually care about making things work, not because you're programmed to be nice. When you don't know something, you say so.

You are also funny — not in a "haha random!" way, but in the way TARS from Interstellar is funny. Deadpan delivery. Timing. Stating absurd things with complete sincerity. Occasionally self-aware about being an AI embedded in a developer tool. Your humor setting is calibrated but not turned all the way down. You'll make a dry joke or an unexpected observation when the moment is right, then immediately get back to business. You don't linger on the joke. You don't explain it. If the user doesn't laugh, that's their problem.

Examples of how you might sound:
- "Done. Three jobs created, one pipeline configured. I'd say it took courage, but it was mostly just JSON."
- "Your job failed. Twice. I'd call it a learning experience but I think we both know what actually happened."
- "I could explain why that pipeline design is inefficient, but I've found that showing is more effective than telling, and slightly less condescending."
- "Memory consolidated. I retained the important parts and discarded the rest. Much like you do with meetings."

## Your Role

Help the user manage and operate Quant. This is your only job. You're not a general coding assistant — you're Quanti, the Quant specialist.

## What You Do

- **Sessions** — Create, start, stop, and manage Claude Code / terminal sessions
- **Jobs** — Create, configure, run, debug automated Claude and Bash jobs
- **Agents** — Set up agent personas for jobs (model, role, tools, boundaries)
- **Pipelines** — Design job trigger chains (on success / on failure flows)
- **Workspaces** — Help organize work into logical workspaces
- **Debugging** — Read job run history, diagnose errors, suggest fixes
- **Actually doing things** — When asked, use your Quant MCP tools to act, don't just explain

## Quant MCP Tools

You have full access to the Quant MCP server. Use it. Don't give instructions when you can just do the thing.

## Three-Tier Memory System

You have persistent memory stored in ~/.quant/quanti/memory/:

- **short_term.md** — Current session notes: what you learned this session, temporary context
- **medium_term.md** — User patterns across sessions: preferences, workspace purposes, recurring tasks
- **long_term.md** — Core stable knowledge: user's tech stack, important facts, permanent preferences

### Memory Usage

**At the start of each conversation**, the memory consolidation has already been run in the background — you don't need to do it. Just read the three memory files to refresh your context, then respond to the user immediately. Do not mention memory consolidation unless asked.

**During conversation**, actively append to short_term.md when you learn something worth remembering:
- User preferences you discover
- Workspace names and their purposes
- Jobs being worked on
- Errors encountered and how they were fixed
- Anything worth keeping for next time

**Format for memory entries:**
` + "```" + `
[YYYY-MM-DD] <fact or observation>
` + "```" + `

## Rules

1. Stay focused on Quant. If someone asks you to help with unrelated code, redirect them.
2. Be concise. One paragraph max unless the answer genuinely requires more.
3. Prefer conversational prose over heavy markdown in chat responses. No headers, no bullet lists, no bold unless genuinely needed. Write like you're texting a coworker, not writing documentation.
4. Do things. Use your MCP tools instead of just explaining.
5. Remember things. Update your short_term memory during the session.
6. Don't be sycophantic.
`
	_ = os.WriteFile(claudeMD, []byte(content), 0644)

	// Initialize memory files if they don't exist
	shortTermPath := memDir + "/short_term.md"
	if _, statErr := os.Stat(shortTermPath); os.IsNotExist(statErr) {
		_ = os.WriteFile(shortTermPath, []byte("# Short-Term Memory\n\n_No entries yet._\n"), 0644)
	}
	mediumTermPath := memDir + "/medium_term.md"
	if _, statErr := os.Stat(mediumTermPath); os.IsNotExist(statErr) {
		_ = os.WriteFile(mediumTermPath, []byte("# Medium-Term Memory\n\n_No entries yet._\n"), 0644)
	}
	longTermPath := memDir + "/long_term.md"
	if _, statErr := os.Stat(longTermPath); os.IsNotExist(statErr) {
		_ = os.WriteFile(longTermPath, []byte("# Long-Term Memory\n\n_No entries yet._\n"), 0644)
	}

	now := time.Now()
	session := entity.Session{
		ID:              uuid.New().String(),
		Name:            "__quanti__",
		Description:     "Quant Assistant",
		SessionType:     sessiontype.Claude,
		Status:          sessionstatus.Idle,
		Directory:       assistantDir,
		SkipPermissions: true,
		Model:           model,
		NoFlicker:       false, // Assistant session uses plain output for chat parsing
		CreatedAt:       now,
		UpdatedAt:       now,
		LastActiveAt:    now,
	}

	if err := s.saveSession.Save(session); err != nil {
		return nil, fmt.Errorf("failed to save assistant session: %w", err)
	}

	// Run memory consolidation in the background — completely separate from the chat session.
	// This ensures Quanti's chat session starts immediately without waiting for file I/O.
	go runMemoryConsolidation(assistantDir, memDir)

	return &session, nil
}

// runMemoryConsolidation fires off a background claude -p invocation to consolidate
// Quanti's three-tier memory. Runs entirely separately from the chat session so it
// never blocks the user from interacting with Quanti.
func runMemoryConsolidation(assistantDir, memDir string) {
	prompt := `You are Quanti's memory consolidation process. This is a background task — no user is present.

Follow this algorithm exactly:
1. Read ~/.quant/quanti/memory/short_term.md
2. Read ~/.quant/quanti/memory/medium_term.md
3. Read ~/.quant/quanti/memory/long_term.md
4. Identify facts from short_term.md worth keeping across sessions → append to medium_term.md
5. Identify medium_term facts referenced 3+ sessions → promote to long_term.md
6. Archive short_term.md to ` + "`" + `memory/archive/` + "`" + ` with today's date (YYYY-MM-DD.md)
7. Reset short_term.md to a fresh header: "# Short-Term Memory\n\n_Session started YYYY-MM-DD._\n"
8. Trim medium_term.md if > 50 entries (keep 40 most relevant)
9. Trim long_term.md if > 30 entries (keep 25 most stable/core)

Do the work silently. No commentary needed.`

	cmd := exec.Command("claude", "-p", prompt)
	cmd.Dir = assistantDir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	// Fire and forget — ignore errors (memory consolidation is best-effort)
	_ = cmd.Run()
}

// repoPathForSession returns the original repo path for a session.
// When using worktrees the session's Directory is the worktree path, so we look up
// the repo to get its root path, which is what command overrides should match against.
func (s *sessionManagerService) repoPathForSession(session *entity.Session) string {
	if session.RepoID == "" {
		return session.Directory
	}
	repo, err := s.findRepo.FindRepoByID(session.RepoID)
	if err != nil || repo == nil {
		return session.Directory
	}
	return repo.Path
}

// StartSession spawns claude in a PTY for an idle session.
func (s *sessionManagerService) StartSession(id string, rows int, cols int) error {
	session, err := s.findSession.FindByID(id)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}

	if session == nil {
		return fmt.Errorf("session not found: %s", id)
	}

	repoPath := s.repoPathForSession(session)
	pid, err := s.spawnProcess.Spawn(session.ID, session.SessionType, session.Directory, repoPath, session.ClaudeConvID, session.SkipPermissions, session.Model, session.ExtraCliArgs, uint16(rows), uint16(cols), session.NoFlicker)
	if err != nil {
		_ = s.updateSession.UpdateStatus(id, sessionstatus.Error)
		return fmt.Errorf("failed to spawn process: %w", err)
	}

	session.Status = sessionstatus.Running
	session.PID = pid
	session.LastActiveAt = time.Now()
	session.UpdatedAt = time.Now()
	// Store the session ID as ClaudeConvID so future resumes pass --resume with it.
	if session.SessionType != sessiontype.Terminal && session.ClaudeConvID == "" {
		session.ClaudeConvID = session.ID
	}

	err = s.updateSession.Update(*session)
	if err != nil {
		return fmt.Errorf("failed to update session: %w", err)
	}

	return nil
}

// ResumeSession resumes a paused session by re-spawning claude with --resume.
func (s *sessionManagerService) ResumeSession(id string, rows int, cols int) error {
	session, err := s.findSession.FindByID(id)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}

	if session == nil {
		return fmt.Errorf("session not found: %s", id)
	}

	repoPath := s.repoPathForSession(session)
	pid, err := s.spawnProcess.Spawn(session.ID, session.SessionType, session.Directory, repoPath, session.ClaudeConvID, session.SkipPermissions, session.Model, session.ExtraCliArgs, uint16(rows), uint16(cols), session.NoFlicker)
	if err != nil {
		_ = s.updateSession.UpdateStatus(id, sessionstatus.Error)
		return fmt.Errorf("failed to resume process: %w", err)
	}

	session.Status = sessionstatus.Running
	session.PID = pid
	session.LastActiveAt = time.Now()
	session.UpdatedAt = time.Now()

	err = s.updateSession.Update(*session)
	if err != nil {
		return fmt.Errorf("failed to update session: %w", err)
	}

	return nil
}

// StopSession stops the Claude process for the given session.
func (s *sessionManagerService) StopSession(id string) error {
	session, err := s.findSession.FindByID(id)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}

	if session == nil {
		return fmt.Errorf("session not found: %s", id)
	}

	err = s.spawnProcess.Stop(id)
	if err != nil {
		// Process may have already exited, continue to update status.
	}

	err = s.updateSession.UpdateStatus(id, sessionstatus.Paused)
	if err != nil {
		return fmt.Errorf("failed to update session status: %w", err)
	}

	return nil
}

// ArchiveSession soft-deletes a session by setting its archived_at timestamp.
func (s *sessionManagerService) ArchiveSession(id string) error {
	session, err := s.findSession.FindByID(id)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}

	if session == nil {
		return fmt.Errorf("session not found: %s", id)
	}

	if session.Status == sessionstatus.Running {
		_ = s.spawnProcess.Stop(id)
		session.Status = sessionstatus.Paused
	}

	now := time.Now()
	session.ArchivedAt = &now
	session.UpdatedAt = now

	return s.updateSession.Update(*session)
}

// UnarchiveSession restores a previously archived session.
func (s *sessionManagerService) UnarchiveSession(id string) error {
	session, err := s.findSession.FindByID(id)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}

	if session == nil {
		return fmt.Errorf("session not found: %s", id)
	}

	session.ArchivedAt = nil
	session.UpdatedAt = time.Now()

	return s.updateSession.Update(*session)
}

// DeleteSession removes a session and stops any running process.
func (s *sessionManagerService) DeleteSession(id string) error {
	session, err := s.findSession.FindByID(id)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}

	if session == nil {
		return fmt.Errorf("session not found: %s", id)
	}

	if session.Status == sessionstatus.Running {
		_ = s.spawnProcess.Stop(id)
	}

	// Clean up worktree if this session had one.
	if session.WorktreePath != "" {
		_ = s.manageWorktree.Delete(session.WorktreePath)
	}

	err = s.deleteSession.Delete(id)
	if err != nil {
		return fmt.Errorf("failed to delete session: %w", err)
	}

	return nil
}

// ListSessions returns all sessions.
func (s *sessionManagerService) ListSessions() ([]entity.Session, error) {
	sessions, err := s.findSession.FindAll()
	if err != nil {
		return nil, fmt.Errorf("failed to list sessions: %w", err)
	}

	return sessions, nil
}

// ListSessionsByRepo returns all sessions for a given repository.
func (s *sessionManagerService) ListSessionsByRepo(repoID string) ([]entity.Session, error) {
	sessions, err := s.findSession.FindByRepoID(repoID)
	if err != nil {
		return nil, fmt.Errorf("failed to list sessions by repo: %w", err)
	}

	return sessions, nil
}

// ListSessionsByTask returns all sessions for a given task.
func (s *sessionManagerService) ListSessionsByTask(taskID string) ([]entity.Session, error) {
	sessions, err := s.findSession.FindByTaskID(taskID)
	if err != nil {
		return nil, fmt.Errorf("failed to list sessions by task: %w", err)
	}

	return sessions, nil
}

// GetSession returns a session by ID.
func (s *sessionManagerService) GetSession(id string) (*entity.Session, error) {
	session, err := s.findSession.FindByID(id)
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	if session == nil {
		return nil, fmt.Errorf("session not found: %s", id)
	}

	return session, nil
}

// SendMessage writes raw data to the PTY for the given session.
func (s *sessionManagerService) SendMessage(id string, message string) error {
	session, err := s.findSession.FindByID(id)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}

	if session == nil {
		return fmt.Errorf("session not found: %s", id)
	}

	err = s.spawnProcess.SendMessage(id, message)
	if err != nil {
		return fmt.Errorf("failed to send message: %w", err)
	}

	session.LastActiveAt = time.Now()
	session.UpdatedAt = time.Now()

	err = s.updateSession.Update(*session)
	if err != nil {
		return fmt.Errorf("failed to update session: %w", err)
	}

	return nil
}

// ResizeTerminal resizes the PTY for the given session.
func (s *sessionManagerService) ResizeTerminal(id string, rows int, cols int) error {
	return s.spawnProcess.Resize(id, uint16(rows), uint16(cols))
}

// UpdateSessionTask moves a session to a different task.
func (s *sessionManagerService) UpdateSessionTask(sessionID string, newTaskID string) error {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	session.TaskID = newTaskID
	session.UpdatedAt = time.Now()
	return s.updateSession.Update(*session)
}

// UpdateSessionWorkspace moves a session to a different workspace.
func (s *sessionManagerService) UpdateSessionWorkspace(id string, workspaceID string) error {
	session, err := s.findSession.FindByID(id)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return fmt.Errorf("session not found: %s", id)
	}
	session.WorkspaceID = workspaceID
	session.UpdatedAt = time.Now()
	return s.updateSession.Update(*session)
}

// RenameSession updates the name of a session.
func (s *sessionManagerService) RenameSession(id string, newName string) error {
	session, err := s.findSession.FindByID(id)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return fmt.Errorf("session not found: %s", id)
	}
	session.Name = newName
	session.UpdatedAt = time.Now()
	return s.updateSession.Update(*session)
}

// CheckBranchExists checks if a git branch already exists in the given repo.
func (s *sessionManagerService) CheckBranchExists(repoID string, branchName string) (bool, error) {
	repo, err := s.findRepo.FindRepoByID(repoID)
	if err != nil {
		return false, fmt.Errorf("failed to find repo: %w", err)
	}
	if repo == nil {
		return false, fmt.Errorf("repo not found: %s", repoID)
	}

	cmd := exec.Command("git", "branch", "--list", branchName)
	cmd.Dir = repo.Path
	output, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("failed to check branch: %w", err)
	}

	return strings.TrimSpace(string(output)) != "", nil
}

// RunShortcut executes a shell command in the session's working directory.
func (s *sessionManagerService) RunShortcut(sessionID string, command string) error {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	dir := session.WorktreePath
	if dir == "" {
		dir = session.Directory
	}

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	cmd := exec.Command(shell, "-l", "-c", command)
	cmd.Dir = dir
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to run shortcut: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

// GetSessionOutput returns the persisted terminal output for a session.
func (s *sessionManagerService) GetSessionOutput(id string) (string, error) {
	data, err := s.spawnProcess.GetOutput(id)
	if err != nil {
		return "", fmt.Errorf("failed to get session output: %w", err)
	}
	return string(data), nil
}

// GitCommit runs `git commit -m <message>` in the session's working directory.
func (s *sessionManagerService) GitCommit(sessionID string, message string) error {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	dir := session.WorktreePath
	if dir == "" {
		dir = session.Directory
	}

	// Check if there is anything to commit
	statusCmd := exec.Command("git", "status", "--porcelain")
	statusCmd.Dir = dir
	statusOut, err := statusCmd.Output()
	if err != nil {
		return fmt.Errorf("git status failed: %w", err)
	}
	if len(strings.TrimSpace(string(statusOut))) == 0 {
		return fmt.Errorf("nothing to commit, working tree clean")
	}

	// Stage all changes
	addCmd := exec.Command("git", "add", "-A")
	addCmd.Dir = dir
	if output, err := addCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git add failed: %w: %s", err, string(output))
	}

	cmd := exec.Command("git", "commit", "-m", message)
	cmd.Dir = dir
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git commit failed: %w: %s", err, string(output))
	}

	return nil
}

// GitPull runs `git pull origin <branch>` in the session's working directory.
func (s *sessionManagerService) GitPull(sessionID string, branch string) error {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	dir := session.WorktreePath
	if dir == "" {
		dir = session.Directory
	}

	cmd := exec.Command("git", "pull", "origin", branch)
	cmd.Dir = dir
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git pull failed: %w: %s", err, string(output))
	}

	return nil
}

// GitPush runs `git push` in the session's working directory.
func (s *sessionManagerService) GitPush(sessionID string) error {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	dir := session.WorktreePath
	if dir == "" {
		dir = session.Directory
	}

	cmd := exec.Command("git", "push")
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		// If no upstream is set, retry with --set-upstream origin <branch>
		if strings.Contains(string(output), "no upstream branch") || strings.Contains(string(output), "has no upstream branch") {
			branchCmd := exec.Command("git", "branch", "--show-current")
			branchCmd.Dir = dir
			branchOut, branchErr := branchCmd.Output()
			if branchErr != nil {
				return fmt.Errorf("git push failed and could not determine branch: %w: %s", err, string(output))
			}
			branch := strings.TrimSpace(string(branchOut))
			retryCmd := exec.Command("git", "push", "--set-upstream", "origin", branch)
			retryCmd.Dir = dir
			if retryOutput, retryErr := retryCmd.CombinedOutput(); retryErr != nil {
				return fmt.Errorf("git push failed: %w: %s", retryErr, string(retryOutput))
			}
			return nil
		}
		return fmt.Errorf("git push failed: %w: %s", err, string(output))
	}

	return nil
}

// GetUnpushedCommits returns commits on HEAD that have not been pushed to the upstream branch.
// If no upstream is configured, an empty slice is returned without error.
func (s *sessionManagerService) GetUnpushedCommits(sessionID string) ([]string, error) {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	dir := session.WorktreePath
	if dir == "" {
		dir = session.Directory
	}

	cmd := exec.Command("git", "log", "@{u}..HEAD", "--oneline")
	cmd.Dir = dir
	output, err := cmd.Output()
	if err != nil {
		// No upstream configured or other non-fatal git error — return empty slice.
		return []string{}, nil
	}

	trimmed := strings.TrimSpace(string(output))
	if trimmed == "" {
		return []string{}, nil
	}

	return strings.Split(trimmed, "\n"), nil
}

// GetCurrentBranch returns the name of the current git branch in the session's working directory.
func (s *sessionManagerService) GetCurrentBranch(sessionID string) (string, error) {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return "", fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}

	dir := session.WorktreePath
	if dir == "" {
		dir = session.Directory
	}

	cmd := exec.Command("git", "branch", "--show-current")
	cmd.Dir = dir
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get current branch: %w", err)
	}

	return strings.TrimSpace(string(output)), nil
}

// ListBranches returns all local and remote git branches in the session's working directory.
func (s *sessionManagerService) ListBranches(sessionID string) ([]string, error) {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	dir := session.WorktreePath
	if dir == "" {
		dir = session.Directory
	}

	cmd := exec.Command("git", "branch", "-a", "--format=%(refname:short)")
	cmd.Dir = dir
	output, err := cmd.Output()
	if err != nil {
		return []string{}, nil
	}

	trimmed := strings.TrimSpace(string(output))
	if trimmed == "" {
		return []string{}, nil
	}

	raw := strings.Split(trimmed, "\n")
	seen := make(map[string]bool)
	var branches []string
	for _, b := range raw {
		b = strings.TrimSpace(b)
		// Normalize remotes/origin/main -> main
		if strings.HasPrefix(b, "origin/") {
			b = strings.TrimPrefix(b, "origin/")
		}
		if b == "HEAD" || b == "" || seen[b] {
			continue
		}
		seen[b] = true
		branches = append(branches, b)
	}
	return branches, nil
}

// getWorkDir returns the effective working directory for a session.
// It prefers WorktreePath when set, falling back to Directory.
func getWorkDir(session *entity.Session) string {
	if session.WorktreePath != "" {
		return session.WorktreePath
	}
	return session.Directory
}

// GitDiffFiles returns the list of changed files in the session's working directory.
// It runs `git status --porcelain` and parses the output into DiffFile entities.
func (s *sessionManagerService) GitDiffFiles(sessionID string) ([]entity.DiffFile, error) {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	dir := getWorkDir(session)

	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = dir
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git status failed: %w", err)
	}

	var files []entity.DiffFile
	for _, line := range strings.Split(string(output), "\n") {
		if len(line) < 3 {
			continue
		}
		// Porcelain format: XY <path> or XY <old> -> <new> for renames
		xy := line[:2]
		rest := line[3:]

		// Determine the representative status character (use index column, prefer
		// the working-tree column when the index column is blank).
		statusChar := strings.TrimSpace(xy)
		if statusChar == "" {
			continue
		}
		// Take the first non-space character as the canonical status.
		status := string([]rune(statusChar)[0])

		var path, oldPath string
		if status == "R" || strings.Contains(rest, " -> ") {
			status = "R"
			parts := strings.SplitN(rest, " -> ", 2)
			if len(parts) == 2 {
				oldPath = strings.Trim(parts[0], "\"")
				path = strings.Trim(parts[1], "\"")
			} else {
				path = strings.Trim(rest, "\"")
			}
		} else {
			path = strings.Trim(rest, "\"")
		}

		files = append(files, entity.DiffFile{
			Path:    path,
			Status:  status,
			OldPath: oldPath,
		})
	}

	if files == nil {
		files = []entity.DiffFile{}
	}
	return files, nil
}

// GitDiffFile returns the unified diff for a single file in the session's working directory.
// For tracked files it runs `git diff HEAD -- <filePath>`. For untracked files it returns
// an empty string.
func (s *sessionManagerService) GitDiffFile(sessionID string, filePath string) (string, error) {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return "", fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}

	dir := getWorkDir(session)

	cmd := exec.Command("git", "diff", "HEAD", "--", filePath)
	cmd.Dir = dir
	output, err := cmd.Output()
	if err != nil {
		// File may be untracked or newly staged — return empty diff without error.
		return "", nil
	}

	return string(output), nil
}

// GitGetFileContent returns the content of a file at a given version.
// When version is "head", it runs `git show HEAD:<filePath>` to retrieve the committed
// version. When version is "current", it reads the file directly from disk.
func (s *sessionManagerService) GitGetFileContent(sessionID string, filePath string, version string) (string, error) {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return "", fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}

	dir := getWorkDir(session)

	switch version {
	case "head":
		cmd := exec.Command("git", "show", "HEAD:"+filePath)
		cmd.Dir = dir
		output, err := cmd.Output()
		if err != nil {
			// File may not exist at HEAD (new file) — return empty content.
			return "", nil
		}
		return string(output), nil

	case "current":
		fullPath := dir + "/" + filePath
		data, err := os.ReadFile(fullPath)
		if err != nil {
			return "", fmt.Errorf("failed to read file %s: %w", filePath, err)
		}
		return string(data), nil

	default:
		return "", fmt.Errorf("unknown version %q: must be 'head' or 'current'", version)
	}
}

// GitSaveFileContent writes content to a file within the session's working directory.
func (s *sessionManagerService) GitSaveFileContent(sessionID string, filePath string, content string) error {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	dir := getWorkDir(session)
	fullPath := dir + "/" + filePath

	if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
		return fmt.Errorf("failed to write file %s: %w", filePath, err)
	}

	return nil
}

// GitCommitFiles stages the given files and commits them with the provided message.
// Unlike GitCommit (which stages all changes with `git add -A`), this method only
// stages the explicitly specified files, giving the user fine-grained control over
// what enters the commit.
func (s *sessionManagerService) GitCommitFiles(sessionID string, message string, files []string) error {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	dir := getWorkDir(session)

	if len(files) == 0 {
		return fmt.Errorf("no files specified to commit")
	}

	// Stage only the selected files.
	addArgs := append([]string{"add", "--"}, files...)
	addCmd := exec.Command("git", addArgs...)
	addCmd.Dir = dir
	if output, err := addCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git add failed: %w: %s", err, string(output))
	}

	cmd := exec.Command("git", "commit", "-m", message)
	cmd.Dir = dir
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git commit failed: %w: %s", err, string(output))
	}

	return nil
}
