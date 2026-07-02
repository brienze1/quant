package usecase

import (
	"time"

	"quant/internal/domain/entity"
)

// FindCrew defines the interface for crew retrieval operations.
type FindCrew interface {
	FindAssignmentByWorker(workerSessionID string) (*entity.CrewAssignment, error)
	FindAssignmentsBySupervisor(supervisorSessionID string) ([]entity.CrewAssignment, error)
	FindAllAssignments() ([]entity.CrewAssignment, error)
	FindEnvelopes(toSessionID string, includeDelivered bool) ([]entity.CrewEnvelope, error)
	NextQueuedEnvelope(toSessionID string) (*entity.CrewEnvelope, error)
	QueuedCounts() (map[string]int, error)
	SupervisorsWithQueued() ([]string, error)
	LatestEnvelopeByWorker(supervisorSessionID string) (map[string]entity.CrewEnvelope, error)
	FindDueWatchdogs(now time.Time) ([]entity.CrewWatchdog, error)
}
