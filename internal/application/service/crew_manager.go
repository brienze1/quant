// Package service contains application service implementations.
package service

import (
	"fmt"
	"time"

	"github.com/google/uuid"

	"quant/internal/application/adapter"
	"quant/internal/application/usecase"
	"quant/internal/domain/entity"
)

// validCrewReportTypes holds the report types a worker may send. "nudge" is
// deliberately absent: nudge envelopes are synthesized internally by the drainer.
var validCrewReportTypes = map[string]bool{
	"done":     true,
	"progress": true,
	"question": true,
	"blocked":  true,
}

// crewCycleDepthCap bounds the supervisor-chain walk when checking for cycles.
const crewCycleDepthCap = 32

// SessionActivity is a placeholder for the session-activity dependency the
// crew drainer needs (idle detection + injected writes). A later milestone
// replaces it with usecase.SessionActivity; nil is accepted until then.
type SessionActivity interface{}

// crewManagerService implements the adapter.CrewManager interface.
type crewManagerService struct {
	findCrew        usecase.FindCrew
	saveCrew        usecase.SaveCrew
	deleteCrew      usecase.DeleteCrew
	findSession     usecase.FindSession
	sessionManager  adapter.SessionManager
	mindmapManager  adapter.MindmapManager
	sessionActivity SessionActivity
	emitter         adapter.EventEmitter
}

// NewCrewManagerService creates a new crew manager service.
func NewCrewManagerService(
	find usecase.FindCrew,
	save usecase.SaveCrew,
	del usecase.DeleteCrew,
	findSession usecase.FindSession,
	sessionManager adapter.SessionManager,
	mindmapManager adapter.MindmapManager,
	sessionActivity SessionActivity,
	emitter adapter.EventEmitter,
) adapter.CrewManager {
	return &crewManagerService{
		findCrew:        find,
		saveCrew:        save,
		deleteCrew:      del,
		findSession:     findSession,
		sessionManager:  sessionManager,
		mindmapManager:  mindmapManager,
		sessionActivity: sessionActivity,
		emitter:         emitter,
	}
}

// AssignWorker validates both sessions and upserts the worker→supervisor edge,
// so assigning an already-assigned worker moves it between crews.
func (s *crewManagerService) AssignWorker(workerSessionID, supervisorSessionID string) error {
	if workerSessionID == supervisorSessionID {
		return fmt.Errorf("a session cannot supervise itself: %s", workerSessionID)
	}

	if err := s.validateCrewSession(workerSessionID, "worker"); err != nil {
		return err
	}
	if err := s.validateCrewSession(supervisorSessionID, "supervisor"); err != nil {
		return err
	}

	// Walk up from the supervisor; if we reach the worker, linking would create a cycle.
	current := supervisorSessionID
	for depth := 0; depth < crewCycleDepthCap && current != ""; depth++ {
		assignment, err := s.findCrew.FindAssignmentByWorker(current)
		if err != nil {
			return fmt.Errorf("failed to walk crew supervisor chain: %w", err)
		}
		if assignment == nil {
			break
		}
		if assignment.SupervisorSessionID == workerSessionID {
			return fmt.Errorf("crew assignment would create a cycle: %s already supervises %s", workerSessionID, supervisorSessionID)
		}
		current = assignment.SupervisorSessionID
	}

	if err := s.saveCrew.SaveAssignment(entity.CrewAssignment{
		WorkerSessionID:     workerSessionID,
		SupervisorSessionID: supervisorSessionID,
		CreatedAt:           time.Now(),
	}); err != nil {
		return fmt.Errorf("failed to save crew assignment: %w", err)
	}

	s.emitCrewUpdated()

	return nil
}

// validateCrewSession ensures a session exists, is not archived, and is a claude
// session (injecting crew reports into a bash PTY would execute text as a command).
func (s *crewManagerService) validateCrewSession(sessionID, role string) error {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return fmt.Errorf("failed to look up %s session: %w", role, err)
	}
	if session == nil {
		return fmt.Errorf("%s session not found: %s", role, sessionID)
	}
	if session.ArchivedAt != nil {
		return fmt.Errorf("%s session is archived: %s", role, sessionID)
	}
	if session.SessionType != "claude" {
		return fmt.Errorf("%s session must be a claude session, got %q: %s", role, session.SessionType, sessionID)
	}
	return nil
}

// UnassignWorker removes the worker's crew edge.
func (s *crewManagerService) UnassignWorker(workerSessionID string) error {
	if err := s.deleteCrew.DeleteAssignment(workerSessionID); err != nil {
		return fmt.Errorf("failed to delete crew assignment: %w", err)
	}

	s.emitCrewUpdated()

	return nil
}

// GetCrew returns the assignments of the workers under a supervisor.
func (s *crewManagerService) GetCrew(supervisorSessionID string) ([]entity.CrewAssignment, error) {
	return s.findCrew.FindAssignmentsBySupervisor(supervisorSessionID)
}

// GetSupervisor returns a worker's assignment, or nil when unassigned.
func (s *crewManagerService) GetSupervisor(workerSessionID string) (*entity.CrewAssignment, error) {
	return s.findCrew.FindAssignmentByWorker(workerSessionID)
}

// ListAssignments returns every crew assignment.
func (s *crewManagerService) ListAssignments() ([]entity.CrewAssignment, error) {
	return s.findCrew.FindAllAssignments()
}

