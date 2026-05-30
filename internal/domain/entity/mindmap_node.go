// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// MindmapNode represents a single node in a scoped mindmap.
type MindmapNode struct {
	ID        string
	ScopeType string
	ScopeID   string
	Board     string
	ParentID  string
	Kind      string
	Label     string
	Text      string
	Status    string
	Note      string
	Progress  int
	SortOrder int
	CreatedAt time.Time
	UpdatedAt time.Time
}
