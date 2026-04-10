// Package adapter contains interfaces that application services implement.
package adapter

import "quant/internal/domain/entity"

// WorkspaceManager defines the service interface for workspace management operations.
type WorkspaceManager interface {
	CreateWorkspace(workspace entity.Workspace) (*entity.Workspace, error)
	UpdateWorkspace(workspace entity.Workspace) (*entity.Workspace, error)
	DeleteWorkspace(id string) error
	GetWorkspace(id string) (*entity.Workspace, error)
	ListWorkspaces() ([]entity.Workspace, error)
	GetCurrentWorkspace() (*entity.Workspace, error)
	SetCurrentWorkspace(id string) error
}
