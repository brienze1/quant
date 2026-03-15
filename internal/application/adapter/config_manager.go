// Package adapter contains interfaces that application services implement.
package adapter

import (
	"quant/internal/domain/entity"
)

// ConfigManager defines the service interface for configuration management operations.
// This is the application adapter that the configManagerService implements.
type ConfigManager interface {
	GetConfig() (*entity.Config, error)
	SaveConfig(cfg *entity.Config) error
	ResetDatabase() error
	ClearSessionLogs() error
	GetDatabasePath() string
}
