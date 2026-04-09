package adapter

import (
	"context"

	"quant/internal/integration/entrypoint/dto"
)

// WorkspaceController defines the interface for the workspace entrypoint controller.
// This interface is what the Wails app binds to.
type WorkspaceController interface {
	OnStartup(ctx context.Context)
	OnShutdown(ctx context.Context)
	CreateWorkspace(request dto.CreateWorkspaceRequest) (*dto.WorkspaceResponse, error)
	UpdateWorkspace(request dto.UpdateWorkspaceRequest) (*dto.WorkspaceResponse, error)
	DeleteWorkspace(id string) error
	GetWorkspace(id string) (*dto.WorkspaceResponse, error)
	ListWorkspaces() ([]dto.WorkspaceResponse, error)
	BrowseClaudeConfigDir() (string, error)
	BrowseMcpConfigFile() (string, error)
	ValidatePaths(claudeRoot string, mcpRoot string) dto.PathValidationResult
}
