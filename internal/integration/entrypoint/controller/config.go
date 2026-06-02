// Package controller contains entrypoint controllers bound to the Wails runtime.
package controller

import (
	"context"
	"fmt"
	"os"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"quant/internal/application/adapter"
	intadapter "quant/internal/integration/adapter"
	"quant/internal/integration/entrypoint/dto"
)

// configController implements the integration adapter.ConfigController interface.
// It is bound to the Wails runtime and exposes configuration management operations to the frontend.
type configController struct {
	ctx           context.Context
	configManager adapter.ConfigManager
	emitter       adapter.EventEmitter
}

// NewConfigController creates a new config controller.
// Returns the intadapter.ConfigController interface, not the concrete type.
func NewConfigController(configManager adapter.ConfigManager, emitter adapter.EventEmitter) intadapter.ConfigController {
	return &configController{
		configManager: configManager,
		emitter:       emitter,
	}
}

// OnStartup is called when the Wails app starts. The context is saved for runtime method calls.
func (c *configController) OnStartup(ctx context.Context) {
	c.ctx = ctx
}

// OnShutdown is called when the Wails app is shutting down.
func (c *configController) OnShutdown(_ context.Context) {
	// Clean up if needed.
}

// GetConfig returns the current configuration as a response DTO.
func (c *configController) GetConfig() (*dto.ConfigResponse, error) {
	cfg, err := c.configManager.GetConfig()
	if err != nil {
		return nil, err
	}

	return dto.ConfigResponseFromEntityPtr(cfg), nil
}

// SaveConfig persists the given configuration from the request DTO.
func (c *configController) SaveConfig(request dto.SaveConfigRequest) error {
	cfg := request.ToEntity()
	return c.configManager.SaveConfig(&cfg)
}

// SetMindmapPaneOpen persists the global mindmap pane open/close flag and broadcasts
// the change to all clients via the "mindmap:pane" event so they stay in sync.
func (c *configController) SetMindmapPaneOpen(open bool) error {
	cfg, err := c.configManager.GetConfig()
	if err != nil {
		return err
	}

	cfg.MindmapPaneOpen = open
	if err := c.configManager.SaveConfig(cfg); err != nil {
		return err
	}

	if c.emitter != nil {
		c.emitter.Emit("mindmap:pane", map[string]any{"open": open})
	}

	return nil
}

// ResetDatabase truncates all database tables.
func (c *configController) ResetDatabase() error {
	return c.configManager.ResetDatabase()
}

// ClearSessionLogs removes all session log files.
func (c *configController) ClearSessionLogs() error {
	return c.configManager.ClearSessionLogs()
}

// BrowseDirectory opens a native directory picker dialog and returns the selected path.
func (c *configController) BrowseDirectory() (string, error) {
	path, err := wailsRuntime.OpenDirectoryDialog(c.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select Directory",
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// GetDatabasePath returns the file path to the database.
func (c *configController) GetDatabasePath() string {
	return c.configManager.GetDatabasePath()
}

// SendNotification sends a system notification with the given title and message.
func (c *configController) SendNotification(title, message string) error {
	return c.configManager.SendNotification(title, message)
}

// GetQuantiFile reads a Quanti file by name (e.g. "CLAUDE.md", "short_term.md").
// Files live in ~/.quant/quanti/ or ~/.quant/quanti/memory/.
func (c *configController) GetQuantiFile(name string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	path := resolveQuantiPath(homeDir, name)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("failed to read file: %w", err)
	}
	return string(data), nil
}

// SaveQuantiFile writes content to a Quanti file by name.
func (c *configController) SaveQuantiFile(name string, content string) error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}
	path := resolveQuantiPath(homeDir, name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}
	return nil
}

// resolveQuantiPath maps a file name to its full path within ~/.quant/quanti/.
func resolveQuantiPath(homeDir, name string) string {
	base := homeDir + "/.quant/quanti"
	switch name {
	case "short_term.md", "medium_term.md", "long_term.md":
		return base + "/memory/" + name
	default:
		return base + "/" + name
	}
}
