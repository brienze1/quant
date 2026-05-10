package usecase

import (
	"quant/internal/domain/entity"
)

// FindRepo defines the interface for repo retrieval operations.
type FindRepo interface {
	FindRepoByID(id string) (*entity.Repo, error)
	FindRepoByPathAndWorkspace(path string, workspaceID string) (*entity.Repo, error)
	FindAllRepos() ([]entity.Repo, error)
	FindReposByWorkspace(workspaceID string) ([]entity.Repo, error)
	FindClosedReposByWorkspace(workspaceID string, limit int, offset int) ([]entity.Repo, error)
}
