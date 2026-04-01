package usecase

import (
	"quant/internal/domain/entity"
)

// FindAgent defines the interface for agent retrieval operations.
type FindAgent interface {
	FindAgentByID(id string) (*entity.Agent, error)
	FindAllAgents() ([]entity.Agent, error)
}
