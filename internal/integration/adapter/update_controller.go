package adapter

import (
	"context"

	"quant/internal/domain/entity"
)

// UpdateController defines the interface for the update entrypoint controller.
// It checks GitHub for a newer release, upgrades the app via Homebrew, and
// relaunches the app so the new version takes effect.
type UpdateController interface {
	OnStartup(ctx context.Context)
	OnShutdown(ctx context.Context)
	CheckForUpdate() (*entity.UpdateInfo, error)
	PerformUpdate() error
	Restart() error
}
