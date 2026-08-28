// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// Session messaging modes. A session always sends; the mode decides whether it
// also accepts incoming messages from other sessions.
const (
	// MessagingBoth accepts incoming messages as well as sending. Default.
	MessagingBoth = "both"
	// MessagingOut sends only: other sessions cannot message this one.
	MessagingOut = "out"
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
	// MessagingMode controls session-to-session messaging for this session:
	// MessagingBoth (send and receive) or MessagingOut (send only — other
	// sessions cannot message it). Empty means MessagingBoth.
	MessagingMode string
	// MessagingPeers is the allowlist of session IDs this session may message.
	// Empty means every session is allowed, which is the default.
	MessagingPeers []string
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

// AcceptsMessages reports whether other sessions may send input to this one.
func (s Session) AcceptsMessages() bool {
	return s.MessagingMode != MessagingOut
}

// MayMessage reports whether this session is allowed to send to targetID. An
// empty allowlist means every session is allowed, which is the default.
func (s Session) MayMessage(targetID string) bool {
	if len(s.MessagingPeers) == 0 {
		return true
	}
	for _, id := range s.MessagingPeers {
		if id == targetID {
			return true
		}
	}
	return false
}
