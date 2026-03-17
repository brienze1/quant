package usecase

import (
	"quant/internal/domain/entity"
)

// FindRepo defines the interface for repo retrieval operations.
type FindRepo interface {
	FindRepoByID(id string) (*entity.Repo, error)
	FindRepoByPath(path string) (*entity.Repo, error)
	FindAllRepos() ([]entity.Repo, error)
}
