// Package service contains application service implementations with business logic.
package service

import (
	"fmt"

	"quant/internal/application/adapter"
	"quant/internal/application/usecase"
	"quant/internal/domain/entity"
)

// configManagerService implements the adapter.ConfigManager interface.
type configManagerService struct {
	loadConfig       usecase.LoadConfig
	saveConfig       usecase.SaveConfig
	resetDatabase    usecase.ResetDatabase
	clearSessionLogs usecase.ClearSessionLogs
	getDatabasePath  usecase.GetDatabasePath
}

// NewConfigManagerService creates a new ConfigManager service.
// Returns the adapter.ConfigManager interface, not the concrete type.
func NewConfigManagerService(
	loadConfig usecase.LoadConfig,
	saveConfig usecase.SaveConfig,
	resetDatabase usecase.ResetDatabase,
	clearSessionLogs usecase.ClearSessionLogs,
	getDatabasePath usecase.GetDatabasePath,
) adapter.ConfigManager {
	return &configManagerService{
		loadConfig:       loadConfig,
		saveConfig:       saveConfig,
		resetDatabase:    resetDatabase,
		clearSessionLogs: clearSessionLogs,
		getDatabasePath:  getDatabasePath,
	}
}

// GetConfig returns the current application configuration.
func (s *configManagerService) GetConfig() (*entity.Config, error) {
	cfg, err := s.loadConfig.LoadConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}

	return cfg, nil
}

// SaveConfig persists the given configuration.
func (s *configManagerService) SaveConfig(cfg *entity.Config) error {
	err := s.saveConfig.SaveConfig(cfg)
	if err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	return nil
}

// ResetDatabase truncates all database tables.
func (s *configManagerService) ResetDatabase() error {
	err := s.resetDatabase.ResetDatabase()
	if err != nil {
		return fmt.Errorf("failed to reset database: %w", err)
	}

	return nil
}

// ClearSessionLogs removes all session log files from the log directory.
func (s *configManagerService) ClearSessionLogs() error {
	err := s.clearSessionLogs.ClearSessionLogs()
	if err != nil {
		return fmt.Errorf("failed to clear session logs: %w", err)
	}

	return nil
}

// GetDatabasePath returns the file path to the database.
func (s *configManagerService) GetDatabasePath() string {
	return s.getDatabasePath.GetDatabasePath()
}
