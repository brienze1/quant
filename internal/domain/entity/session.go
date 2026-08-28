// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// Session represents a working session (Claude or terminal).
type Session struct {
	ID              string
	Name            string
	Description     string
	SessionType     string // "claude" or "terminal"
	Status          string
	Directory       string
	WorktreePath    string
	BranchName      string
	ClaudeConvID    string
	PID             int
	RepoID          string
	TaskID          string
	SkipPermissions bool
	Model           string
	ExtraCliArgs    string
	WorkspaceID     string
	NoFlicker       bool
	// CliCommand overrides the shell command used to launch this session's CLI.
	// Empty means resolve it the usual way (path overrides, then the global
	// setting). Crew workers record the command they were created with here.
	CliCommand string
	// SortOrder is the manual position of the session within its task. Lower
	// values sort first; 0 means "not manually placed" and leaves the session
	// in the default alphabetical order.
	SortOrder    int
	CreatedAt    time.Time
	UpdatedAt    time.Time
	LastActiveAt time.Time
	ArchivedAt   *time.Time
}
