// Package controller contains Wails-bound entrypoint controllers.
package controller

import (
	"context"

	appAdapter "quant/internal/application/adapter"
	intAdapter "quant/internal/integration/adapter"
	"quant/internal/integration/entrypoint/dto"
)

// crewController implements the intAdapter.CrewController interface.
type crewController struct {
	ctx         context.Context
	crewManager appAdapter.CrewManager
}

// NewCrewController creates a new Wails-bound crew controller.
func NewCrewController(crewManager appAdapter.CrewManager) intAdapter.CrewController {
	return &crewController{
		crewManager: crewManager,
	}
}

func (c *crewController) OnStartup(ctx context.Context) {
	c.ctx = ctx
}

func (c *crewController) OnShutdown(_ context.Context) {}

// GetCrew retrieves the worker assignments under a supervisor session.
func (c *crewController) GetCrew(sessionID string) ([]dto.CrewAssignmentResponse, error) {
	assignments, err := c.crewManager.GetCrew(sessionID)
	if err != nil {
		return nil, err
	}

	return dto.CrewAssignmentResponseListFromEntities(assignments), nil
}

// GetSupervisor retrieves a worker's assignment, or nil when unassigned.
func (c *crewController) GetSupervisor(sessionID string) (*dto.CrewAssignmentResponse, error) {
	assignment, err := c.crewManager.GetSupervisor(sessionID)
	if err != nil {
		return nil, err
	}
	if assignment == nil {
		return nil, nil
	}

	response := dto.CrewAssignmentResponseFromEntity(*assignment)
	return &response, nil
}

// GetAllAssignments retrieves every crew assignment.
func (c *crewController) GetAllAssignments() ([]dto.CrewAssignmentResponse, error) {
	assignments, err := c.crewManager.ListAssignments()
	if err != nil {
		return nil, err
	}

	return dto.CrewAssignmentResponseListFromEntities(assignments), nil
}

// GetInbox retrieves the envelopes addressed to a session.
func (c *crewController) GetInbox(sessionID string, includeDelivered bool) ([]dto.CrewEnvelopeResponse, error) {
	envelopes, err := c.crewManager.GetInbox(sessionID, includeDelivered)
	if err != nil {
		return nil, err
	}

	return dto.CrewEnvelopeResponseListFromEntities(envelopes), nil
}

// GetQueuedCounts returns the number of queued envelopes per supervisor session.
func (c *crewController) GetQueuedCounts() (map[string]int, error) {
	return c.crewManager.QueuedCounts()
}

// AssignWorker assigns a worker session to a supervisor session.
func (c *crewController) AssignWorker(workerSessionID, supervisorSessionID string) error {
	return c.crewManager.AssignWorker(workerSessionID, supervisorSessionID)
}

// UnassignWorker removes a worker's crew assignment.
func (c *crewController) UnassignWorker(workerSessionID string) error {
	return c.crewManager.UnassignWorker(workerSessionID)
}

// DrainNow delivers one queued envelope to the supervisor immediately.
func (c *crewController) DrainNow(sessionID string) error {
	return c.crewManager.DrainNow(sessionID)
}

// SetDeliveryLock turns a supervisor's "always deliver" lock on or off.
func (c *crewController) SetDeliveryLock(supervisorSessionID string, locked bool) error {
	return c.crewManager.SetDeliveryLock(supervisorSessionID, locked)
}

// GetDeliveryLocks returns the supervisors whose "always deliver" lock is on.
func (c *crewController) GetDeliveryLocks() (map[string]bool, error) {
	return c.crewManager.GetDeliveryLocks()
}