// GetInbox returns the envelopes addressed to a session.
func (s *crewManagerService) GetInbox(sessionID string, includeDelivered bool) ([]entity.CrewEnvelope, error) {
	return s.findCrew.FindEnvelopes(sessionID, includeDelivered)
}

// QueuedCounts returns the number of queued envelopes per supervisor session.
func (s *crewManagerService) QueuedCounts() (map[string]int, error) {
	return s.findCrew.QueuedCounts()
}

// Report validates and queues a worker's report to its supervisor, clearing any
// watchdogs waiting on that worker.
func (s *crewManagerService) Report(fromSessionID, reportType, summary string) error {
	if !validCrewReportTypes[reportType] {
		return fmt.Errorf("invalid crew report type %q: must be one of done, progress, question, blocked", reportType)
	}

	assignment, err := s.findCrew.FindAssignmentByWorker(fromSessionID)
	if err != nil {
		return fmt.Errorf("failed to look up crew assignment: %w", err)
	}
	if assignment == nil {
		return fmt.Errorf("session %s has no supervisor — it must be assigned to a crew before it can report", fromSessionID)
	}

	if err := s.saveCrew.SaveEnvelope(entity.CrewEnvelope{
		ID:            uuid.New().String(),
		FromSessionID: fromSessionID,
		ToSessionID:   assignment.SupervisorSessionID,
		Type:          reportType,
		Summary:       summary,
		Status:        "queued",
		CreatedAt:     time.Now(),
	}); err != nil {
		return fmt.Errorf("failed to save crew envelope: %w", err)
	}

	if err := s.deleteCrew.ClearWatchdogsForWorker(fromSessionID); err != nil {
		return fmt.Errorf("failed to clear crew watchdogs: %w", err)
	}

	s.emitCrewUpdated()

	return nil
}

// SetWatchdog records a deadline by which the worker is expected to report.
func (s *crewManagerService) SetWatchdog(workerSessionID string, expectedBy time.Time) error {
	assignment, err := s.findCrew.FindAssignmentByWorker(workerSessionID)
	if err != nil {
		return fmt.Errorf("failed to look up crew assignment: %w", err)
	}
	if assignment == nil {
		return fmt.Errorf("session %s has no supervisor — it must be assigned to a crew before a watchdog can be set", workerSessionID)
	}

	if err := s.saveCrew.SaveWatchdog(entity.CrewWatchdog{
		ID:                  uuid.New().String(),
		WorkerSessionID:     workerSessionID,
		SupervisorSessionID: assignment.SupervisorSessionID,
		ExpectedBy:          expectedBy,
		Fired:               false,
		CreatedAt:           time.Now(),
	}); err != nil {
		return fmt.Errorf("failed to save crew watchdog: %w", err)
	}

	return nil
}

// Dispatch creates/adopts a worker and delivers a prompt. Not available yet.
func (s *crewManagerService) Dispatch(supervisorSessionID, prompt string, opts adapter.CrewDispatchOptions) (adapter.CrewDispatchResult, error) {
	return adapter.CrewDispatchResult{}, fmt.Errorf("crew dispatch is not available yet")
}

// InCrewScope reports whether the caller has workers and whether the target is
// within the caller's crew scope: itself, its own supervisor, or its worker subtree.
func (s *crewManagerService) InCrewScope(callerSessionID, targetSessionID string) (bool, bool) {
	workers, err := s.findCrew.FindAssignmentsBySupervisor(callerSessionID)
	if err != nil || len(workers) == 0 {
		return false, true
	}

	if targetSessionID == callerSessionID {
		return true, true
	}

	if assignment, err := s.findCrew.FindAssignmentByWorker(callerSessionID); err == nil && assignment != nil {
		if assignment.SupervisorSessionID == targetSessionID {
			return true, true
		}
	}

	// BFS down the caller's worker subtree.
	queue := []string{callerSessionID}
	seen := map[string]bool{callerSessionID: true}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		children, err := s.findCrew.FindAssignmentsBySupervisor(current)
		if err != nil {
			break
		}
		for _, child := range children {
			if child.WorkerSessionID == targetSessionID {
				return true, true
			}
			if !seen[child.WorkerSessionID] {
				seen[child.WorkerSessionID] = true
				queue = append(queue, child.WorkerSessionID)
			}
		}
	}

	return true, false
}

// DrainNow delivers one queued envelope immediately. Not available yet.
func (s *crewManagerService) DrainNow(supervisorSessionID string) error {
	return fmt.Errorf("crew drain is not available yet")
}

// Start launches the crew drainer. No-op until the drainer lands.
func (s *crewManagerService) Start() {}

// Stop shuts down the crew drainer. No-op until the drainer lands.
func (s *crewManagerService) Stop() {}

// emitCrewUpdated emits the tiny crew:updated payload; consumers refetch bodies.
func (s *crewManagerService) emitCrewUpdated() {
	if s.emitter == nil {
		return
	}

	assignments, err := s.findCrew.FindAllAssignments()
	if err != nil {
		return
	}
	queued, err := s.findCrew.QueuedCounts()
	if err != nil {
		return
	}

	payloadAssignments := make([]map[string]any, 0, len(assignments))
	for _, a := range assignments {
		payloadAssignments = append(payloadAssignments, map[string]any{
			"workerSessionId":     a.WorkerSessionID,
			"supervisorSessionId": a.SupervisorSessionID,
		})
	}

	s.emitter.Emit("crew:updated", map[string]any{
		"assignments": payloadAssignments,
		"queued":      queued,
	})
}
