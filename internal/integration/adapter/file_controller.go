package adapter

import (
	"context"

	"quant/internal/integration/entrypoint/dto"
)

// FileController defines the interface for the sandboxed file entrypoint controller.
type FileController interface {
	OnStartup(ctx context.Context)
	OnShutdown(ctx context.Context)
	ListDir(sessionID, relPath string) ([]dto.FileEntryResponse, error)
	ReadFile(sessionID, relPath string) (dto.FileContentResponse, error)
	WriteFile(sessionID, relPath, content string) error
	CreateFile(sessionID, relPath string) error
	CreateDir(sessionID, relPath string) error
	RenamePath(sessionID, oldRelPath, newRelPath string) error
	DeletePath(sessionID, relPath string, recursive bool) error
}
