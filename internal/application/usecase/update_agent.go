package usecase

import (
	"quant/internal/domain/entity"
)

// UpdateAgent defines the interface for updating an existing agent.
type UpdateAgent interface {
	UpdateAgent(agent entity.Agent) error
}
