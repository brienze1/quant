package persistence

import (
	"database/sql"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"quant/internal/domain/entity"
)

// newCrewTestDB opens an in-memory SQLite database with foreign keys enforced
// and the sessions + crew tables created (same SQL as the real migrations).
func newCrewTestDB(t *testing.T) *sql.DB {
	t.Helper()

	db, err := sql.Open("sqlite3", "file::memory:?_foreign_keys=on")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// A pooled second connection would get its own empty :memory: database.
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })

	statements := []string{
		`CREATE TABLE sessions (id TEXT PRIMARY KEY);`,
		`CREATE TABLE IF NOT EXISTS crew_assignments (
			worker_session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
			supervisor_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			created_at TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_crew_assignments_supervisor ON crew_assignments(supervisor_session_id);`,
		`CREATE TABLE IF NOT EXISTS crew_envelopes (
			id TEXT PRIMARY KEY,
			from_session_id TEXT NOT NULL,
			to_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			type TEXT NOT NULL,
			summary TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'queued',
			created_at TEXT NOT NULL,
			delivered_at TEXT
		);`,
		`CREATE INDEX IF NOT EXISTS idx_crew_envelopes_to_status ON crew_envelopes(to_session_id, status);`,
		`CREATE TABLE IF NOT EXISTS crew_watchdogs (
			id TEXT PRIMARY KEY,
			worker_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			supervisor_session_id TEXT NOT NULL,
			expected_by TEXT NOT NULL,
			fired INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS crew_delivery_locks (
			supervisor_session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
			locked INTEGER NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL
		);`,
	}
	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("create schema: %v", err)
		}
	}

	return db
}

func insertTestSessions(t *testing.T, db *sql.DB, ids ...string) {
	t.Helper()
	for _, id := range ids {
		if _, err := db.Exec(`INSERT INTO sessions (id) VALUES (?)`, id); err != nil {
			t.Fatalf("insert session %s: %v", id, err)
		}
	}
}

func TestCrewAssignmentUpsertMove(t *testing.T) {
	db := newCrewTestDB(t)
	insertTestSessions(t, db, "w1", "s1", "s2")
	p := NewCrewPersistence(db)

	if err := p.SaveAssignment(entity.CrewAssignment{WorkerSessionID: "w1", SupervisorSessionID: "s1", CreatedAt: time.Now()}); err != nil {
		t.Fatalf("SaveAssignment: %v", err)
	}

	assignment, err := p.FindAssignmentByWorker("w1")
	if err != nil {
		t.Fatalf("FindAssignmentByWorker: %v", err)
	}
	if assignment == nil || assignment.SupervisorSessionID != "s1" {
		t.Fatalf("want supervisor s1, got %+v", assignment)
	}

	// Re-assigning the same worker moves it to the new supervisor (upsert).
	if err := p.SaveAssignment(entity.CrewAssignment{WorkerSessionID: "w1", SupervisorSessionID: "s2", CreatedAt: time.Now()}); err != nil {
		t.Fatalf("SaveAssignment (move): %v", err)
	}

	all, err := p.FindAllAssignments()
	if err != nil {
		t.Fatalf("FindAllAssignments: %v", err)
	}
	if len(all) != 1 || all[0].SupervisorSessionID != "s2" {
		t.Fatalf("want single assignment to s2 after move, got %+v", all)
	}

	old, err := p.FindAssignmentsBySupervisor("s1")
	if err != nil {
		t.Fatalf("FindAssignmentsBySupervisor(s1): %v", err)
	}
	if len(old) != 0 {
		t.Fatalf("want no workers left under s1, got %+v", old)
	}

	if err := p.DeleteAssignment("w1"); err != nil {
		t.Fatalf("DeleteAssignment: %v", err)
	}
	assignment, err = p.FindAssignmentByWorker("w1")
	if err != nil {
		t.Fatalf("FindAssignmentByWorker after delete: %v", err)
	}
	if assignment != nil {
		t.Fatalf("want nil assignment after delete, got %+v", assignment)
	}
}

