// Package service contains application service implementations with business logic.
package service

import (
	"fmt"
	"time"

	"github.com/google/uuid"

	"quant/internal/application/adapter"
	"quant/internal/application/usecase"
	"quant/internal/domain/entity"
)

// taskManagerService implements the adapter.TaskManager interface.
type taskManagerService struct {
	findTask      usecase.FindTask
	saveTask      usecase.SaveTask
	deleteTask    usecase.DeleteTask
	findRepo      usecase.FindRepo
	findSession   usecase.FindSession
	deleteSession usecase.DeleteSession
}

// NewTaskManagerService creates a new TaskManager service.
func NewTaskManagerService(
	findTask usecase.FindTask,
	saveTask usecase.SaveTask,
	deleteTask usecase.DeleteTask,
	findRepo usecase.FindRepo,
	findSession usecase.FindSession,
	deleteSession usecase.DeleteSession,
) adapter.TaskManager {
	return &taskManagerService{
		findTask:      findTask,
		saveTask:      saveTask,
		deleteTask:    deleteTask,
		findRepo:      findRepo,
		findSession:   findSession,
		deleteSession: deleteSession,
	}
}

// CreateTask creates a new task within a repository.
func (s *taskManagerService) CreateTask(repoID string, tag string, name string) (*entity.Task, error) {
	repo, err := s.findRepo.FindRepoByID(repoID)
	if err != nil {
		return nil, fmt.Errorf("failed to find repo: %w", err)
	}

	if repo == nil {
		return nil, fmt.Errorf("repo not found: %s", repoID)
	}

	now := time.Now()
	task := entity.Task{
		ID:        uuid.New().String(),
		RepoID:    repoID,
		Tag:       tag,
		Name:      name,
		CreatedAt: now,
		UpdatedAt: now,
	}

	err = s.saveTask.SaveTask(task)
	if err != nil {
		return nil, fmt.Errorf("failed to save task: %w", err)
	}

	return &task, nil
}

// ListTasksByRepo returns all tasks for a given repository.
func (s *taskManagerService) ListTasksByRepo(repoID string) ([]entity.Task, error) {
	tasks, err := s.findTask.FindTasksByRepoID(repoID)
	if err != nil {
		return nil, fmt.Errorf("failed to list tasks: %w", err)
	}

	return tasks, nil
}

// GetTask returns a task by ID.
func (s *taskManagerService) GetTask(id string) (*entity.Task, error) {
	task, err := s.findTask.FindTaskByID(id)
	if err != nil {
		return nil, fmt.Errorf("failed to get task: %w", err)
	}

	if task == nil {
		return nil, fmt.Errorf("task not found: %s", id)
	}

	return task, nil
}

// DeleteTask removes a task and all its sessions by ID.
func (s *taskManagerService) DeleteTask(id string) error {
	task, err := s.findTask.FindTaskByID(id)
	if err != nil {
		return fmt.Errorf("failed to find task: %w", err)
	}

	if task == nil {
		return fmt.Errorf("task not found: %s", id)
	}

	// Delete all sessions belonging to this task first.
	sessions, err := s.findSession.FindByTaskID(id)
	if err != nil {
		return fmt.Errorf("failed to find sessions for task: %w", err)
	}

	for _, session := range sessions {
		err = s.deleteSession.Delete(session.ID)
		if err != nil {
			return fmt.Errorf("failed to delete session %s: %w", session.ID, err)
		}
	}

	err = s.deleteTask.DeleteTask(id)
	if err != nil {
		return fmt.Errorf("failed to delete task: %w", err)
	}

	return nil
}
