package adapter

import (
	"context"

	"quant/internal/domain/entity"
)

// ChangelogController defines the interface for the changelog entrypoint controller.
type ChangelogController interface {
	OnStartup(ctx context.Context)
	OnShutdown(ctx context.Context)
	GetChangelog() (*entity.Changelog, error)
	GetVersion() string
}
