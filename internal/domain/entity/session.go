// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// Session represents a Claude Code working session.
type Session struct {
	ID              string
	Name            string
	Description     string
	Status          string
	Directory       string
	WorktreePath    string
	BranchName      string
	ClaudeConvID    string
	PID             int
	RepoID          string
	TaskID          string
	SkipPermissions bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
	LastActiveAt    time.Time
	ArchivedAt      *time.Time
}
