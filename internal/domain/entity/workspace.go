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
	// Voice is an optional per-workspace voice override. nil means inherit the
	// global voice config (entity.Config.Voice) unchanged. When non-nil it
	// overrides the global config field-by-field (see ResolveVoiceConfig): empty
	// string / zero-value fields still fall back to the global default, so a
	// workspace can tweak just one or two fields without restating the rest.
	Voice *VoiceConfig
}
