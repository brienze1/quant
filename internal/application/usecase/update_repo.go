package usecase

import (
	"quant/internal/domain/entity"
)

// UpdateRepo defines the interface for repo update operations.
type UpdateRepo interface {
	UpdateRepo(repo entity.Repo) error
	ReopenRepo(id string, name string) error
}
