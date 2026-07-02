package service

import (
	"strings"
	"testing"
	"time"

	"quant/internal/application/adapter"
	"quant/internal/domain/entity"
)

// fakeCrewStore is an in-memory implementation of the crew persistence usecases.
type fakeCrewStore struct {
	assignments map[string]entity.CrewAssignment
	envelopes   []entity.CrewEnvelope
	watchdogs   []entity.CrewWatchdog
}

func newFakeCrewStore() *fakeCrewStore {
	return &fakeCrewStore{assignments: make(map[string]entity.CrewAssignment)}
}

func (f *fakeCrewStore) FindAssignmentByWorker(workerSessionID string) (*entity.CrewAssignment, error) {
	if a, ok := f.assignments[workerSessionID]; ok {
		return &a, nil
	}
	return nil, nil
}

func (f *fakeCrewStore) FindAssignmentsBySupervisor(supervisorSessionID string) ([]entity.CrewAssignment, error) {
	var out []entity.CrewAssignment
	for _, a := range f.assignments {
		if a.SupervisorSessionID == supervisorSessionID {
			out = append(out, a)
		}
	}
	return out, nil
}

func (f *fakeCrewStore) FindAllAssignments() ([]entity.CrewAssignment, error) {
	var out []entity.CrewAssignment
	for _, a := range f.assignments {
		out = append(out, a)
	}
	return out, nil
}

func (f *fakeCrewStore) FindEnvelopes(toSessionID string, includeDelivered bool) ([]entity.CrewEnvelope, error) {
	var out []entity.CrewEnvelope
	for _, e := range f.envelopes {
		if e.ToSessionID != toSessionID {
			continue
		}
		if !includeDelivered && e.Status != "queued" {
			continue
		}
		out = append(out, e)
	}
	return out, nil
}

func (f *fakeCrewStore) NextQueuedEnvelope(toSessionID string) (*entity.CrewEnvelope, error) {
	for _, e := range f.envelopes {
		if e.ToSessionID == toSessionID && e.Status == "queued" {
			return &e, nil
		}
	}
	return nil, nil
}

func (f *fakeCrewStore) QueuedCounts() (map[string]int, error) {
	counts := make(map[string]int)
	for _, e := range f.envelopes {
		if e.Status == "queued" {
			counts[e.ToSessionID]++
		}
	}
	return counts, nil
}

func (f *fakeCrewStore) SupervisorsWithQueued() ([]string, error) {
	counts, _ := f.QueuedCounts()
	var out []string
	for id := range counts {
		out = append(out, id)
	}
	return out, nil
}

func (f *fakeCrewStore) LatestEnvelopeByWorker(supervisorSessionID string) (map[string]entity.CrewEnvelope, error) {
	latest := make(map[string]entity.CrewEnvelope)
	for _, e := range f.envelopes {
		if e.ToSessionID == supervisorSessionID {
			latest[e.FromSessionID] = e
		}
	}
	return latest, nil
}

func (f *fakeCrewStore) FindDueWatchdogs(now time.Time) ([]entity.CrewWatchdog, error) {
	var out []entity.CrewWatchdog
	for _, w := range f.watchdogs {
		if !w.Fired && !w.ExpectedBy.After(now) {
			out = append(out, w)
		}
	}
	return out, nil
}

func (f *fakeCrewStore) SaveAssignment(assignment entity.CrewAssignment) error {
	f.assignments[assignment.WorkerSessionID] = assignment
	return nil
}

func (f *fakeCrewStore) SaveEnvelope(envelope entity.CrewEnvelope) error {
	f.envelopes = append(f.envelopes, envelope)
	return nil
}

func (f *fakeCrewStore) SaveWatchdog(watchdog entity.CrewWatchdog) error {
	f.watchdogs = append(f.watchdogs, watchdog)
	return nil
}

func (f *fakeCrewStore) MarkEnvelopeDelivered(id string) error {
	for i := range f.envelopes {
		if f.envelopes[i].ID == id {
			now := time.Now()
			f.envelopes[i].Status = "delivered"
			f.envelopes[i].DeliveredAt = &now
		}
	}
	return nil
}

func (f *fakeCrewStore) MarkWatchdogFired(id string) error {
	for i := range f.watchdogs {
		if f.watchdogs[i].ID == id {
			f.watchdogs[i].Fired = true
		}
	}
	return nil
}

func (f *fakeCrewStore) DeleteAssignment(workerSessionID string) error {
	delete(f.assignments, workerSessionID)
	return nil
}

