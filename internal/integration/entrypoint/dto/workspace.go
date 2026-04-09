// Package dto contains data transfer objects for the entrypoint layer.
package dto

import (
	"quant/internal/domain/entity"
)

// CreateWorkspaceRequest represents the request payload for creating a new workspace.
type CreateWorkspaceRequest struct {
	Name             string `json:"name"`
	ClaudeConfigPath string `json:"claudeConfigPath"`
	McpConfigPath    string `json:"mcpConfigPath"`
}

// UpdateWorkspaceRequest represents the request payload for updating an existing workspace.
type UpdateWorkspaceRequest struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	ClaudeConfigPath string `json:"claudeConfigPath"`
	McpConfigPath    string `json:"mcpConfigPath"`
}

// WorkspaceResponse represents the response payload for workspace data.
type WorkspaceResponse struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	ClaudeConfigPath string `json:"claudeConfigPath"`
	McpConfigPath    string `json:"mcpConfigPath"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

// PathValidationResult contains the validation status for workspace config paths.
type PathValidationResult struct {
	ClaudeConfigValid bool   `json:"claudeConfigValid"`
	ClaudeConfigError string `json:"claudeConfigError"`
	McpConfigValid    bool   `json:"mcpConfigValid"`
	McpConfigError    string `json:"mcpConfigError"`
}

// WorkspaceResponseFromEntity converts a domain entity to a WorkspaceResponse DTO.
func WorkspaceResponseFromEntity(workspace entity.Workspace) WorkspaceResponse {
	return WorkspaceResponse{
		ID:               workspace.ID,
		Name:             workspace.Name,
		ClaudeConfigPath: workspace.ClaudeConfigPath,
		McpConfigPath:    workspace.McpConfigPath,
		CreatedAt:        workspace.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:        workspace.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

// WorkspaceResponseFromEntityPtr converts a domain entity pointer to a WorkspaceResponse DTO pointer.
func WorkspaceResponseFromEntityPtr(workspace *entity.Workspace) *WorkspaceResponse {
	if workspace == nil {
		return nil
	}
	response := WorkspaceResponseFromEntity(*workspace)
	return &response
}

// WorkspaceResponseListFromEntities converts a slice of domain entities to a slice of WorkspaceResponse DTOs.
func WorkspaceResponseListFromEntities(workspaces []entity.Workspace) []WorkspaceResponse {
	responses := make([]WorkspaceResponse, len(workspaces))
	for i, workspace := range workspaces {
		responses[i] = WorkspaceResponseFromEntity(workspace)
	}
	return responses
}
