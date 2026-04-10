// Package service contains application service implementations.
package service

import (
	"fmt"
	"time"

	"github.com/google/uuid"

	"quant/internal/application/adapter"
	"quant/internal/application/usecase"
	"quant/internal/domain/entity"
)

// workspaceManagerService implements the adapter.WorkspaceManager interface.
type workspaceManagerService struct {
	findWorkspace   usecase.FindWorkspace
	saveWorkspace   usecase.SaveWorkspace
	updateWorkspace usecase.UpdateWorkspace
	deleteWorkspace usecase.DeleteWorkspace
	configManager   adapter.ConfigManager
}

// NewWorkspaceManagerService creates a new workspace manager service.
func NewWorkspaceManagerService(
	findWorkspace usecase.FindWorkspace,
	saveWorkspace usecase.SaveWorkspace,
	updateWorkspace usecase.UpdateWorkspace,
	deleteWorkspace usecase.DeleteWorkspace,
	configManager adapter.ConfigManager,
) adapter.WorkspaceManager {
	return &workspaceManagerService{
		findWorkspace:   findWorkspace,
		saveWorkspace:   saveWorkspace,
		updateWorkspace: updateWorkspace,
		deleteWorkspace: deleteWorkspace,
		configManager:   configManager,
	}
}

// CreateWorkspace creates a new workspace with a generated ID and timestamps.
func (s *workspaceManagerService) CreateWorkspace(workspace entity.Workspace) (*entity.Workspace, error) {
	now := time.Now()
	workspace.ID = uuid.New().String()
	workspace.CreatedAt = now
	workspace.UpdatedAt = now

	if err := s.saveWorkspace.SaveWorkspace(workspace); err != nil {
		return nil, fmt.Errorf("failed to create workspace: %w", err)
	}

	return &workspace, nil
}

// UpdateWorkspace updates an existing workspace.
func (s *workspaceManagerService) UpdateWorkspace(workspace entity.Workspace) (*entity.Workspace, error) {
	existing, err := s.findWorkspace.FindWorkspaceByID(workspace.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to find workspace: %w", err)
	}
	if existing == nil {
		return nil, fmt.Errorf("workspace not found: %s", workspace.ID)
	}

	workspace.CreatedAt = existing.CreatedAt
	workspace.UpdatedAt = time.Now()

	if err := s.updateWorkspace.UpdateWorkspace(workspace); err != nil {
		return nil, fmt.Errorf("failed to update workspace: %w", err)
	}

	return &workspace, nil
}

// DeleteWorkspace deletes a workspace by ID.
func (s *workspaceManagerService) DeleteWorkspace(id string) error {
	return s.deleteWorkspace.DeleteWorkspace(id)
}

// GetWorkspace retrieves a workspace by ID.
func (s *workspaceManagerService) GetWorkspace(id string) (*entity.Workspace, error) {
	return s.findWorkspace.FindWorkspaceByID(id)
}

// ListWorkspaces retrieves all workspaces.
func (s *workspaceManagerService) ListWorkspaces() ([]entity.Workspace, error) {
	return s.findWorkspace.FindAllWorkspaces()
}

// GetCurrentWorkspace returns the currently active workspace.
func (s *workspaceManagerService) GetCurrentWorkspace() (*entity.Workspace, error) {
	cfg, err := s.configManager.GetConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}

	wsID := cfg.CurrentWorkspaceID
	if wsID == "" {
		wsID = "default"
	}

	ws, err := s.findWorkspace.FindWorkspaceByID(wsID)
	if err != nil {
		return nil, fmt.Errorf("failed to find workspace: %w", err)
	}
	if ws == nil {
		return nil, fmt.Errorf("current workspace not found: %s", wsID)
	}

	return ws, nil
}

// SetCurrentWorkspace sets the currently active workspace by ID.
func (s *workspaceManagerService) SetCurrentWorkspace(id string) error {
	// Verify workspace exists
	ws, err := s.findWorkspace.FindWorkspaceByID(id)
	if err != nil {
		return fmt.Errorf("failed to find workspace: %w", err)
	}
	if ws == nil {
		return fmt.Errorf("workspace not found: %s", id)
	}

	cfg, err := s.configManager.GetConfig()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	cfg.CurrentWorkspaceID = id
	if err := s.configManager.SaveConfig(cfg); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	return nil
}