func (f *fakeCrewStore) ClearWatchdogsForWorker(workerSessionID string) error {
	var kept []entity.CrewWatchdog
	for _, w := range f.watchdogs {
		if w.WorkerSessionID != workerSessionID {
			kept = append(kept, w)
		}
	}
	f.watchdogs = kept
	return nil
}

// fakeSessionFinder is an in-memory implementation of usecase.FindSession.
type fakeSessionFinder struct {
	sessions map[string]entity.Session
}

func (f *fakeSessionFinder) FindByID(id string) (*entity.Session, error) {
	if s, ok := f.sessions[id]; ok {
		return &s, nil
	}
	return nil, nil
}

func (f *fakeSessionFinder) FindAll() ([]entity.Session, error)            { return nil, nil }
func (f *fakeSessionFinder) FindByRepoID(string) ([]entity.Session, error) { return nil, nil }
func (f *fakeSessionFinder) FindByTaskID(string) ([]entity.Session, error) { return nil, nil }

// fakeEventEmitter records emitted events.
type fakeEventEmitter struct {
	events []string
}

func (f *fakeEventEmitter) Emit(name string, _ any) {
	f.events = append(f.events, name)
}

func claudeSession(id string) entity.Session {
	return entity.Session{ID: id, Name: id, SessionType: "claude", Status: "running"}
}

func newTestCrewManager(sessions ...entity.Session) (adapter.CrewManager, *fakeCrewStore, *fakeEventEmitter) {
	store := newFakeCrewStore()
	finder := &fakeSessionFinder{sessions: make(map[string]entity.Session)}
	for _, s := range sessions {
		finder.sessions[s.ID] = s
	}
	emitter := &fakeEventEmitter{}
	manager := NewCrewManagerService(store, store, store, finder, nil, nil, nil, emitter)
	return manager, store, emitter
}

func TestCrewAssignWorker_SelfRejected(t *testing.T) {
	manager, _, _ := newTestCrewManager(claudeSession("a"))

	if err := manager.AssignWorker("a", "a"); err == nil || !strings.Contains(err.Error(), "cannot supervise itself") {
		t.Fatalf("want self-assign error, got %v", err)
	}
}

func TestCrewAssignWorker_SessionValidation(t *testing.T) {
	archived := claudeSession("archived")
	archivedAt := time.Now()
	archived.ArchivedAt = &archivedAt
	bash := entity.Session{ID: "bash", Name: "bash", SessionType: "terminal"}
	manager, _, _ := newTestCrewManager(claudeSession("sup"), archived, bash)

	if err := manager.AssignWorker("missing", "sup"); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("want not-found error, got %v", err)
	}
	if err := manager.AssignWorker("archived", "sup"); err == nil || !strings.Contains(err.Error(), "archived") {
		t.Fatalf("want archived error, got %v", err)
	}
	if err := manager.AssignWorker("bash", "sup"); err == nil || !strings.Contains(err.Error(), "claude") {
		t.Fatalf("want non-claude error, got %v", err)
	}
}

func TestCrewAssignWorker_DeepCycleRejected(t *testing.T) {
	manager, _, _ := newTestCrewManager(claudeSession("a"), claudeSession("b"), claudeSession("c"))

	if err := manager.AssignWorker("b", "a"); err != nil {
		t.Fatalf("AssignWorker(b, a): %v", err)
	}
	if err := manager.AssignWorker("c", "b"); err != nil {
		t.Fatalf("AssignWorker(c, b): %v", err)
	}

	// a → b → c is the chain; making a a worker of c closes the loop.
	if err := manager.AssignWorker("a", "c"); err == nil || !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("want cycle error, got %v", err)
	}
}

func TestCrewAssignWorker_MoveAllowed(t *testing.T) {
	manager, store, emitter := newTestCrewManager(claudeSession("w"), claudeSession("s1"), claudeSession("s2"))

	if err := manager.AssignWorker("w", "s1"); err != nil {
		t.Fatalf("AssignWorker(w, s1): %v", err)
	}
	if err := manager.AssignWorker("w", "s2"); err != nil {
		t.Fatalf("AssignWorker(w, s2) move: %v", err)
	}

	if got := store.assignments["w"].SupervisorSessionID; got != "s2" {
		t.Fatalf("want worker moved to s2, got %s", got)
	}
	if len(store.assignments) != 1 {
		t.Fatalf("want single assignment after move, got %d", len(store.assignments))
	}
	if len(emitter.events) != 2 || emitter.events[0] != "crew:updated" {
		t.Fatalf("want two crew:updated events, got %v", emitter.events)
	}
}

