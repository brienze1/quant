package service

import (
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"quant/internal/application/adapter"
	"quant/internal/application/usecase"
	"quant/internal/domain/entity"
)

// fakeCrewStore is an in-memory implementation of the crew persistence usecases.
type fakeCrewStore struct {
	assignments   map[string]entity.CrewAssignment
	envelopes     []entity.CrewEnvelope
	watchdogs     []entity.CrewWatchdog
	deliveryLocks map[string]bool
}

func newFakeCrewStore() *fakeCrewStore {
	return &fakeCrewStore{
		assignments:   make(map[string]entity.CrewAssignment),
		deliveryLocks: make(map[string]bool),
	}
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

func (f *fakeCrewStore) DeliveryLocks() (map[string]bool, error) {
	out := make(map[string]bool)
	for id, locked := range f.deliveryLocks {
		if locked {
			out[id] = true
		}
	}
	return out, nil
}

func (f *fakeCrewStore) IsDeliveryLocked(supervisorSessionID string) (bool, error) {
	return f.deliveryLocks[supervisorSessionID], nil
}

func (f *fakeCrewStore) SetDeliveryLock(supervisorSessionID string, locked bool) error {
	if locked {
		f.deliveryLocks[supervisorSessionID] = true
	} else {
		delete(f.deliveryLocks, supervisorSessionID)
	}
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

func (f *fakeSessionFinder) FindAll() ([]entity.Session, error) { return nil, nil }

func (f *fakeSessionFinder) FindByRepoID(repoID string) ([]entity.Session, error) {
	var out []entity.Session
	for _, s := range f.sessions {
		if s.RepoID == repoID {
			out = append(out, s)
		}
	}
	return out, nil
}

func (f *fakeSessionFinder) FindByTaskID(string) ([]entity.Session, error) { return nil, nil }

// fakeEventEmitter records emitted events and their payloads.
type fakeEventEmitter struct {
	events   []string
	payloads []any
}

func (f *fakeEventEmitter) Emit(name string, payload any) {
	f.events = append(f.events, name)
	f.payloads = append(f.payloads, payload)
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

func TestCrewDrainDeliveryLock(t *testing.T) {
	t.Setenv("QUANT_CREW_MARKERS", "")
	now := time.Now()

	// An activity that trips EVERY gate: busy, a hold marker on screen, and a
	// keystroke a moment ago. The only thing a locked supervisor still needs is
	// a live process.
	blocked := entity.ProcessActivity{
		Busy:            true,
		Tail:            []byte("❯ Do you want (y/n)"),
		LastUserInputAt: now.Add(-time.Second),
	}

	// Locked: delivers on a single tick despite every gate being closed.
	activity := &fakeSessionActivity{
		activities: map[string]entity.ProcessActivity{"s": blocked},
		live:       map[string]bool{"s": true},
	}
	manager, store, emitter := newTestCrewManagerWithActivity(activity, claudeSession("w"), claudeSession("s"))
	queueReport(t, manager)
	if err := manager.SetDeliveryLock("s", true); err != nil {
		t.Fatalf("SetDeliveryLock: %v", err)
	}

	// SetDeliveryLock emits crew:updated whose payload carries the lock map.
	payload, ok := emitter.payloads[len(emitter.payloads)-1].(map[string]any)
	if !ok {
		t.Fatalf("last payload not a map: %T", emitter.payloads[len(emitter.payloads)-1])
	}
	locks, ok := payload["deliveryLocks"].(map[string]bool)
	if !ok || !locks["s"] {
		t.Fatalf("crew:updated payload missing deliveryLocks[s]: %v", payload["deliveryLocks"])
	}

	manager.drainTick(now)
	if store.envelopes[0].Status != "delivered" {
		t.Fatalf("locked supervisor did not deliver through the closed gates (writes: %q)", activity.writes)
	}

	// Locked but no live process: still cannot inject, so nothing is delivered.
	deadActivity := &fakeSessionActivity{
		activities: map[string]entity.ProcessActivity{},
		live:       map[string]bool{"s": false},
	}
	deadManager, deadStore, _ := newTestCrewManagerWithActivity(deadActivity, claudeSession("w"), claudeSession("s"))
	queueReport(t, deadManager)
	if err := deadManager.SetDeliveryLock("s", true); err != nil {
		t.Fatalf("SetDeliveryLock (dead): %v", err)
	}
	deadManager.drainTick(now)
	if deadStore.envelopes[0].Status != "queued" {
		t.Fatalf("locked supervisor with no live process must not deliver")
	}

	// Unlocked and blocked: unchanged — the gates still hold the report back.
	unlockActivity := &fakeSessionActivity{
		activities: map[string]entity.ProcessActivity{"s": blocked},
		live:       map[string]bool{"s": true},
	}
	unlockManager, unlockStore, _ := newTestCrewManagerWithActivity(unlockActivity, claudeSession("w"), claudeSession("s"))
	queueReport(t, unlockManager)
	unlockManager.drainTick(now)
	unlockManager.drainTick(now)
	if unlockStore.envelopes[0].Status != "queued" {
		t.Fatalf("unlocked blocked supervisor should not deliver")
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

// fakeDispatchSessionManager implements the SessionManager methods Dispatch
// uses; the embedded interface panics on anything else.
type fakeDispatchSessionManager struct {
	adapter.SessionManager
	finder      *fakeSessionFinder
	activity    *fakeSessionActivity
	createdOpts []entity.SessionOptions
	started     []string
	sent        map[string]string
}

func (f *fakeDispatchSessionManager) CreateSession(name, description, sessionType, repoID, taskID string, opts entity.SessionOptions) (*entity.Session, error) {
	session := entity.Session{ID: "created-" + name, Name: name, SessionType: sessionType, RepoID: repoID, Status: "idle"}
	f.finder.sessions[session.ID] = session
	f.createdOpts = append(f.createdOpts, opts)
	return &session, nil
}

func (f *fakeDispatchSessionManager) StartSession(id string, _ int, _ int) error {
	f.started = append(f.started, id)
	f.activity.live[id] = true
	f.activity.activities[id] = entity.ProcessActivity{LastOutputAt: time.Now().Add(-10 * time.Second)}
	return nil
}

func (f *fakeDispatchSessionManager) SendMessageAndSubmit(id string, message string) error {
	f.sent[id] = message
	return nil
}

func newTestDispatchManager(sessions ...entity.Session) (*crewManagerService, *fakeCrewStore, *fakeDispatchSessionManager, *fakeSessionActivity) {
	store := newFakeCrewStore()
	finder := &fakeSessionFinder{sessions: make(map[string]entity.Session)}
	for _, s := range sessions {
		finder.sessions[s.ID] = s
	}
	activity := &fakeSessionActivity{
		activities: make(map[string]entity.ProcessActivity),
		live:       make(map[string]bool),
	}
	sm := &fakeDispatchSessionManager{finder: finder, activity: activity, sent: make(map[string]string)}
	manager := NewCrewManagerService(store, store, store, finder, sm, nil, activity, &fakeEventEmitter{}).(*crewManagerService)
	manager.dispatchReadyTimeout = 300 * time.Millisecond
	manager.dispatchPollInterval = 10 * time.Millisecond
	return manager, store, sm, activity
}

func TestCrewDispatch_AdoptBySessionID(t *testing.T) {
	manager, store, sm, activity := newTestDispatchManager(claudeSession("sup"), claudeSession("w"))
	activity.live["w"] = true
	activity.activities["w"] = entity.ProcessActivity{LastOutputAt: time.Now().Add(-10 * time.Second)}

	result, err := manager.Dispatch("sup", "do the thing", adapter.CrewDispatchOptions{SessionID: "w"})
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if result.WorkerSessionID != "w" || result.AdoptedBy != "sessionId" || result.Created || result.Started {
		t.Fatalf("unexpected result: %+v", result)
	}
	if !result.PromptDelivered {
		t.Fatalf("prompt not delivered: %+v", result)
	}
	if a := store.assignments["w"]; a.SupervisorSessionID != "sup" {
		t.Fatalf("worker not assigned to supervisor: %+v", store.assignments)
	}
	message := sm.sent["w"]
	for _, want := range []string{"do the thing", "report_to_supervisor", `"sup"`} {
		if !strings.Contains(message, want) {
			t.Fatalf("delivered message missing %q:\n%s", want, message)
		}
	}
}

func TestCrewDispatch_AdoptByNameMostRecent(t *testing.T) {
	now := time.Now()
	old := claudeSession("w-old")
	old.Name = "builder"
	old.RepoID = "r1"
	old.LastActiveAt = now.Add(-time.Hour)
	newer := claudeSession("w-new")
	newer.Name = "builder"
	newer.RepoID = "r1"
	newer.LastActiveAt = now
	archived := claudeSession("w-arch")
	archived.Name = "builder"
	archived.RepoID = "r1"
	archived.LastActiveAt = now.Add(time.Hour)
	archivedAt := now
	archived.ArchivedAt = &archivedAt
	term := entity.Session{ID: "w-term", Name: "builder", SessionType: "terminal", RepoID: "r1", LastActiveAt: now.Add(time.Hour)}

	manager, _, sm, _ := newTestDispatchManager(claudeSession("sup"), old, newer, archived, term)

	result, err := manager.Dispatch("sup", "task", adapter.CrewDispatchOptions{Name: "builder", RepoID: "r1"})
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if result.WorkerSessionID != "w-new" || result.AdoptedBy != "name" || result.Created {
		t.Fatalf("want adoption of most-recently-active claude session w-new, got %+v", result)
	}
	if !result.Started || len(sm.started) != 1 || sm.started[0] != "w-new" {
		t.Fatalf("worker without a live process was not started: %+v", result)
	}
	if !result.PromptDelivered {
		t.Fatalf("prompt not delivered after start: %+v", result)
	}
}

func TestCrewDispatch_CreatesWhenNoMatch(t *testing.T) {
	sup := claudeSession("sup")
	sup.WorkspaceID = "ws1"
	manager, store, sm, _ := newTestDispatchManager(sup)

	result, err := manager.Dispatch("sup", "build it", adapter.CrewDispatchOptions{
		Name:              "fresh",
		RepoID:            "r1",
		UseWorktree:       true,
		Model:             "claude-sonnet-4-6",
		SkipPermissions:   true,
		ExpectedByMinutes: 5,
	})
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if !result.Created || result.AdoptedBy != "" || result.WorkerSessionID != "created-fresh" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(sm.createdOpts) != 1 {
		t.Fatalf("want one CreateSession call, got %d", len(sm.createdOpts))
	}
	opts := sm.createdOpts[0]
	if !opts.UseWorktree || !opts.SkipPermissions || opts.Model != "claude-sonnet-4-6" || opts.WorkspaceID != "ws1" {
		t.Fatalf("session options not passed through: %+v", opts)
	}
	if !result.Started || !result.PromptDelivered {
		t.Fatalf("worker not started/delivered: %+v", result)
	}
	if !result.WatchdogSet || len(store.watchdogs) != 1 {
		t.Fatalf("watchdog not set: %+v (watchdogs %d)", result, len(store.watchdogs))
	}
	if !strings.Contains(sm.sent[result.WorkerSessionID], "5 minutes") {
		t.Fatalf("contract does not mention the expected report window:\n%s", sm.sent[result.WorkerSessionID])
	}
}

func TestCrewDispatch_ReadyTimeoutIsNotAnError(t *testing.T) {
	manager, store, sm, activity := newTestDispatchManager(claudeSession("sup"), claudeSession("w"))
	activity.live["w"] = true
	activity.activities["w"] = entity.ProcessActivity{LastOutputAt: time.Now(), Busy: true}

	result, err := manager.Dispatch("sup", "task", adapter.CrewDispatchOptions{SessionID: "w", ExpectedByMinutes: 5})
	if err != nil {
		t.Fatalf("Dispatch timeout must not be an error: %v", err)
	}
	if result.PromptDelivered || result.WatchdogSet {
		t.Fatalf("busy worker must not receive the prompt or a watchdog: %+v", result)
	}
	if len(sm.sent) != 0 || len(store.watchdogs) != 0 {
		t.Fatalf("prompt/watchdog leaked despite timeout")
	}
}

// fakeMindmapManager is an in-memory implementation of adapter.MindmapManager.
// When err is set every operation fails with it.
type fakeMindmapManager struct {
	nodes map[string]map[string]entity.MindmapNode
	err   error
}

func newFakeMindmapManager() *fakeMindmapManager {
	return &fakeMindmapManager{nodes: make(map[string]map[string]entity.MindmapNode)}
}

func (f *fakeMindmapManager) key(scopeType, scopeID, board string) string {
	return scopeType + "|" + scopeID + "|" + board
}

// board returns the "crew (auto)" board nodes for a supervisor session.
func (f *fakeMindmapManager) board(supervisorID string) map[string]entity.MindmapNode {
	return f.nodes[f.key("session", supervisorID, "crew (auto)")]
}

func (f *fakeMindmapManager) SetNode(scopeType, scopeID, board string, node entity.MindmapNode) (entity.MindmapNode, error) {
	if f.err != nil {
		return entity.MindmapNode{}, f.err
	}
	if node.Status == "" {
		node.Status = "planned"
	}
	k := f.key(scopeType, scopeID, board)
	if f.nodes[k] == nil {
		f.nodes[k] = make(map[string]entity.MindmapNode)
	}
	f.nodes[k][node.ID] = node
	return node, nil
}

func (f *fakeMindmapManager) RemoveNode(scopeType, scopeID, board, id string, _ bool) error {
	if f.err != nil {
		return f.err
	}
	delete(f.nodes[f.key(scopeType, scopeID, board)], id)
	return nil
}

func (f *fakeMindmapManager) ClearMindmap(scopeType, scopeID, board string) error {
	if f.err != nil {
		return f.err
	}
	delete(f.nodes, f.key(scopeType, scopeID, board))
	return nil
}

func (f *fakeMindmapManager) GetMindmap(scopeType, scopeID, board string) ([]entity.MindmapNode, error) {
	var out []entity.MindmapNode
	for _, n := range f.nodes[f.key(scopeType, scopeID, board)] {
		out = append(out, n)
	}
	return out, nil
}

func (f *fakeMindmapManager) ListBoards(string, string) ([]string, error) { return nil, nil }
func (f *fakeMindmapManager) MoveBoard(string, string, string, string) (string, error) {
	return "", nil
}
func (f *fakeMindmapManager) RenameBoard(string, string, string, string) (string, error) {
	return "", nil
}

func newBoardTestCrewManager(activity *fakeSessionActivity, sessions ...entity.Session) (*crewManagerService, *fakeCrewStore, *fakeMindmapManager, *fakeEventEmitter) {
	store := newFakeCrewStore()
	finder := &fakeSessionFinder{sessions: make(map[string]entity.Session)}
	for _, s := range sessions {
		finder.sessions[s.ID] = s
	}
	board := newFakeMindmapManager()
	emitter := &fakeEventEmitter{}
	var act usecase.SessionActivity
	if activity != nil {
		act = activity
	}
	manager := NewCrewManagerService(store, store, store, finder, nil, board, act, emitter).(*crewManagerService)
	return manager, store, board, emitter
}

// deadSupervisorActivity keeps the supervisor process dead so queued envelopes
// stay queued and watchdog assertions are not disturbed by deliveries.
func deadSupervisorActivity() *fakeSessionActivity {
	return &fakeSessionActivity{
		activities: make(map[string]entity.ProcessActivity),
		live:       make(map[string]bool),
	}
}

func TestCrewWatchdogFiresOneNudge(t *testing.T) {
	manager, store, board, emitter := newBoardTestCrewManager(deadSupervisorActivity(), claudeSession("w"), claudeSession("s"))
	if err := manager.AssignWorker("w", "s"); err != nil {
		t.Fatalf("AssignWorker: %v", err)
	}

	now := time.Now()
	store.watchdogs = append(store.watchdogs, entity.CrewWatchdog{
		ID:                  "wd1",
		WorkerSessionID:     "w",
		SupervisorSessionID: "s",
		ExpectedBy:          now.Add(-time.Minute),
		CreatedAt:           now.Add(-5 * time.Minute),
	})

	manager.drainTick(now)

	if len(store.envelopes) != 1 {
		t.Fatalf("want exactly one nudge envelope, got %d", len(store.envelopes))
	}
	nudge := store.envelopes[0]
	if nudge.Type != "nudge" || nudge.FromSessionID != "w" || nudge.ToSessionID != "s" || nudge.Status != "queued" {
		t.Fatalf("unexpected nudge envelope %+v", nudge)
	}
	if want := "No report from w within 4m — check get_session_output or nudge them."; nudge.Summary != want {
		t.Fatalf("nudge summary = %q, want %q", nudge.Summary, want)
	}
	if !store.watchdogs[0].Fired {
		t.Fatalf("watchdog not marked fired")
	}
	if emitter.events[len(emitter.events)-1] != "crew:updated" {
		t.Fatalf("want crew:updated on nudge enqueue, got %v", emitter.events)
	}

	// The nudge mirrors onto the board as in_progress.
	if node := board.board("s")["w"]; node.Status != "in_progress" {
		t.Fatalf("want worker node in_progress after nudge, got %+v", node)
	}

	// No refire on the next tick.
	manager.drainTick(now.Add(time.Second))
	if len(store.envelopes) != 1 {
		t.Fatalf("watchdog refired: %d envelopes", len(store.envelopes))
	}
}

func TestCrewWatchdogClearedByReportBeforeFire(t *testing.T) {
	manager, store, _, _ := newBoardTestCrewManager(deadSupervisorActivity(), claudeSession("w"), claudeSession("s"))
	if err := manager.AssignWorker("w", "s"); err != nil {
		t.Fatalf("AssignWorker: %v", err)
	}

	now := time.Now()
	store.watchdogs = append(store.watchdogs, entity.CrewWatchdog{
		ID:                  "wd1",
		WorkerSessionID:     "w",
		SupervisorSessionID: "s",
		ExpectedBy:          now.Add(-time.Minute),
		CreatedAt:           now.Add(-5 * time.Minute),
	})

	if err := manager.Report("w", "done", "finished"); err != nil {
		t.Fatalf("Report: %v", err)
	}
	manager.drainTick(now)

	if len(store.envelopes) != 1 || store.envelopes[0].Type != "done" {
		t.Fatalf("want only the report envelope, got %+v", store.envelopes)
	}
	if len(store.watchdogs) != 0 {
		t.Fatalf("want watchdogs cleared by the report, got %d", len(store.watchdogs))
	}
}

func TestCrewWatchdogSupervisorGone(t *testing.T) {
	manager, store, _, _ := newBoardTestCrewManager(deadSupervisorActivity(), claudeSession("w"))

	now := time.Now()
	store.watchdogs = append(store.watchdogs, entity.CrewWatchdog{
		ID:                  "wd1",
		WorkerSessionID:     "w",
		SupervisorSessionID: "gone",
		ExpectedBy:          now.Add(-time.Minute),
		CreatedAt:           now.Add(-5 * time.Minute),
	})

	manager.drainTick(now)

	if !store.watchdogs[0].Fired {
		t.Fatalf("watchdog not marked fired for gone supervisor")
	}
	if len(store.envelopes) != 0 {
		t.Fatalf("want no envelope for gone supervisor, got %+v", store.envelopes)
	}
}

func TestCrewBoardMirror(t *testing.T) {
	manager, _, board, _ := newBoardTestCrewManager(nil, claudeSession("w1"), claudeSession("w2"), claudeSession("s"))

	// Assign builds root + planned worker node.
	if err := manager.AssignWorker("w1", "s"); err != nil {
		t.Fatalf("AssignWorker(w1): %v", err)
	}
	nodes := board.board("s")
	root, ok := nodes["crew"]
	if !ok || root.Label != "crew" || root.ParentID != "" {
		t.Fatalf("want root node crew, got %+v", nodes)
	}
	worker := nodes["w1"]
	if worker.ParentID != "crew" || worker.Label != "w1" || worker.Status != "planned" || worker.Note != "" {
		t.Fatalf("unexpected worker node %+v", worker)
	}

	if err := manager.AssignWorker("w2", "s"); err != nil {
		t.Fatalf("AssignWorker(w2): %v", err)
	}
	if len(board.board("s")) != 3 {
		t.Fatalf("want root + 2 workers, got %+v", board.board("s"))
	}

	// Report flips status and rune-safe truncates the note to 120 chars.
	long := strings.Repeat("é", 200)
	if err := manager.Report("w1", "blocked", long); err != nil {
		t.Fatalf("Report(blocked): %v", err)
	}
	worker = board.board("s")["w1"]
	if worker.Status != "blocked" {
		t.Fatalf("want blocked status, got %q", worker.Status)
	}
	if got := utf8.RuneCountInString(worker.Note); got != 120 {
		t.Fatalf("want 120-rune note, got %d runes", got)
	}
	if !strings.HasPrefix(long, worker.Note) {
		t.Fatalf("truncation split a rune: %q", worker.Note)
	}

	if err := manager.Report("w2", "progress", "halfway"); err != nil {
		t.Fatalf("Report(progress): %v", err)
	}
	if node := board.board("s")["w2"]; node.Status != "in_progress" || node.Note != "halfway" {
		t.Fatalf("want in_progress + note, got %+v", node)
	}
	if err := manager.Report("w2", "done", "shipped"); err != nil {
		t.Fatalf("Report(done): %v", err)
	}
	if node := board.board("s")["w2"]; node.Status != "done" || node.Note != "shipped" {
		t.Fatalf("want done + latest note, got %+v", node)
	}

	// Unassign rebuilds without the worker.
	if err := manager.UnassignWorker("w1"); err != nil {
		t.Fatalf("UnassignWorker(w1): %v", err)
	}
	nodes = board.board("s")
	if _, gone := nodes["w1"]; gone || len(nodes) != 2 {
		t.Fatalf("want root + w2 after unassign, got %+v", nodes)
	}

	// Last worker unassigned clears the board.
	if err := manager.UnassignWorker("w2"); err != nil {
		t.Fatalf("UnassignWorker(w2): %v", err)
	}
	if len(board.board("s")) != 0 {
		t.Fatalf("want cleared board after last unassign, got %+v", board.board("s"))
	}
}

func TestCrewBoardMirror_MoveRebuildsBothSupervisors(t *testing.T) {
	manager, _, board, _ := newBoardTestCrewManager(nil, claudeSession("w"), claudeSession("s1"), claudeSession("s2"))

	if err := manager.AssignWorker("w", "s1"); err != nil {
		t.Fatalf("AssignWorker(w, s1): %v", err)
	}
	if err := manager.AssignWorker("w", "s2"); err != nil {
		t.Fatalf("AssignWorker(w, s2) move: %v", err)
	}

	if len(board.board("s1")) != 0 {
		t.Fatalf("want old supervisor board cleared on move, got %+v", board.board("s1"))
	}
	if _, ok := board.board("s2")["w"]; !ok {
		t.Fatalf("want worker on new supervisor board, got %+v", board.board("s2"))
	}
}

func TestCrewBoardMirrorErrorDoesNotFailPrimary(t *testing.T) {
	manager, store, board, _ := newBoardTestCrewManager(nil, claudeSession("w"), claudeSession("s"))
	board.err = errors.New("mindmap down")

	if err := manager.AssignWorker("w", "s"); err != nil {
		t.Fatalf("AssignWorker must survive mirror errors: %v", err)
	}
	if err := manager.Report("w", "done", "finished"); err != nil {
		t.Fatalf("Report must survive mirror errors: %v", err)
	}
	if len(store.assignments) != 1 || len(store.envelopes) != 1 {
		t.Fatalf("primary writes lost: %d assignments, %d envelopes", len(store.assignments), len(store.envelopes))
	}
}

func TestCrewDispatch_Validation(t *testing.T) {
	manager, _, _, _ := newTestDispatchManager(claudeSession("sup"))

	if _, err := manager.Dispatch("sup", "  ", adapter.CrewDispatchOptions{SessionID: "w"}); err == nil || !strings.Contains(err.Error(), "prompt") {
		t.Fatalf("want prompt-required error, got %v", err)
	}
	if _, err := manager.Dispatch("sup", "task", adapter.CrewDispatchOptions{}); err == nil || !strings.Contains(err.Error(), "sessionId") {
		t.Fatalf("want resolution error, got %v", err)
	}
	if _, err := manager.Dispatch("sup", "task", adapter.CrewDispatchOptions{Name: "x"}); err == nil || !strings.Contains(err.Error(), "repoId") {
		t.Fatalf("want repoId-required error, got %v", err)
	}
	if _, err := manager.Dispatch("missing", "task", adapter.CrewDispatchOptions{SessionID: "sup"}); err == nil || !strings.Contains(err.Error(), "supervisor session not found") {
		t.Fatalf("want missing-supervisor error, got %v", err)
	}
}
