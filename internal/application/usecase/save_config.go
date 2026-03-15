package usecase

import (
	"quant/internal/domain/entity"
)

// SaveConfig defines the interface for saving application configuration.
type SaveConfig interface {
	SaveConfig(cfg *entity.Config) error
}
