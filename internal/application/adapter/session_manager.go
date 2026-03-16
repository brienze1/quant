// Package adapter contains interfaces that application services implement.
package adapter

import (
	"quant/internal/domain/entity"
)

// SessionManager defines the service interface for session management operations.
// This is the application adapter that the sessionManagerService implements.
type SessionManager interface {
	CreateSession(name string, description string, sessionType string, repoID string, taskID string, opts entity.SessionOptions) (*entity.Session, error)
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
	CheckBranchExists(repoID string, branchName string) (bool, error)
}
