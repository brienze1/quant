package adapter

import (
	"context"

	"quant/internal/integration/entrypoint/dto"
)

// RepoController defines the interface for the repo entrypoint controller.
// This interface is what the Wails app binds to.
type RepoController interface {
	OnStartup(ctx context.Context)
	OnShutdown(ctx context.Context)
	BrowseDirectory() (string, error)
	OpenRepo(request dto.CreateRepoRequest) (*dto.RepoResponse, error)
	ListReposByWorkspace(workspaceID string) ([]dto.RepoResponse, error)
	ListClosedReposByWorkspace(workspaceID string, limit int, offset int) ([]dto.RepoResponse, error)
	GetRepo(id string) (*dto.RepoResponse, error)
	RemoveRepo(id string) error
	OpenInTerminal(path string) error
	OpenInFinder(path string) error
}
