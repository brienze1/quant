package usecase

import (
	"quant/internal/domain/entity"
)

// LoadConfig defines the interface for loading application configuration.
type LoadConfig interface {
	LoadConfig() (*entity.Config, error)
}
