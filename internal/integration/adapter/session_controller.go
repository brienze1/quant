package adapter

import (
	"context"

	"quant/internal/integration/entrypoint/dto"
)

// SessionController defines the interface for the session entrypoint controller.
// This interface is what the Wails app binds to.
type SessionController interface {
	OnStartup(ctx context.Context)
	OnShutdown(ctx context.Context)
	CreateSession(request dto.CreateSessionRequest) (*dto.SessionResponse, error)
	StartSession(id string, rows int, cols int) error
	ResumeSession(id string, rows int, cols int) error
	StopSession(id string) error
	DeleteSession(id string) error
	ArchiveSession(id string) error
	UnarchiveSession(id string) error
	ListSessions() ([]dto.SessionResponse, error)
	ListSessionsByRepo(repoID string) ([]dto.SessionResponse, error)
	ListSessionsByTask(taskID string) ([]dto.SessionResponse, error)
	GetSession(id string) (*dto.SessionResponse, error)
	SendMessage(id string, message string) error
	ResizeTerminal(id string, rows int, cols int) error
	GetSessionOutput(id string) (string, error)
	MoveSessionToTask(sessionID string, newTaskID string) error
	RenameSession(id string, newName string) error
	CheckBranchExists(repoID string, branchName string) (bool, error)
	RunShortcut(sessionID string, command string) error
	GitCommit(sessionID string, message string) error
	GitPull(sessionID string, branch string) error
	GitPush(sessionID string) error
	GetUnpushedCommits(sessionID string) ([]string, error)
	GetCurrentBranch(sessionID string) (string, error)
	ListBranches(sessionID string) ([]string, error)
	GitDiffFiles(sessionID string) ([]dto.DiffFileResponse, error)
	GitDiffFile(sessionID string, filePath string) (string, error)
	GitGetFileContent(sessionID string, filePath string, version string) (string, error)
	GitSaveFileContent(sessionID string, filePath string, content string) error
	GitCommitFiles(sessionID string, message string, files []string) error
}
