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

	directory := repo.Path
	if opts.DirectoryOverride != "" {
		directory = opts.DirectoryOverride
	}
	var worktreePath, branchName string

	if opts.UseWorktree {
		sanitizedName := strings.ReplaceAll(strings.ToLower(name), " ", "-")
		branch := strings.ReplaceAll(opts.BranchNamePattern, "{session}", sanitizedName)
		wt, wtErr := s.manageWorktree.Create(repo.Path, branch)
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
		CreatedAt:       now,
		UpdatedAt:       now,
		LastActiveAt:    now,
	}

	err = s.saveSession.Save(session)
	if err != nil {
		return nil, fmt.Errorf("failed to save session: %w", err)
	}

	return &session, nil
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

	pid, err := s.spawnProcess.Spawn(session.ID, session.SessionType, session.Directory, session.ClaudeConvID, session.SkipPermissions, session.Model, session.ExtraCliArgs, uint16(rows), uint16(cols))
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

	pid, err := s.spawnProcess.Spawn(session.ID, session.SessionType, session.Directory, session.ClaudeConvID, session.SkipPermissions, session.Model, session.ExtraCliArgs, uint16(rows), uint16(cols))
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
	if output, err := cmd.CombinedOutput(); err != nil {
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
