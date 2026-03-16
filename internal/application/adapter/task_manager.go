// Package adapter contains interfaces that application services implement.
package adapter

import (
	"quant/internal/domain/entity"
)

// TaskManager defines the service interface for task management operations.
// This is the application adapter that the taskManagerService implements.
type TaskManager interface {
	CreateTask(repoID string, tag string, name string) (*entity.Task, error)
	ListTasksByRepo(repoID string) ([]entity.Task, error)
	GetTask(id string) (*entity.Task, error)
	DeleteTask(id string) error
	ArchiveTask(id string) error
	UnarchiveTask(id string) error
	RenameTask(id string, newTag string, newName string) error
}
