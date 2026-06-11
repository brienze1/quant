package entity

import (
	"time"
)

// ExternalClaudeSession represents a claude CLI session found on disk
// (under ~/.claude/projects) that is not yet attached to a quant session.
type ExternalClaudeSession struct {
	ID           string
	Cwd          string
	FirstMessage string
	ModTime      time.Time
	SizeBytes    int64
}
