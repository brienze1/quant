// Package service contains application service implementations.
package service

import (
	"fmt"
	"os"
	"strings"
	"sync"
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

// Crew drainer tuning.
const (
	crewDrainTickInterval = time.Second
	// crewBusyReleaseGrace is how long the busy latch must have been released
	// before injection is allowed.
	crewBusyReleaseGrace = 2 * time.Second
	// crewIdleStreakRequired is the 2-tick hysteresis: the supervisor must
	// have been idle on the previous tick too.
	crewIdleStreakRequired = 2
	// crewMarkerScanBytes limits hold-marker scanning to the end of the tail,
	// so menus long scrolled off screen don't block injection forever.
	crewMarkerScanBytes = 1024
	// crewUserInputGuard is how long after the last user keystroke injection
	// stays held off.
	crewUserInputGuard = 8 * time.Second
	// crewInjectSubmitDelay is the pause between injecting the report text and
	// the Enter keystroke, mirroring SendMessageAndSubmit's submit semantics.
	crewInjectSubmitDelay = 120 * time.Millisecond
	// crewStuckAfter is how long a supervisor must be continuously blocked
	// with queued envelopes before crew:stuck is emitted (once).
	crewStuckAfter = 10 * time.Minute
)

// crewHoldMarkers are screen fragments that mean the supervisor's terminal is
// NOT safe to inject into (a running task, menu or permission dialog). The
// whole marker gate is skipped when QUANT_CREW_MARKERS=off.
var crewHoldMarkers = []string{"esc to interrupt", "❯", "Do you want", "(y/n)", "Trust the files", "trust this folder"}

// crewDrainState is the drainer's per-supervisor bookkeeping.
type crewDrainState struct {
	idleStreak   int
	blockedSince time.Time
	stuckEmitted bool
}

// crewManagerService implements the adapter.CrewManager interface.
type crewManagerService struct {
	findCrew        usecase.FindCrew
	saveCrew        usecase.SaveCrew
	deleteCrew      usecase.DeleteCrew
	findSession     usecase.FindSession
	sessionManager  adapter.SessionManager
	mindmapManager  adapter.MindmapManager
	sessionActivity usecase.SessionActivity
	emitter         adapter.EventEmitter

	drainMu    sync.Mutex
	drainState map[string]*crewDrainState
	stopCh     chan struct{}
	doneCh     chan struct{}
}

// NewCrewManagerService creates a new crew manager service.
func NewCrewManagerService(
	find usecase.FindCrew,
	save usecase.SaveCrew,
	del usecase.DeleteCrew,
	findSession usecase.FindSession,
	sessionManager adapter.SessionManager,
	mindmapManager adapter.MindmapManager,
	sessionActivity usecase.SessionActivity,
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
		drainState:      make(map[string]*crewDrainState),
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

// DrainNow delivers one queued envelope to the supervisor immediately,
// bypassing the idle, marker and user-input gates. It still requires a live
// process to inject into. Nothing queued is a no-op.
func (s *crewManagerService) DrainNow(supervisorSessionID string) error {
	if s.sessionActivity == nil {
		return fmt.Errorf("crew drain is not available")
	}
	if _, ok := s.sessionActivity.Activity(supervisorSessionID); !ok {
		return fmt.Errorf("no live process for session: %s", supervisorSessionID)
	}

	delivered, err := s.deliverNext(supervisorSessionID)
	if err != nil {
		return err
	}
	if delivered {
		s.resetDrainState(supervisorSessionID)
	}
	return nil
}

// Start launches the crew drainer goroutine.
func (s *crewManagerService) Start() {
	if s.sessionActivity == nil || s.stopCh != nil {
		return
	}
	s.stopCh = make(chan struct{})
	s.doneCh = make(chan struct{})
	go s.drainLoop(s.stopCh, s.doneCh)
}

// Stop shuts the crew drainer down and waits for it to exit.
func (s *crewManagerService) Stop() {
	if s.stopCh == nil {
		return
	}
	close(s.stopCh)
	<-s.doneCh
	s.stopCh = nil
}

func (s *crewManagerService) drainLoop(stop <-chan struct{}, done chan<- struct{}) {
	defer close(done)

	ticker := time.NewTicker(crewDrainTickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			s.drainTick(time.Now())
		}
	}
}

// drainTick runs one drainer pass: for every supervisor with queued envelopes
// it delivers at most ONE envelope when all injection gates are open, and
// tracks continuously-blocked time for the crew:stuck signal.
func (s *crewManagerService) drainTick(now time.Time) {
	supervisors, err := s.findCrew.SupervisorsWithQueued()
	if err != nil {
		return
	}

	queued := make(map[string]bool, len(supervisors))
	for _, supervisorID := range supervisors {
		queued[supervisorID] = true
		s.drainSupervisor(supervisorID, now)
	}

	// Drop bookkeeping for supervisors whose inbox drained, so stale streaks
	// and stuck timers don't linger.
	s.drainMu.Lock()
	for id := range s.drainState {
		if !queued[id] {
			delete(s.drainState, id)
		}
	}
	s.drainMu.Unlock()
}

func (s *crewManagerService) drainSupervisor(supervisorID string, now time.Time) {
	reason, open := s.evaluateGates(supervisorID, now)
	if open {
		if delivered, err := s.deliverNext(supervisorID); err == nil && delivered {
			s.resetDrainState(supervisorID)
		}
		return
	}

	s.drainMu.Lock()
	state := s.drainStateFor(supervisorID)
	if state.blockedSince.IsZero() {
		state.blockedSince = now
	}
	stuck := !state.stuckEmitted && now.Sub(state.blockedSince) >= crewStuckAfter
	if stuck {
		state.stuckEmitted = true
	}
	s.drainMu.Unlock()

	if stuck {
		s.emitCrewStuck(supervisorID, reason)
	}
}

// evaluateGates checks the injection gates for a supervisor, returning the
// blocking reason when one is closed.
func (s *crewManagerService) evaluateGates(supervisorID string, now time.Time) (string, bool) {
	// Gate 1: a live process to inject into.
	activity, ok := s.sessionActivity.Activity(supervisorID)
	if !ok {
		s.setIdleStreak(supervisorID, 0)
		return "no live process", false
	}

	// Gate 2: busy latch released ≥2s, plus 2-tick hysteresis via idleStreak.
	if activity.Busy {
		s.setIdleStreak(supervisorID, 0)
		return "session is busy", false
	}
	if !activity.BusyClearedAt.IsZero() && now.Sub(activity.BusyClearedAt) < crewBusyReleaseGrace {
		s.setIdleStreak(supervisorID, 0)
		return "busy released too recently", false
	}
	if streak := s.bumpIdleStreak(supervisorID); streak < crewIdleStreakRequired {
		return "waiting for idle hysteresis", false
	}

	// Gate 3: no hold markers in the last 1KB of the stripped output tail.
	if os.Getenv("QUANT_CREW_MARKERS") != "off" {
		tail := activity.Tail
		if len(tail) > crewMarkerScanBytes {
			tail = tail[len(tail)-crewMarkerScanBytes:]
		}
		screen := string(tail)
		for _, marker := range crewHoldMarkers {
			if strings.Contains(screen, marker) {
				return fmt.Sprintf("hold marker %q on screen", marker), false
			}
		}
	}

	// Gate 4: the user hasn't typed for ≥8s. MCP send_message also arms
	// lastUserInputAt, so agent-driven sends delay injection too — accepted:
	// it is conservative and only postpones delivery.
	if !activity.LastUserInputAt.IsZero() && now.Sub(activity.LastUserInputAt) < crewUserInputGuard {
		return "user typed recently", false
	}

	return "", true
}

// deliverNext injects the oldest queued envelope into the supervisor's PTY via
// WriteInjected (never SendMessage — that would arm the user-typing guard
// against the drainer itself), marks it delivered and emits crew:updated. The
// injection's own output re-latches the busy detector, which naturally
// serializes deliveries.
func (s *crewManagerService) deliverNext(supervisorID string) (bool, error) {
	envelope, err := s.findCrew.NextQueuedEnvelope(supervisorID)
	if err != nil || envelope == nil {
		return false, err
	}

	workerName := envelope.FromSessionID
	if session, err := s.findSession.FindByID(envelope.FromSessionID); err == nil && session != nil {
		workerName = session.Name
	}

	text := fmt.Sprintf("[crew · %s · %s] %s", envelope.Type, workerName, envelope.Summary)
	if err := s.sessionActivity.WriteInjected(supervisorID, text); err != nil {
		return false, err
	}
	time.Sleep(crewInjectSubmitDelay)
	if err := s.sessionActivity.WriteInjected(supervisorID, "\r"); err != nil {
		return false, err
	}

	if err := s.saveCrew.MarkEnvelopeDelivered(envelope.ID); err != nil {
		return false, err
	}

	s.emitCrewUpdated()

	return true, nil
}

// drainStateFor returns the drain bookkeeping for a supervisor; the caller
// must hold drainMu.
func (s *crewManagerService) drainStateFor(supervisorID string) *crewDrainState {
	state, ok := s.drainState[supervisorID]
	if !ok {
		state = &crewDrainState{}
		s.drainState[supervisorID] = state
	}
	return state
}

func (s *crewManagerService) setIdleStreak(supervisorID string, streak int) {
	s.drainMu.Lock()
	s.drainStateFor(supervisorID).idleStreak = streak
	s.drainMu.Unlock()
}

func (s *crewManagerService) bumpIdleStreak(supervisorID string) int {
	s.drainMu.Lock()
	state := s.drainStateFor(supervisorID)
	state.idleStreak++
	streak := state.idleStreak
	s.drainMu.Unlock()
	return streak
}

func (s *crewManagerService) resetDrainState(supervisorID string) {
	s.drainMu.Lock()
	delete(s.drainState, supervisorID)
	s.drainMu.Unlock()
}

// emitCrewStuck emits the one-shot crew:stuck signal for a supervisor whose
// queued envelopes have been undeliverable for too long.
func (s *crewManagerService) emitCrewStuck(supervisorID, reason string) {
	if s.emitter == nil {
		return
	}

	queued := 0
	if counts, err := s.findCrew.QueuedCounts(); err == nil {
		queued = counts[supervisorID]
	}
	oldestQueuedAt := ""
	if envelope, err := s.findCrew.NextQueuedEnvelope(supervisorID); err == nil && envelope != nil {
		oldestQueuedAt = envelope.CreatedAt.Format(time.RFC3339)
	}

	s.emitter.Emit("crew:stuck", map[string]any{
		"supervisorSessionId": supervisorID,
		"queued":              queued,
		"oldestQueuedAt":      oldestQueuedAt,
		"reason":              reason,
	})
}

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
