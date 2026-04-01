// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// Agent represents a configurable AI agent persona linked to jobs.
// Agents define identity, access, boundaries, and skills for Claude execution.
type Agent struct {
	ID             string
	Name           string
	Color          string            // hex color for UI (e.g., "#10B981")
	Role           string            // max 200 chars — who they are, identity/tone
	Goal           string            // max 200 chars — success criteria
	Model          string            // e.g., "claude-opus-4-6"
	AutonomousMode bool              // default true — executes without stopping to ask
	McpServers     map[string]bool   // server name → enabled
	EnvVariables   map[string]string // private env vars/secrets
	Boundaries     []string          // anti-prompt rules
	Skills         map[string]bool   // skill name → enabled
	CreatedAt      time.Time
	UpdatedAt      time.Time
}
