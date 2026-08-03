// Package entity contains domain entities representing core business objects.
package entity

// SessionOptions represents per-session overrides for config defaults.
// These are set via the "advanced options" in the create session modal.
type SessionOptions struct {
	UseWorktree       bool
	SkipPermissions   bool
	// AutoPull is nil when the caller did not specify it (MCP / crew), in which
	// case the config default applies.
	AutoPull          *bool
	PullBranch        string
	BranchNamePattern string
	Model             string
	ExtraCliArgs      string
	DirectoryOverride string // If set, use this directory instead of repo path
	WorkspaceID       string // Workspace to assign the session to
	NoFlicker         bool   // Enable NO_FLICKER terminal mode
	ClaudeSessionID   string // If set, adopt this existing claude CLI session (resume its conversation)
}
