// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// Task represents a unit of work within a repository.
type Task struct {
	ID     string
	RepoID string
	Tag    string
	Name   string
	// SortOrder is the manual position of the task within its repository.
	// Lower values sort first; ties fall back to creation time (newest first).
	SortOrder  int
	CreatedAt  time.Time
	UpdatedAt  time.Time
	ArchivedAt *time.Time
}
