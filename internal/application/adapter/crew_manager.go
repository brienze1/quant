// Package adapter contains interfaces that application services implement.
package adapter

import (
	"time"

	"quant/internal/domain/entity"
)

// CrewDispatchOptions carries the optional parameters for dispatching work to a crew worker.
type CrewDispatchOptions struct {
	SessionID         string
	Name              string
	RepoID            string
	TaskID            string
	UseWorktree       bool
	Model             string
	SkipPermissions   bool
	ExpectedByMinutes int
}

// CrewDispatchResult describes what a crew dispatch did.
type CrewDispatchResult struct {
	WorkerSessionID string
	WorkerName      string
	Created         bool
	Started         bool
	PromptDelivered bool
	WatchdogSet     bool
	AdoptedBy       string
}

// CrewManager defines the service interface for crew orchestration operations.
type CrewManager interface {
	AssignWorker(workerSessionID, supervisorSessionID string) error
	UnassignWorker(workerSessionID string) error
	GetCrew(supervisorSessionID string) ([]entity.CrewAssignment, error)
	GetSupervisor(workerSessionID string) (*entity.CrewAssignment, error)
	ListAssignments() ([]entity.CrewAssignment, error)
	GetInbox(sessionID string, includeDelivered bool) ([]entity.CrewEnvelope, error)
	QueuedCounts() (map[string]int, error)
	Report(fromSessionID, reportType, summary string) error
	SetWatchdog(workerSessionID string, expectedBy time.Time) error
	Dispatch(supervisorSessionID, prompt string, opts CrewDispatchOptions) (CrewDispatchResult, error)
	InCrewScope(callerSessionID, targetSessionID string) (hasWorkers bool, allowed bool)
	DrainNow(supervisorSessionID string) error
	SetDeliveryLock(supervisorSessionID string, locked bool) error
	GetDeliveryLocks() (map[string]bool, error)
	Start()
	Stop()
}
