// Package controller contains entrypoint controllers bound to the Wails runtime.
package controller

import (
	"context"

	"quant/internal/application/adapter"
	intadapter "quant/internal/integration/adapter"
	"quant/internal/integration/entrypoint/dto"
)

// taskController implements the integration adapter.TaskController interface.
// It is bound to the Wails runtime and exposes task management operations to the frontend.
type taskController struct {
	ctx         context.Context
	taskManager adapter.TaskManager
}

// NewTaskController creates a new task controller.
// Returns the intadapter.TaskController interface, not the concrete type.
func NewTaskController(taskManager adapter.TaskManager) intadapter.TaskController {
	return &taskController{
		taskManager: taskManager,
	}
}

// OnStartup is called when the Wails app starts. The context is saved for runtime method calls.
func (c *taskController) OnStartup(ctx context.Context) {
	c.ctx = ctx
}

// OnShutdown is called when the Wails app is shutting down.
func (c *taskController) OnShutdown(_ context.Context) {
	// Clean up if needed.
}

// CreateTask creates a new task and returns its response DTO.
func (c *taskController) CreateTask(request dto.CreateTaskRequest) (*dto.TaskResponse, error) {
	task, err := c.taskManager.CreateTask(request.RepoID, request.Tag, request.Name)
	if err != nil {
		return nil, err
	}

	return dto.TaskResponseFromEntityPtr(task), nil
}

// ListTasksByRepo returns all tasks for a given repository as response DTOs.
func (c *taskController) ListTasksByRepo(repoID string) ([]dto.TaskResponse, error) {
	tasks, err := c.taskManager.ListTasksByRepo(repoID)
	if err != nil {
		return nil, err
	}

	return dto.TaskResponseListFromEntities(tasks), nil
}

// GetTask returns a single task by ID as a response DTO.
func (c *taskController) GetTask(id string) (*dto.TaskResponse, error) {
	task, err := c.taskManager.GetTask(id)
	if err != nil {
		return nil, err
	}

	return dto.TaskResponseFromEntityPtr(task), nil
}

// DeleteTask deletes a task.
func (c *taskController) DeleteTask(id string) error {
	return c.taskManager.DeleteTask(id)
}

// ArchiveTask archives a task (soft delete).
func (c *taskController) ArchiveTask(id string) error {
	return c.taskManager.ArchiveTask(id)
}

// UnarchiveTask restores a previously archived task.
func (c *taskController) UnarchiveTask(id string) error {
	return c.taskManager.UnarchiveTask(id)
}
