// Package dto contains persistence data transfer objects for SQLite row mapping.
package dto

import (
	"encoding/json"
	"time"

	"quant/internal/domain/entity"
)

// WorkspaceRow represents a workspace row in the SQLite database.
type WorkspaceRow struct {
	ID               string
	Name             string
	ClaudeConfigPath string
	McpConfigPath    string
	// VoiceConfig is the JSON-encoded per-workspace voice override
	// (*entity.VoiceConfig). "" means no override (inherit the global config).
	VoiceConfig string
	CreatedAt   string
	UpdatedAt   string
}

// ToEntity converts a WorkspaceRow to a domain entity.
func (r WorkspaceRow) ToEntity() entity.Workspace {
	createdAt, _ := time.Parse(time.RFC3339, r.CreatedAt)
	updatedAt, _ := time.Parse(time.RFC3339, r.UpdatedAt)

	var voice *entity.VoiceConfig
	if r.VoiceConfig != "" {
		var vc entity.VoiceConfig
		// On a malformed blob, leave the override nil so the workspace simply
		// inherits the global config rather than failing the whole load.
		if err := json.Unmarshal([]byte(r.VoiceConfig), &vc); err == nil {
			voice = &vc
		}
	}

	return entity.Workspace{
		ID:               r.ID,
		Name:             r.Name,
		ClaudeConfigPath: r.ClaudeConfigPath,
		McpConfigPath:    r.McpConfigPath,
		Voice:            voice,
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}
}

// WorkspaceRowFromEntity converts a domain entity to a WorkspaceRow.
func WorkspaceRowFromEntity(workspace entity.Workspace) WorkspaceRow {
	voiceConfig := ""
	if workspace.Voice != nil {
		if b, err := json.Marshal(workspace.Voice); err == nil {
			voiceConfig = string(b)
		}
	}

	return WorkspaceRow{
		ID:               workspace.ID,
		Name:             workspace.Name,
		ClaudeConfigPath: workspace.ClaudeConfigPath,
		McpConfigPath:    workspace.McpConfigPath,
		VoiceConfig:      voiceConfig,
		CreatedAt:        workspace.CreatedAt.Format(time.RFC3339),
		UpdatedAt:        workspace.UpdatedAt.Format(time.RFC3339),
	}
}
