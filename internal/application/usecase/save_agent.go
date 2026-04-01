package usecase

import (
	"quant/internal/domain/entity"
)

// SaveAgent defines the interface for persisting a new agent.
type SaveAgent interface {
	SaveAgent(agent entity.Agent) error
}
