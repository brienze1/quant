// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// Workspace represents a visual grouping of sessions, jobs, and agents.
// Switching workspaces changes what is displayed without affecting execution.
type Workspace struct {
	ID               string
	Name             string
	ClaudeConfigPath string
	McpConfigPath    string
	// CrewCliCommand is the shell command used to launch crew worker sessions
	// created in this workspace — an alias or wrapper script, not just "claude".
	// Empty falls back to the global CLI command in settings.
	CrewCliCommand string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}
