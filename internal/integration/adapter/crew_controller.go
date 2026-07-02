package adapter

import (
	"context"

	"quant/internal/integration/entrypoint/dto"
)

// CrewController defines the interface for the crew entrypoint controller.
type CrewController interface {
	OnStartup(ctx context.Context)
	OnShutdown(ctx context.Context)
	GetCrew(sessionID string) ([]dto.CrewAssignmentResponse, error)
	GetSupervisor(sessionID string) (*dto.CrewAssignmentResponse, error)
	GetAllAssignments() ([]dto.CrewAssignmentResponse, error)
	GetInbox(sessionID string, includeDelivered bool) ([]dto.CrewEnvelopeResponse, error)
	GetQueuedCounts() (map[string]int, error)
	AssignWorker(workerSessionID, supervisorSessionID string) error
	UnassignWorker(workerSessionID string) error
	DrainNow(sessionID string) error
}
