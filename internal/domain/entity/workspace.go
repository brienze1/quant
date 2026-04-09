// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// Workspace represents a visual grouping of sessions, jobs, and agents.
// Switching workspaces changes what is displayed without affecting execution.
type Workspace struct {
	ID              string
	Name            string
	ClaudeConfigPath string
	McpConfigPath    string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}
