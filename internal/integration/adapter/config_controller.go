package adapter

import (
	"context"

	"quant/internal/integration/entrypoint/dto"
)

// ConfigController defines the interface for the config entrypoint controller.
// This interface is what the Wails app binds to.
type ConfigController interface {
	OnStartup(ctx context.Context)
	OnShutdown(ctx context.Context)
	GetConfig() (*dto.ConfigResponse, error)
	SaveConfig(request dto.SaveConfigRequest) error
	ResetDatabase() error
	ClearSessionLogs() error
	BrowseDirectory() (string, error)
	GetDatabasePath() string
}
