// Package dto contains data transfer objects for the entrypoint layer.
package dto

import (
	"quant/internal/domain/entity"
)

// CreateTaskRequest represents the request payload for creating a new task.
type CreateTaskRequest struct {
	RepoID string `json:"repoId"`
	Tag    string `json:"tag"`
	Name   string `json:"name"`
}

// TaskResponse represents the response payload for task data.
type TaskResponse struct {
	ID         string `json:"id"`
	RepoID     string `json:"repoId"`
	Tag        string `json:"tag"`
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
	ArchivedAt string `json:"archivedAt"`
}

// TaskResponseFromEntity converts a domain entity to a TaskResponse DTO.
func TaskResponseFromEntity(task entity.Task) TaskResponse {
	var archivedAt string
	if task.ArchivedAt != nil {
		archivedAt = task.ArchivedAt.Format("2006-01-02T15:04:05Z07:00")
	}

	return TaskResponse{
		ID:         task.ID,
		RepoID:     task.RepoID,
		Tag:        task.Tag,
		Name:       task.Name,
		CreatedAt:  task.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:  task.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		ArchivedAt: archivedAt,
	}
}

// TaskResponseFromEntityPtr converts a domain entity pointer to a TaskResponse DTO pointer.
func TaskResponseFromEntityPtr(task *entity.Task) *TaskResponse {
	if task == nil {
		return nil
	}
	response := TaskResponseFromEntity(*task)
	return &response
}

// TaskResponseListFromEntities converts a slice of domain entities to a slice of TaskResponse DTOs.
func TaskResponseListFromEntities(tasks []entity.Task) []TaskResponse {
	responses := make([]TaskResponse, len(tasks))
	for i, task := range tasks {
		responses[i] = TaskResponseFromEntity(task)
	}
	return responses
}
