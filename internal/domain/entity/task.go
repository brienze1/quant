// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// Task represents a unit of work within a repository.
type Task struct {
	ID        string
	RepoID    string
	Tag       string
	Name      string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	ArchivedAt *time.Time
}
