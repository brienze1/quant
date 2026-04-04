// Package adapter contains interfaces that application services implement.
package adapter

import (
	"quant/internal/domain/entity"
)

// SessionManager defines the service interface for session management operations.
// This is the application adapter that the sessionManagerService implements.
type SessionManager interface {
	CreateSession(name string, description string, sessionType string, repoID string, taskID string, opts entity.SessionOptions) (*entity.Session, error)
	StartAssistantSession(model string) (*entity.Session, error)
	StartSession(id string, rows int, cols int) error
	ResumeSession(id string, rows int, cols int) error
	StopSession(id string) error
	DeleteSession(id string) error
	ArchiveSession(id string) error
	UnarchiveSession(id string) error
	ListSessions() ([]entity.Session, error)
	ListSessionsByRepo(repoID string) ([]entity.Session, error)
	ListSessionsByTask(taskID string) ([]entity.Session, error)
	GetSession(id string) (*entity.Session, error)
	SendMessage(id string, message string) error
	ResizeTerminal(id string, rows int, cols int) error
	GetSessionOutput(id string) (string, error)
	UpdateSessionTask(sessionID string, newTaskID string) error
	RenameSession(id string, newName string) error
	UpdateSessionWorkspace(id string, workspaceID string) error
	CheckBranchExists(repoID string, branchName string) (bool, error)
	RunShortcut(sessionID string, command string) error
	GitCommit(sessionID string, message string) error
	GitPull(sessionID string, branch string) error
	GitPush(sessionID string) error
	GetUnpushedCommits(sessionID string) ([]string, error)
	GetCurrentBranch(sessionID string) (string, error)
	ListBranches(sessionID string) ([]string, error)
	GitDiffFiles(sessionID string) ([]entity.DiffFile, error)
	GitDiffFile(sessionID string, filePath string) (string, error)
	GitGetFileContent(sessionID string, filePath string, version string) (string, error)
	GitSaveFileContent(sessionID string, filePath string, content string) error
	GitCommitFiles(sessionID string, message string, files []string) error
}
