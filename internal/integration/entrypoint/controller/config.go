// Package controller contains entrypoint controllers bound to the Wails runtime.
package controller

import (
	"context"

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
}

// NewConfigController creates a new config controller.
// Returns the intadapter.ConfigController interface, not the concrete type.
func NewConfigController(configManager adapter.ConfigManager) intadapter.ConfigController {
	return &configController{
		configManager: configManager,
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
