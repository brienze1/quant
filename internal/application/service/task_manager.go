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
	updateTask    usecase.UpdateTask
	findRepo      usecase.FindRepo
	findSession   usecase.FindSession
	updateSession usecase.UpdateSession
	deleteSession usecase.DeleteSession
}

// NewTaskManagerService creates a new TaskManager service.
func NewTaskManagerService(
	findTask usecase.FindTask,
	saveTask usecase.SaveTask,
	deleteTask usecase.DeleteTask,
	updateTask usecase.UpdateTask,
	findRepo usecase.FindRepo,
	findSession usecase.FindSession,
	updateSession usecase.UpdateSession,
	deleteSession usecase.DeleteSession,
) adapter.TaskManager {
	return &taskManagerService{
		findTask:      findTask,
		saveTask:      saveTask,
		deleteTask:    deleteTask,
		updateTask:    updateTask,
		findRepo:      findRepo,
		findSession:   findSession,
		updateSession: updateSession,
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

	// New tasks land at the top of the repo's ladder, matching the
	// newest-first ordering used before manual sorting existed.
	existing, err := s.findTask.FindTasksByRepoID(repoID)
	if err != nil {
		return nil, fmt.Errorf("failed to list tasks: %w", err)
	}

	sortOrder := 0
	for _, t := range existing {
		if t.SortOrder <= sortOrder {
			sortOrder = t.SortOrder - 1
		}
	}

	now := time.Now()
	task := entity.Task{
		ID:        uuid.New().String(),
		RepoID:    repoID,
		Tag:       tag,
		Name:      name,
		SortOrder: sortOrder,
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

// ReorderTasks rewrites the manual ordering of a repository's tasks.
// orderedTaskIDs lists task IDs top to bottom; every ID must belong to repoID,
// which keeps drag-and-drop reordering locked to a single repository. Tasks of
// the repo missing from the list keep their relative order below the listed ones.
func (s *taskManagerService) ReorderTasks(repoID string, orderedTaskIDs []string) error {
	tasks, err := s.findTask.FindTasksByRepoID(repoID)
	if err != nil {
		return fmt.Errorf("failed to list tasks: %w", err)
	}

	byID := make(map[string]entity.Task, len(tasks))
	for _, task := range tasks {
		byID[task.ID] = task
	}

	ordered := make([]entity.Task, 0, len(tasks))
	seen := make(map[string]bool, len(orderedTaskIDs))
	for _, id := range orderedTaskIDs {
		task, ok := byID[id]
		if !ok {
			return fmt.Errorf("task does not belong to repo %s: %s", repoID, id)
		}
		if seen[id] {
			return fmt.Errorf("duplicate task in order: %s", id)
		}
		seen[id] = true
		ordered = append(ordered, task)
	}

	// FindTasksByRepoID already returns tasks in display order, so appending
	// the unlisted ones preserves their relative positions.
	for _, task := range tasks {
		if !seen[task.ID] {
			ordered = append(ordered, task)
		}
	}

	now := time.Now()
	for i, task := range ordered {
		if task.SortOrder == i {
			continue
		}
		task.SortOrder = i
		task.UpdatedAt = now
		if err := s.updateTask.UpdateTask(task); err != nil {
			return fmt.Errorf("failed to reorder task %s: %w", task.ID, err)
		}
	}

	return nil
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

// ArchiveTask soft-deletes a task and all its sessions.
func (s *taskManagerService) ArchiveTask(id string) error {
	task, err := s.findTask.FindTaskByID(id)
	if err != nil {
		return fmt.Errorf("failed to find task: %w", err)
	}

	if task == nil {
		return fmt.Errorf("task not found: %s", id)
	}

	now := time.Now()

	// Archive all sessions belonging to this task.
	sessions, err := s.findSession.FindByTaskID(id)
	if err != nil {
		return fmt.Errorf("failed to find sessions for task: %w", err)
	}

	for _, session := range sessions {
		if session.ArchivedAt == nil {
			session.ArchivedAt = &now
			session.UpdatedAt = now
			if err := s.updateSession.Update(session); err != nil {
				return fmt.Errorf("failed to archive session %s: %w", session.ID, err)
			}
		}
	}

	task.ArchivedAt = &now
	task.UpdatedAt = now

	return s.updateTask.UpdateTask(*task)
}

// UnarchiveTask restores a previously archived task and its sessions.
func (s *taskManagerService) UnarchiveTask(id string) error {
	task, err := s.findTask.FindTaskByID(id)
	if err != nil {
		return fmt.Errorf("failed to find task: %w", err)
	}

	if task == nil {
		return fmt.Errorf("task not found: %s", id)
	}

	// Unarchive all sessions belonging to this task.
	sessions, err := s.findSession.FindByTaskID(id)
	if err != nil {
		return fmt.Errorf("failed to find sessions for task: %w", err)
	}

	for _, session := range sessions {
		if session.ArchivedAt != nil {
			session.ArchivedAt = nil
			session.UpdatedAt = time.Now()
			if err := s.updateSession.Update(session); err != nil {
				return fmt.Errorf("failed to unarchive session %s: %w", session.ID, err)
			}
		}
	}

	task.ArchivedAt = nil
	task.UpdatedAt = time.Now()

	return s.updateTask.UpdateTask(*task)
}

// RenameTask updates the tag and name of a task.
func (s *taskManagerService) RenameTask(id string, newTag string, newName string) error {
	task, err := s.findTask.FindTaskByID(id)
	if err != nil {
		return fmt.Errorf("failed to find task: %w", err)
	}

	if task == nil {
		return fmt.Errorf("task not found: %s", id)
	}

	task.Tag = newTag
	task.Name = newName
	task.UpdatedAt = time.Now()

	return s.updateTask.UpdateTask(*task)
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
