// Package usecase contains fine-grained interfaces for persistence and external service operations.
package usecase

import (
	"quant/internal/domain/entity"
)

// FindSession defines the interface for session retrieval operations.
type FindSession interface {
	FindByID(id string) (*entity.Session, error)
	FindAll() ([]entity.Session, error)
	FindByRepoID(repoID string) ([]entity.Session, error)
	FindByTaskID(taskID string) ([]entity.Session, error)
	FindByMcpToken(token string) (*entity.Session, error)
}
