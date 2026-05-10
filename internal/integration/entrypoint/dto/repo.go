// Package dto contains data transfer objects for the entrypoint layer.
package dto

import (
	"quant/internal/domain/entity"
)

// CreateRepoRequest represents the request payload for registering a new repository.
type CreateRepoRequest struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	WorkspaceID string `json:"workspaceId"`
}

// RepoResponse represents the response payload for repository data.
type RepoResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	WorkspaceID string `json:"workspaceId"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
	ClosedAt    string `json:"closedAt,omitempty"`
}

// RepoResponseFromEntity converts a domain entity to a RepoResponse DTO.
func RepoResponseFromEntity(repo entity.Repo) RepoResponse {
	resp := RepoResponse{
		ID:          repo.ID,
		Name:        repo.Name,
		Path:        repo.Path,
		WorkspaceID: repo.WorkspaceID,
		CreatedAt:   repo.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   repo.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
	if repo.ClosedAt != nil {
		resp.ClosedAt = repo.ClosedAt.Format("2006-01-02T15:04:05Z07:00")
	}
	return resp
}

// RepoResponseFromEntityPtr converts a domain entity pointer to a RepoResponse DTO pointer.
func RepoResponseFromEntityPtr(repo *entity.Repo) *RepoResponse {
	if repo == nil {
		return nil
	}
	response := RepoResponseFromEntity(*repo)
	return &response
}

// RepoResponseListFromEntities converts a slice of domain entities to a slice of RepoResponse DTOs.
func RepoResponseListFromEntities(repos []entity.Repo) []RepoResponse {
	responses := make([]RepoResponse, len(repos))
	for i, repo := range repos {
		responses[i] = RepoResponseFromEntity(repo)
	}
	return responses
}
