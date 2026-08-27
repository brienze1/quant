// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// Repo represents a git repository registered in the application.
type Repo struct {
	ID          string
	Name        string
	Path        string
	WorkspaceID string
	// SortOrder is the manual position of the repo within its workspace.
	// Lower values sort first; ties fall back to creation time (newest first).
	SortOrder int
	CreatedAt time.Time
	UpdatedAt time.Time
	ClosedAt  *time.Time
}
