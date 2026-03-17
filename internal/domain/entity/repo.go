// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// Repo represents a git repository registered in the application.
type Repo struct {
	ID        string
	Name      string
	Path      string
	CreatedAt time.Time
	UpdatedAt time.Time
	ClosedAt  *time.Time
}
