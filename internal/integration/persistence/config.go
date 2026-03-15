// Package persistence contains persistence implementations.
package persistence

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"quant/internal/domain/entity"
	"quant/internal/integration/adapter"
)

// configPersistence implements the adapter.ConfigPersistence interface using a JSON file.
type configPersistence struct {
	filePath string
}

// NewConfigPersistence creates a new JSON file config persistence implementation.
// Returns the adapter.ConfigPersistence interface, not the concrete type.
func NewConfigPersistence() adapter.ConfigPersistence {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}

	return &configPersistence{
		filePath: filepath.Join(homeDir, ".quant", "config.json"),
	}
}

// LoadConfig reads the configuration from the JSON file.
// If the file does not exist, it returns a default configuration and persists it.
func (p *configPersistence) LoadConfig() (*entity.Config, error) {
	data, err := os.ReadFile(p.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			cfg := entity.NewDefaultConfig()
			saveErr := p.SaveConfig(&cfg)
			if saveErr != nil {
				return nil, fmt.Errorf("failed to save default config: %w", saveErr)
			}
			return &cfg, nil
		}
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	cfg := entity.NewDefaultConfig()
	err = json.Unmarshal(data, &cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	return &cfg, nil
}

// SaveConfig writes the configuration to the JSON file.
func (p *configPersistence) SaveConfig(cfg *entity.Config) error {
	dir := filepath.Dir(p.filePath)
	err := os.MkdirAll(dir, 0755)
	if err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	err = os.WriteFile(p.filePath, data, 0644)
	if err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}

	return nil
}
