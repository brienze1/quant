// Package entity contains domain entities representing core business objects.
package entity

// SessionOptions represents per-session overrides for config defaults.
// These are set via the "advanced options" in the create session modal.
type SessionOptions struct {
	UseWorktree       bool
	SkipPermissions   bool
	AutoPull          bool
	PullBranch        string
	BranchNamePattern string
	Model             string
	ExtraCliArgs      string
	DirectoryOverride string // If set, use this directory instead of repo path
}
