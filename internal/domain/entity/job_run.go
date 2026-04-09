// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// JobRun represents a single execution of a job.
type JobRun struct {
	ID           string
	JobID        string
	Status        string // pending, running, success, failed, cancelled, timed_out, waiting
	TriggeredBy   string // run ID that triggered this run (empty if manual/scheduled)
	CorrelationID string // groups all runs in the same pipeline execution
	SessionID    string // linked Claude session ID (for claude-type jobs)
	ModelUsed    string // actual model that ran (from stream-json result event)
	DurationMs   int64
	TokensUsed   int
	Result          string
	ErrorMessage    string
	InjectedContext string // context injected via trigger, resume, or pipeline advance
	StartedAt       time.Time
	FinishedAt   *time.Time
}
