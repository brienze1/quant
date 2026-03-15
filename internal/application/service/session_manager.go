// Package service contains application service implementations with business logic.
package service

import (
	"fmt"
	"log"
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
	loadConfig     usecase.LoadConfig
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
	loadConfig usecase.LoadConfig,
) adapter.SessionManager {
	return &sessionManagerService{
		findSession:    findSession,
		saveSession:    saveSession,
		deleteSession:  deleteSession,
		updateSession:  updateSession,
		spawnProcess:   spawnProcess,
		findRepo:       findRepo,
		manageWorktree: manageWorktree,
		loadConfig:     loadConfig,
	}
}

// CreateSession creates a new session with the given parameters.
// The directory is resolved from the repo's path.
// Config settings used: branchNamePattern, autoPull, defaultPullBranch, branchOverrides.
func (s *sessionManagerService) CreateSession(name string, description string, sessionType string, repoID string, taskID string, useWorktree bool, skipPermissions bool) (*entity.Session, error) {
	repo, err := s.findRepo.FindRepoByID(repoID)
	if err != nil {
		return nil, fmt.Errorf("failed to find repo: %w", err)
	}

	if repo == nil {
		return nil, fmt.Errorf("repo not found: %s", repoID)
	}

	cfg, err := s.loadConfig.LoadConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}

	// Auto-pull latest changes before creating the session.
	if cfg.AutoPull {
		pullBranch := cfg.DefaultPullBranch
		if override, ok := cfg.BranchOverrides[repo.Name]; ok && override != "" {
			pullBranch = override
		}

		cmd := exec.Command("git", "pull", "origin", pullBranch)
		cmd.Dir = repo.Path
		if output, pullErr := cmd.CombinedOutput(); pullErr != nil {
			log.Printf("auto-pull failed for repo %s (branch %s): %s: %s", repo.Name, pullBranch, pullErr, string(output))
		}
	}

	directory := repo.Path
	var worktreePath, branchName string

	if useWorktree {
		sanitizedName := strings.ReplaceAll(strings.ToLower(name), " ", "-")
		branch := strings.ReplaceAll(cfg.BranchNamePattern, "{session}", sanitizedName)
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
		SkipPermissions: skipPermissions,
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

	pid, err := s.spawnProcess.Spawn(session.ID, session.SessionType, session.Directory, session.ClaudeConvID, session.SkipPermissions, uint16(rows), uint16(cols))
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

	pid, err := s.spawnProcess.Spawn(session.ID, session.SessionType, session.Directory, session.ClaudeConvID, session.SkipPermissions, uint16(rows), uint16(cols))
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

// GetSessionOutput returns the persisted terminal output for a session.
func (s *sessionManagerService) GetSessionOutput(id string) (string, error) {
	data, err := s.spawnProcess.GetOutput(id)
	if err != nil {
		return "", fmt.Errorf("failed to get session output: %w", err)
	}
	return string(data), nil
}
