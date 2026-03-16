package adapter

import (
	"context"

	"quant/internal/integration/entrypoint/dto"
)

// TaskController defines the interface for the task entrypoint controller.
// This interface is what the Wails app binds to.
type TaskController interface {
	OnStartup(ctx context.Context)
	OnShutdown(ctx context.Context)
	CreateTask(request dto.CreateTaskRequest) (*dto.TaskResponse, error)
	ListTasksByRepo(repoID string) ([]dto.TaskResponse, error)
	GetTask(id string) (*dto.TaskResponse, error)
	DeleteTask(id string) error
	ArchiveTask(id string) error
	UnarchiveTask(id string) error
	RenameTask(id string, newTag string, newName string) error
}
