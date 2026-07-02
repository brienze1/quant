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

// fakeSessionActivity is an in-memory implementation of usecase.SessionActivity.
type fakeSessionActivity struct {
	activities map[string]entity.ProcessActivity
	live       map[string]bool
	writes     []string
}

func (f *fakeSessionActivity) Activity(sessionID string) (entity.ProcessActivity, bool) {
	if !f.live[sessionID] {
		return entity.ProcessActivity{}, false
	}
	return f.activities[sessionID], true
}

func (f *fakeSessionActivity) WriteInjected(_ string, data string) error {
	f.writes = append(f.writes, data)
	return nil
}

func newTestCrewManagerWithActivity(activity *fakeSessionActivity, sessions ...entity.Session) (*crewManagerService, *fakeCrewStore, *fakeEventEmitter) {
	store := newFakeCrewStore()
	finder := &fakeSessionFinder{sessions: make(map[string]entity.Session)}
	for _, s := range sessions {
		finder.sessions[s.ID] = s
	}
	emitter := &fakeEventEmitter{}
	manager := NewCrewManagerService(store, store, store, finder, nil, nil, activity, emitter)
	return manager.(*crewManagerService), store, emitter
}

// queueReport assigns w under s and queues one "done" report from w.
func queueReport(t *testing.T, manager *crewManagerService) {
	t.Helper()
	if err := manager.AssignWorker("w", "s"); err != nil {
		t.Fatalf("AssignWorker: %v", err)
	}
	if err := manager.Report("w", "done", "finished"); err != nil {
		t.Fatalf("Report: %v", err)
	}
}

func TestCrewDrainGates(t *testing.T) {
	now := time.Now()
	idle := entity.ProcessActivity{
		LastOutputAt:  now.Add(-10 * time.Second),
		BusyClearedAt: now.Add(-3 * time.Second),
	}
	withTail := func(tail string) entity.ProcessActivity {
		a := idle
		a.Tail = []byte(tail)
		return a
	}
	withInput := func(ago time.Duration) entity.ProcessActivity {
		a := idle
		a.LastUserInputAt = now.Add(-ago)
		return a
	}

	cases := []struct {
		name          string
		live          bool
		activity      entity.ProcessActivity
		markersOff    bool
		wantDelivered bool
	}{
		{"all gates open", true, idle, false, true},
		{"gate1 no live process", false, idle, false, false},
		{"gate2 busy", true, entity.ProcessActivity{Busy: true}, false, false},
		{"gate2 busy released too recently", true, entity.ProcessActivity{BusyClearedAt: now.Add(-time.Second)}, false, false},
		{"gate2 never busy passes", true, entity.ProcessActivity{LastOutputAt: now.Add(-10 * time.Second)}, false, true},
		{"gate3 esc to interrupt", true, withTail("thinking… (esc to interrupt)"), false, false},
		{"gate3 prompt marker", true, withTail("❯ "), false, false},
		{"gate3 permission dialog", true, withTail("Do you want to allow this?"), false, false},
		{"gate3 yes-no prompt", true, withTail("continue? (y/n)"), false, false},
		{"gate3 trust dialog", true, withTail("Trust the files in this folder?"), false, false},
		{"gate3 markers off bypasses", true, withTail("❯ Do you want (y/n)"), true, true},
		{"gate4 user typed recently", true, withInput(3 * time.Second), false, false},
		{"gate4 user typed long ago", true, withInput(9 * time.Second), false, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.markersOff {
				t.Setenv("QUANT_CREW_MARKERS", "off")
			} else {
				t.Setenv("QUANT_CREW_MARKERS", "")
			}

			activity := &fakeSessionActivity{
				activities: map[string]entity.ProcessActivity{"s": tc.activity},
				live:       map[string]bool{"s": tc.live},
			}
			manager, store, _ := newTestCrewManagerWithActivity(activity, claudeSession("w"), claudeSession("s"))
			queueReport(t, manager)

			// Two ticks: the first can never deliver (2-tick hysteresis).
			manager.drainTick(now)
			manager.drainTick(now)

			delivered := store.envelopes[0].Status == "delivered"
			if delivered != tc.wantDelivered {
				t.Fatalf("delivered = %v, want %v (writes: %q)", delivered, tc.wantDelivered, activity.writes)
			}
		})
	}
}