func TestCrewEnvelopeQueuedCountsAndDeliver(t *testing.T) {
	db := newCrewTestDB(t)
	insertTestSessions(t, db, "w1", "w2", "s1", "s2")
	p := NewCrewPersistence(db)

	base := time.Now().Add(-time.Minute)
	envelopes := []entity.CrewEnvelope{
		{ID: "e1", FromSessionID: "w1", ToSessionID: "s1", Type: "progress", Summary: "first", Status: "queued", CreatedAt: base},
		{ID: "e2", FromSessionID: "w1", ToSessionID: "s1", Type: "done", Summary: "second", Status: "queued", CreatedAt: base.Add(10 * time.Second)},
		{ID: "e3", FromSessionID: "w2", ToSessionID: "s2", Type: "blocked", Summary: "third", Status: "queued", CreatedAt: base.Add(20 * time.Second)},
	}
	for _, e := range envelopes {
		if err := p.SaveEnvelope(e); err != nil {
			t.Fatalf("SaveEnvelope(%s): %v", e.ID, err)
		}
	}

	counts, err := p.QueuedCounts()
	if err != nil {
		t.Fatalf("QueuedCounts: %v", err)
	}
	if counts["s1"] != 2 || counts["s2"] != 1 {
		t.Fatalf("want counts s1=2 s2=1, got %v", counts)
	}

	supervisors, err := p.SupervisorsWithQueued()
	if err != nil {
		t.Fatalf("SupervisorsWithQueued: %v", err)
	}
	if len(supervisors) != 2 {
		t.Fatalf("want 2 supervisors with queued, got %v", supervisors)
	}

	next, err := p.NextQueuedEnvelope("s1")
	if err != nil {
		t.Fatalf("NextQueuedEnvelope: %v", err)
	}
	if next == nil || next.ID != "e1" {
		t.Fatalf("want oldest queued e1, got %+v", next)
	}

	if err := p.MarkEnvelopeDelivered("e1"); err != nil {
		t.Fatalf("MarkEnvelopeDelivered: %v", err)
	}

	queued, err := p.FindEnvelopes("s1", false)
	if err != nil {
		t.Fatalf("FindEnvelopes(queued): %v", err)
	}
	if len(queued) != 1 || queued[0].ID != "e2" {
		t.Fatalf("want only e2 queued, got %+v", queued)
	}

	all, err := p.FindEnvelopes("s1", true)
	if err != nil {
		t.Fatalf("FindEnvelopes(all): %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("want 2 envelopes including delivered, got %+v", all)
	}
	for _, e := range all {
		if e.ID == "e1" && (e.Status != "delivered" || e.DeliveredAt == nil) {
			t.Fatalf("want e1 delivered with timestamp, got %+v", e)
		}
	}

	counts, err = p.QueuedCounts()
	if err != nil {
		t.Fatalf("QueuedCounts after deliver: %v", err)
	}
	if counts["s1"] != 1 {
		t.Fatalf("want s1=1 after deliver, got %v", counts)
	}

	latest, err := p.LatestEnvelopeByWorker("s1")
	if err != nil {
		t.Fatalf("LatestEnvelopeByWorker: %v", err)
	}
	if latest["w1"].ID != "e2" {
		t.Fatalf("want latest w1 envelope e2, got %+v", latest["w1"])
	}
}

func TestCrewWatchdogLifecycle(t *testing.T) {
	db := newCrewTestDB(t)
	insertTestSessions(t, db, "w1", "s1")
	p := NewCrewPersistence(db)

	now := time.Now()
	if err := p.SaveWatchdog(entity.CrewWatchdog{ID: "wd1", WorkerSessionID: "w1", SupervisorSessionID: "s1", ExpectedBy: now.Add(-time.Minute), CreatedAt: now}); err != nil {
		t.Fatalf("SaveWatchdog: %v", err)
	}
	if err := p.SaveWatchdog(entity.CrewWatchdog{ID: "wd2", WorkerSessionID: "w1", SupervisorSessionID: "s1", ExpectedBy: now.Add(time.Hour), CreatedAt: now}); err != nil {
		t.Fatalf("SaveWatchdog: %v", err)
	}

	due, err := p.FindDueWatchdogs(now)
	if err != nil {
		t.Fatalf("FindDueWatchdogs: %v", err)
	}
	if len(due) != 1 || due[0].ID != "wd1" {
		t.Fatalf("want only wd1 due, got %+v", due)
	}

	if err := p.MarkWatchdogFired("wd1"); err != nil {
		t.Fatalf("MarkWatchdogFired: %v", err)
	}
	due, err = p.FindDueWatchdogs(now)
	if err != nil {
		t.Fatalf("FindDueWatchdogs after fire: %v", err)
	}
	if len(due) != 0 {
		t.Fatalf("want no due watchdogs after fire, got %+v", due)
	}

	if err := p.ClearWatchdogsForWorker("w1"); err != nil {
		t.Fatalf("ClearWatchdogsForWorker: %v", err)
	}
	due, err = p.FindDueWatchdogs(now.Add(2 * time.Hour))
	if err != nil {
		t.Fatalf("FindDueWatchdogs after clear: %v", err)
	}
	if len(due) != 0 {
		t.Fatalf("want no watchdogs after clear, got %+v", due)
	}
}

func TestCrewDeliveryLockRoundTrip(t *testing.T) {
	db := newCrewTestDB(t)
	insertTestSessions(t, db, "s1", "s2")
	p := NewCrewPersistence(db)

	// No locks initially.
	locks, err := p.DeliveryLocks()
	if err != nil {
		t.Fatalf("DeliveryLocks: %v", err)
	}
	if len(locks) != 0 {
		t.Fatalf("want no locks initially, got %v", locks)
	}

	if err := p.SetDeliveryLock("s1", true); err != nil {
		t.Fatalf("SetDeliveryLock(s1, true): %v", err)
	}

	locks, err = p.DeliveryLocks()
	if err != nil {
		t.Fatalf("DeliveryLocks: %v", err)
	}
	if len(locks) != 1 || !locks["s1"] {
		t.Fatalf("want s1 locked, got %v", locks)
	}
	locked, err := p.IsDeliveryLocked("s1")
	if err != nil || !locked {
		t.Fatalf("IsDeliveryLocked(s1) = %v, %v; want true, nil", locked, err)
	}
	locked, err = p.IsDeliveryLocked("s2")
	if err != nil || locked {
		t.Fatalf("IsDeliveryLocked(s2) = %v, %v; want false, nil", locked, err)
	}

	// Re-locking is idempotent (upsert).
	if err := p.SetDeliveryLock("s1", true); err != nil {
		t.Fatalf("SetDeliveryLock(s1, true) again: %v", err)
	}

	// Unlocking deletes the row.
	if err := p.SetDeliveryLock("s1", false); err != nil {
		t.Fatalf("SetDeliveryLock(s1, false): %v", err)
	}
	locks, err = p.DeliveryLocks()
	if err != nil {
		t.Fatalf("DeliveryLocks after unlock: %v", err)
	}
	if len(locks) != 0 {
		t.Fatalf("want no locks after unlock, got %v", locks)
	}

	// Deleting the supervisor session cascades its lock away.
	if err := p.SetDeliveryLock("s2", true); err != nil {
		t.Fatalf("SetDeliveryLock(s2, true): %v", err)
	}
	if _, err := db.Exec(`DELETE FROM sessions WHERE id = 's2'`); err != nil {
		t.Fatalf("delete supervisor session: %v", err)
	}
	locks, err = p.DeliveryLocks()
	if err != nil {
		t.Fatalf("DeliveryLocks after cascade: %v", err)
	}
	if len(locks) != 0 {
		t.Fatalf("want lock cascaded away, got %v", locks)
	}
}

func TestCrewCascadeOnSessionDelete(t *testing.T) {
	db := newCrewTestDB(t)
	insertTestSessions(t, db, "w1", "s1")
	p := NewCrewPersistence(db)

	now := time.Now()
	if err := p.SaveAssignment(entity.CrewAssignment{WorkerSessionID: "w1", SupervisorSessionID: "s1", CreatedAt: now}); err != nil {
		t.Fatalf("SaveAssignment: %v", err)
	}
	if err := p.SaveEnvelope(entity.CrewEnvelope{ID: "e1", FromSessionID: "w1", ToSessionID: "s1", Type: "done", Summary: "x", Status: "queued", CreatedAt: now}); err != nil {
		t.Fatalf("SaveEnvelope: %v", err)
	}
	if err := p.SaveWatchdog(entity.CrewWatchdog{ID: "wd1", WorkerSessionID: "w1", SupervisorSessionID: "s1", ExpectedBy: now, CreatedAt: now}); err != nil {
		t.Fatalf("SaveWatchdog: %v", err)
	}

	// Deleting the worker session cascades the assignment and watchdog, but the
	// envelope survives: from_session_id has no FK so reports outlive workers.
	if _, err := db.Exec(`DELETE FROM sessions WHERE id = 'w1'`); err != nil {
		t.Fatalf("delete worker session: %v", err)
	}

	assignment, err := p.FindAssignmentByWorker("w1")
	if err != nil {
		t.Fatalf("FindAssignmentByWorker: %v", err)
	}
	if assignment != nil {
		t.Fatalf("want assignment cascaded away, got %+v", assignment)
	}
	due, err := p.FindDueWatchdogs(now.Add(time.Hour))
	if err != nil {
		t.Fatalf("FindDueWatchdogs: %v", err)
	}
	if len(due) != 0 {
		t.Fatalf("want watchdogs cascaded away, got %+v", due)
	}
	envelopes, err := p.FindEnvelopes("s1", true)
	if err != nil {
		t.Fatalf("FindEnvelopes: %v", err)
	}
	if len(envelopes) != 1 {
		t.Fatalf("want envelope to survive worker deletion, got %+v", envelopes)
	}

	// Deleting the supervisor session cascades its inbox.
	if _, err := db.Exec(`DELETE FROM sessions WHERE id = 's1'`); err != nil {
		t.Fatalf("delete supervisor session: %v", err)
	}
	envelopes, err = p.FindEnvelopes("s1", true)
	if err != nil {
		t.Fatalf("FindEnvelopes after supervisor delete: %v", err)
	}
	if len(envelopes) != 0 {
		t.Fatalf("want inbox cascaded away, got %+v", envelopes)
	}
}