func TestCrewReport_BadTypeRejected(t *testing.T) {
	manager, _, _ := newTestCrewManager(claudeSession("w"), claudeSession("s"))
	if err := manager.AssignWorker("w", "s"); err != nil {
		t.Fatalf("AssignWorker: %v", err)
	}

	for _, badType := range []string{"nudge", "bogus", ""} {
		if err := manager.Report("w", badType, "hi"); err == nil || !strings.Contains(err.Error(), "invalid crew report type") {
			t.Fatalf("type %q: want invalid-type error, got %v", badType, err)
		}
	}
}

func TestCrewReport_UnassignedRejected(t *testing.T) {
	manager, _, _ := newTestCrewManager(claudeSession("w"))

	if err := manager.Report("w", "done", "finished"); err == nil || !strings.Contains(err.Error(), "no supervisor") {
		t.Fatalf("want no-supervisor error, got %v", err)
	}
}

func TestCrewReport_QueuesAndClearsWatchdogs(t *testing.T) {
	manager, store, emitter := newTestCrewManager(claudeSession("w"), claudeSession("s"))
	if err := manager.AssignWorker("w", "s"); err != nil {
		t.Fatalf("AssignWorker: %v", err)
	}
	if err := manager.SetWatchdog("w", time.Now().Add(time.Minute)); err != nil {
		t.Fatalf("SetWatchdog: %v", err)
	}
	if len(store.watchdogs) != 1 {
		t.Fatalf("want 1 watchdog before report, got %d", len(store.watchdogs))
	}

	if err := manager.Report("w", "done", "finished the task"); err != nil {
		t.Fatalf("Report: %v", err)
	}

	if len(store.envelopes) != 1 {
		t.Fatalf("want 1 queued envelope, got %d", len(store.envelopes))
	}
	envelope := store.envelopes[0]
	if envelope.FromSessionID != "w" || envelope.ToSessionID != "s" || envelope.Type != "done" || envelope.Status != "queued" {
		t.Fatalf("unexpected envelope %+v", envelope)
	}
	if len(store.watchdogs) != 0 {
		t.Fatalf("want watchdogs cleared on report, got %d", len(store.watchdogs))
	}
	if emitter.events[len(emitter.events)-1] != "crew:updated" {
		t.Fatalf("want crew:updated emitted, got %v", emitter.events)
	}
}

func TestCrewUnassignWorker(t *testing.T) {
	manager, store, _ := newTestCrewManager(claudeSession("w"), claudeSession("s"))
	if err := manager.AssignWorker("w", "s"); err != nil {
		t.Fatalf("AssignWorker: %v", err)
	}

	if err := manager.UnassignWorker("w"); err != nil {
		t.Fatalf("UnassignWorker: %v", err)
	}
	if len(store.assignments) != 0 {
		t.Fatalf("want no assignments after unassign, got %d", len(store.assignments))
	}
}

func TestCrewInCrewScope(t *testing.T) {
	manager, _, _ := newTestCrewManager(
		claudeSession("root"), claudeSession("mid"), claudeSession("leaf"), claudeSession("outsider"),
	)
	if err := manager.AssignWorker("mid", "root"); err != nil {
		t.Fatalf("AssignWorker(mid, root): %v", err)
	}
	if err := manager.AssignWorker("leaf", "mid"); err != nil {
		t.Fatalf("AssignWorker(leaf, mid): %v", err)
	}

	// No workers → unrestricted.
	if hasWorkers, allowed := manager.InCrewScope("leaf", "outsider"); hasWorkers || !allowed {
		t.Fatalf("leaf: want (false, true), got (%v, %v)", hasWorkers, allowed)
	}

	// mid has a worker: itself, its supervisor and its subtree are in scope.
	for _, target := range []string{"mid", "root", "leaf"} {
		if hasWorkers, allowed := manager.InCrewScope("mid", target); !hasWorkers || !allowed {
			t.Fatalf("mid→%s: want (true, true), got (%v, %v)", target, hasWorkers, allowed)
		}
	}
	if hasWorkers, allowed := manager.InCrewScope("mid", "outsider"); !hasWorkers || allowed {
		t.Fatalf("mid→outsider: want (true, false), got (%v, %v)", hasWorkers, allowed)
	}

	// root sees its whole subtree.
	if hasWorkers, allowed := manager.InCrewScope("root", "leaf"); !hasWorkers || !allowed {
		t.Fatalf("root→leaf: want (true, true), got (%v, %v)", hasWorkers, allowed)
	}
}