func TestCrewDrainHysteresisAndFormat(t *testing.T) {
	t.Setenv("QUANT_CREW_MARKERS", "")
	now := time.Now()
	activity := &fakeSessionActivity{
		activities: map[string]entity.ProcessActivity{"s": {
			LastOutputAt:  now.Add(-10 * time.Second),
			BusyClearedAt: now.Add(-3 * time.Second),
		}},
		live: map[string]bool{"s": true},
	}
	manager, store, emitter := newTestCrewManagerWithActivity(activity, claudeSession("w"), claudeSession("s"))
	queueReport(t, manager)

	// First idle tick: hysteresis holds the envelope back.
	manager.drainTick(now)
	if store.envelopes[0].Status != "queued" {
		t.Fatalf("delivered on the first idle tick — hysteresis not applied")
	}

	// Second idle tick: delivered as text + separate Enter keystroke.
	manager.drainTick(now.Add(time.Second))
	if store.envelopes[0].Status != "delivered" {
		t.Fatalf("not delivered on the second idle tick")
	}
	if len(activity.writes) != 2 || activity.writes[0] != "[crew · done · w] finished" || activity.writes[1] != "\r" {
		t.Fatalf("unexpected injected writes: %q", activity.writes)
	}
	if emitter.events[len(emitter.events)-1] != "crew:updated" {
		t.Fatalf("want crew:updated after delivery, got %v", emitter.events)
	}
}

func TestCrewDrainNow_BypassesGates(t *testing.T) {
	t.Setenv("QUANT_CREW_MARKERS", "")
	activity := &fakeSessionActivity{
		activities: map[string]entity.ProcessActivity{"s": {Busy: true, Tail: []byte("❯ Do you want")}},
		live:       map[string]bool{"s": true},
	}
	manager, store, _ := newTestCrewManagerWithActivity(activity, claudeSession("w"), claudeSession("s"))
	queueReport(t, manager)

	if err := manager.DrainNow("s"); err != nil {
		t.Fatalf("DrainNow: %v", err)
	}
	if store.envelopes[0].Status != "delivered" {
		t.Fatalf("DrainNow did not deliver while busy")
	}

	// Nothing queued is a no-op.
	if err := manager.DrainNow("s"); err != nil {
		t.Fatalf("DrainNow on empty inbox: %v", err)
	}

	// A dead process is an error.
	activity.live["s"] = false
	if err := manager.DrainNow("s"); err == nil || !strings.Contains(err.Error(), "no live process") {
		t.Fatalf("want no-live-process error, got %v", err)
	}
}

func TestCrewStuckEmittedOnce(t *testing.T) {
	t.Setenv("QUANT_CREW_MARKERS", "")
	now := time.Now()
	activity := &fakeSessionActivity{
		activities: map[string]entity.ProcessActivity{"s": {Busy: true}},
		live:       map[string]bool{"s": true},
	}
	manager, _, emitter := newTestCrewManagerWithActivity(activity, claudeSession("w"), claudeSession("s"))
	queueReport(t, manager)

	countStuck := func() int {
		n := 0
		for _, e := range emitter.events {
			if e == "crew:stuck" {
				n++
			}
		}
		return n
	}

	manager.drainTick(now)
	manager.drainTick(now.Add(5 * time.Minute))
	if countStuck() != 0 {
		t.Fatalf("crew:stuck emitted before the 10-minute threshold")
	}

	manager.drainTick(now.Add(10 * time.Minute))
	if countStuck() != 1 {
		t.Fatalf("want exactly one crew:stuck at the threshold, got %d", countStuck())
	}

	// Still blocked: no re-emission.
	manager.drainTick(now.Add(11 * time.Minute))
	manager.drainTick(now.Add(20 * time.Minute))
	if countStuck() != 1 {
		t.Fatalf("crew:stuck re-emitted while still blocked, got %d", countStuck())
	}

	// Unblock and deliver: state resets, so a NEW blockage can emit again.
	activity.activities["s"] = entity.ProcessActivity{
		LastOutputAt:  now.Add(11 * time.Minute),
		BusyClearedAt: now.Add(11 * time.Minute),
	}
	deliverAt := now.Add(21 * time.Minute)
	manager.drainTick(deliverAt)
	manager.drainTick(deliverAt.Add(time.Second))

	if err := manager.Report("w", "progress", "again"); err != nil {
		t.Fatalf("Report: %v", err)
	}
	activity.activities["s"] = entity.ProcessActivity{Busy: true}
	manager.drainTick(deliverAt.Add(2 * time.Second))
	manager.drainTick(deliverAt.Add(2*time.Second + 10*time.Minute))
	if countStuck() != 2 {
		t.Fatalf("want a second crew:stuck for the new blockage, got %d", countStuck())
	}
}
