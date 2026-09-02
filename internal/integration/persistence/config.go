// Package persistence contains persistence implementations.
package persistence

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"quant/internal/domain/entity"
	"quant/internal/infra/paths"
	"quant/internal/integration/adapter"
)

// configPersistence implements the adapter.ConfigPersistence interface using a JSON file.
//
// Reads are cached against the file's modification time and size. The config is
// consulted on hot paths — the crew drainer reads it every second, and every
// session spawn and MCP call reads it too — so re-reading and re-parsing the
// JSON each time was pure overhead. An edit made outside the app still lands,
// because the stat is what decides.
type configPersistence struct {
	filePath string

	mu         sync.Mutex
	cached     *entity.Config
	cachedMod  time.Time
	cachedSize int64
}

// NewConfigPersistence creates a new JSON file config persistence implementation.
// Returns the adapter.ConfigPersistence interface, not the concrete type.
func NewConfigPersistence() adapter.ConfigPersistence {
	// Honor QUANT_HOME (via paths) so isolated instances / tests don't share the
	// real ~/.quant/config.json — matching the database path resolution.
	return &configPersistence{
		filePath: filepath.Join(paths.QuantHome(), "config.json"),
	}
}

// LoadConfig reads the configuration from the JSON file.
// If the file does not exist, it returns a default configuration and persists it.
func (p *configPersistence) LoadConfig() (*entity.Config, error) {
	if cfg := p.fromCache(); cfg != nil {
		return cfg, nil
	}

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

	p.remember(&cfg)

	return &cfg, nil
}

// fromCache returns a copy of the cached config when the file on disk still
// matches what was cached. A copy, because callers are free to mutate what they
// get back (the settings screen loads, edits and saves).
func (p *configPersistence) fromCache() *entity.Config {
	info, err := os.Stat(p.filePath)
	if err != nil {
		return nil
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if p.cached == nil || !info.ModTime().Equal(p.cachedMod) || info.Size() != p.cachedSize {
		return nil
	}

	cfg := cloneConfig(*p.cached)
	return &cfg
}

// remember caches a freshly parsed config against the file it came from.
func (p *configPersistence) remember(cfg *entity.Config) {
	info, err := os.Stat(p.filePath)
	if err != nil {
		return
	}

	stored := cloneConfig(*cfg)

	p.mu.Lock()
	p.cached, p.cachedMod, p.cachedSize = &stored, info.ModTime(), info.Size()
	p.mu.Unlock()
}

// cloneConfig deep-copies the parts of a config a caller could mutate in place,
// so a cached config can never be edited through the copy handed out.
func cloneConfig(cfg entity.Config) entity.Config {
	cfg.BranchOverrides = maps.Clone(cfg.BranchOverrides)
	cfg.EnvVariables = maps.Clone(cfg.EnvVariables)
	cfg.CommandOverrides = maps.Clone(cfg.CommandOverrides)
	cfg.Shortcuts = slices.Clone(cfg.Shortcuts)
	cfg.OpenSessionIDs = slices.Clone(cfg.OpenSessionIDs)
	cfg.Voice.LangVoices = maps.Clone(cfg.Voice.LangVoices)
	return cfg
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

	p.remember(cfg)

	return nil
}
