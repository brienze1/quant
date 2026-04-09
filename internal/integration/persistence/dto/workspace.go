// Package dto contains persistence data transfer objects for SQLite row mapping.
package dto

import (
	"time"

	"quant/internal/domain/entity"
)

// WorkspaceRow represents a workspace row in the SQLite database.
type WorkspaceRow struct {
	ID               string
	Name             string
	ClaudeConfigPath string
	McpConfigPath    string
	CreatedAt        string
	UpdatedAt        string
}

// ToEntity converts a WorkspaceRow to a domain entity.
func (r WorkspaceRow) ToEntity() entity.Workspace {
	createdAt, _ := time.Parse(time.RFC3339, r.CreatedAt)
	updatedAt, _ := time.Parse(time.RFC3339, r.UpdatedAt)

	return entity.Workspace{
		ID:               r.ID,
		Name:             r.Name,
		ClaudeConfigPath: r.ClaudeConfigPath,
		McpConfigPath:    r.McpConfigPath,
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}
}

// WorkspaceRowFromEntity converts a domain entity to a WorkspaceRow.
func WorkspaceRowFromEntity(workspace entity.Workspace) WorkspaceRow {
	return WorkspaceRow{
		ID:               workspace.ID,
		Name:             workspace.Name,
		ClaudeConfigPath: workspace.ClaudeConfigPath,
		McpConfigPath:    workspace.McpConfigPath,
		CreatedAt:        workspace.CreatedAt.Format(time.RFC3339),
		UpdatedAt:        workspace.UpdatedAt.Format(time.RFC3339),
	}
}
