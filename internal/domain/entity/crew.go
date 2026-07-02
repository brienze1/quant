// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// CrewAssignment represents a worker→supervisor edge in the crew tree.
type CrewAssignment struct {
	WorkerSessionID     string
	SupervisorSessionID string
	CreatedAt           time.Time
}

// CrewEnvelope represents a report queued from a worker to its supervisor.
type CrewEnvelope struct {
	ID            string
	FromSessionID string
	ToSessionID   string
	Type          string
	Summary       string
	Status        string
	CreatedAt     time.Time
	DeliveredAt   *time.Time
}

// CrewWatchdog represents a deadline by which a worker is expected to report.
type CrewWatchdog struct {
	ID                  string
	WorkerSessionID     string
	SupervisorSessionID string
	ExpectedBy          time.Time
	Fired               bool
	CreatedAt           time.Time
}
