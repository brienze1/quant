// Package persistence contains SQLite implementations of persistence interfaces.
package persistence

import (
	"database/sql"
	"fmt"
	"time"

	"quant/internal/domain/entity"
	"quant/internal/integration/adapter"
	pdto "quant/internal/integration/persistence/dto"
)

// crewPersistence implements the adapter.CrewPersistence interface using SQLite.
type crewPersistence struct {
	db *sql.DB
}

// NewCrewPersistence creates a new SQLite crew persistence implementation.
func NewCrewPersistence(db *sql.DB) adapter.CrewPersistence {
	return &crewPersistence{db: db}
}

const crewAssignmentColumns = `worker_session_id, supervisor_session_id, created_at`
const crewEnvelopeColumns = `id, from_session_id, to_session_id, type, summary, status, created_at, delivered_at`
const crewWatchdogColumns = `id, worker_session_id, supervisor_session_id, expected_by, fired, created_at`
const crewDeliveryLockColumns = `supervisor_session_id, locked, updated_at`

func scanCrewAssignmentRow(scanner interface{ Scan(...any) error }) (pdto.CrewAssignmentRow, error) {
	var row pdto.CrewAssignmentRow
	err := scanner.Scan(&row.WorkerSessionID, &row.SupervisorSessionID, &row.CreatedAt)
	return row, err
}

func scanCrewEnvelopeRow(scanner interface{ Scan(...any) error }) (pdto.CrewEnvelopeRow, error) {
	var row pdto.CrewEnvelopeRow
	err := scanner.Scan(
		&row.ID, &row.FromSessionID, &row.ToSessionID, &row.Type, &row.Summary,
		&row.Status, &row.CreatedAt, &row.DeliveredAt,
	)
	return row, err
}

func scanCrewWatchdogRow(scanner interface{ Scan(...any) error }) (pdto.CrewWatchdogRow, error) {
	var row pdto.CrewWatchdogRow
	err := scanner.Scan(
		&row.ID, &row.WorkerSessionID, &row.SupervisorSessionID, &row.ExpectedBy,
		&row.Fired, &row.CreatedAt,
	)
	return row, err
}

// FindAssignmentByWorker retrieves a worker's crew assignment, or nil when unassigned.
func (p *crewPersistence) FindAssignmentByWorker(workerSessionID string) (*entity.CrewAssignment, error) {
	query := `SELECT ` + crewAssignmentColumns + ` FROM crew_assignments WHERE worker_session_id = ?`
	row, err := scanCrewAssignmentRow(p.db.QueryRow(query, workerSessionID))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to find crew assignment by worker: %w", err)
	}

	assignment := row.ToEntity()
	return &assignment, nil
}

// FindAssignmentsBySupervisor retrieves all worker assignments under a supervisor.
func (p *crewPersistence) FindAssignmentsBySupervisor(supervisorSessionID string) ([]entity.CrewAssignment, error) {
	query := `SELECT ` + crewAssignmentColumns + ` FROM crew_assignments WHERE supervisor_session_id = ? ORDER BY created_at ASC`
	rows, err := p.db.Query(query, supervisorSessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to find crew assignments by supervisor: %w", err)
	}
	defer rows.Close()

	var assignments []entity.CrewAssignment
	for rows.Next() {
		row, err := scanCrewAssignmentRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan crew assignment row: %w", err)
		}
		assignments = append(assignments, row.ToEntity())
	}
	return assignments, rows.Err()
}

// FindAllAssignments retrieves every crew assignment.
func (p *crewPersistence) FindAllAssignments() ([]entity.CrewAssignment, error) {
	query := `SELECT ` + crewAssignmentColumns + ` FROM crew_assignments ORDER BY created_at ASC`
	rows, err := p.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to find crew assignments: %w", err)
	}
	defer rows.Close()

	var assignments []entity.CrewAssignment
	for rows.Next() {
		row, err := scanCrewAssignmentRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan crew assignment row: %w", err)
		}
		assignments = append(assignments, row.ToEntity())
	}
	return assignments, rows.Err()
}

// SaveAssignment upserts a worker's crew assignment (assign = move between crews).
func (p *crewPersistence) SaveAssignment(assignment entity.CrewAssignment) error {
	row := pdto.CrewAssignmentRowFromEntity(assignment)

	_, err := p.db.Exec(
		`INSERT OR REPLACE INTO crew_assignments (`+crewAssignmentColumns+`) VALUES (?, ?, ?)`,
		row.WorkerSessionID, row.SupervisorSessionID, row.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save crew assignment: %w", err)
	}
	return nil
}

// DeleteAssignment removes a worker's crew assignment.
func (p *crewPersistence) DeleteAssignment(workerSessionID string) error {
	_, err := p.db.Exec(`DELETE FROM crew_assignments WHERE worker_session_id = ?`, workerSessionID)
	if err != nil {
		return fmt.Errorf("failed to delete crew assignment: %w", err)
	}
	return nil
}

// FindEnvelopes retrieves the envelopes addressed to a session, queued first then
// newest first within each status. Delivered envelopes are included on request.
func (p *crewPersistence) FindEnvelopes(toSessionID string, includeDelivered bool) ([]entity.CrewEnvelope, error) {
	query := `SELECT ` + crewEnvelopeColumns + ` FROM crew_envelopes WHERE to_session_id = ?`
	if !includeDelivered {
		query += ` AND status = 'queued'`
	}
	query += ` ORDER BY CASE status WHEN 'queued' THEN 0 ELSE 1 END ASC, created_at DESC`

	rows, err := p.db.Query(query, toSessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to find crew envelopes: %w", err)
	}
	defer rows.Close()

	var envelopes []entity.CrewEnvelope
	for rows.Next() {
		row, err := scanCrewEnvelopeRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan crew envelope row: %w", err)
		}
		envelopes = append(envelopes, row.ToEntity())
	}
	return envelopes, rows.Err()
}

// NextQueuedEnvelope retrieves the oldest queued envelope for a session, or nil when the inbox is drained.
func (p *crewPersistence) NextQueuedEnvelope(toSessionID string) (*entity.CrewEnvelope, error) {
	query := `SELECT ` + crewEnvelopeColumns + ` FROM crew_envelopes WHERE to_session_id = ? AND status = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1`
	row, err := scanCrewEnvelopeRow(p.db.QueryRow(query, toSessionID))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to find next queued crew envelope: %w", err)
	}

	envelope := row.ToEntity()
	return &envelope, nil
}

// QueuedCounts returns the number of queued envelopes per recipient session.
func (p *crewPersistence) QueuedCounts() (map[string]int, error) {
	rows, err := p.db.Query(`SELECT to_session_id, COUNT(*) FROM crew_envelopes WHERE status = 'queued' GROUP BY to_session_id`)
	if err != nil {
		return nil, fmt.Errorf("failed to count queued crew envelopes: %w", err)
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var sessionID string
		var count int
		if err := rows.Scan(&sessionID, &count); err != nil {
			return nil, fmt.Errorf("failed to scan queued crew envelope count: %w", err)
		}
		counts[sessionID] = count
	}
	return counts, rows.Err()
}

// SupervisorsWithQueued returns the distinct recipient session ids that have queued envelopes.
func (p *crewPersistence) SupervisorsWithQueued() ([]string, error) {
	rows, err := p.db.Query(`SELECT DISTINCT to_session_id FROM crew_envelopes WHERE status = 'queued' ORDER BY to_session_id`)
	if err != nil {
		return nil, fmt.Errorf("failed to list supervisors with queued crew envelopes: %w", err)
	}
	defer rows.Close()

	var supervisors []string
	for rows.Next() {
		var sessionID string
		if err := rows.Scan(&sessionID); err != nil {
			return nil, fmt.Errorf("failed to scan supervisor session id: %w", err)
		}
		supervisors = append(supervisors, sessionID)
	}
	return supervisors, rows.Err()
}

// LatestEnvelopeByWorker returns each worker's most recent envelope addressed to a supervisor, keyed by worker session id.
func (p *crewPersistence) LatestEnvelopeByWorker(supervisorSessionID string) (map[string]entity.CrewEnvelope, error) {
	query := `SELECT ` + crewEnvelopeColumns + ` FROM crew_envelopes WHERE to_session_id = ? ORDER BY created_at ASC, id ASC`
	rows, err := p.db.Query(query, supervisorSessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to find latest crew envelopes by worker: %w", err)
	}
	defer rows.Close()

	latest := make(map[string]entity.CrewEnvelope)
	for rows.Next() {
		row, err := scanCrewEnvelopeRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan crew envelope row: %w", err)
		}
		envelope := row.ToEntity()
		latest[envelope.FromSessionID] = envelope
	}
	return latest, rows.Err()
}

// SaveEnvelope inserts (or replaces) a crew envelope.
func (p *crewPersistence) SaveEnvelope(envelope entity.CrewEnvelope) error {
	row := pdto.CrewEnvelopeRowFromEntity(envelope)

	_, err := p.db.Exec(
		`INSERT OR REPLACE INTO crew_envelopes (`+crewEnvelopeColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		row.ID, row.FromSessionID, row.ToSessionID, row.Type, row.Summary,
		row.Status, row.CreatedAt, row.DeliveredAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save crew envelope: %w", err)
	}
	return nil
}

// MarkEnvelopeDelivered flips an envelope to delivered and stamps the delivery time.
func (p *crewPersistence) MarkEnvelopeDelivered(id string) error {
	_, err := p.db.Exec(
		`UPDATE crew_envelopes SET status = 'delivered', delivered_at = ? WHERE id = ?`,
		time.Now().Format(time.RFC3339), id,
	)
	if err != nil {
		return fmt.Errorf("failed to mark crew envelope delivered: %w", err)
	}
	return nil
}

// FindDueWatchdogs retrieves the unfired watchdogs whose deadline has passed.
func (p *crewPersistence) FindDueWatchdogs(now time.Time) ([]entity.CrewWatchdog, error) {
	query := `SELECT ` + crewWatchdogColumns + ` FROM crew_watchdogs WHERE fired = 0 AND expected_by <= ? ORDER BY expected_by ASC`
	rows, err := p.db.Query(query, now.Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("failed to find due crew watchdogs: %w", err)
	}
	defer rows.Close()

	var watchdogs []entity.CrewWatchdog
	for rows.Next() {
		row, err := scanCrewWatchdogRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan crew watchdog row: %w", err)
		}
		watchdogs = append(watchdogs, row.ToEntity())
	}
	return watchdogs, rows.Err()
}

// SaveWatchdog inserts (or replaces) a crew watchdog.
func (p *crewPersistence) SaveWatchdog(watchdog entity.CrewWatchdog) error {
	row := pdto.CrewWatchdogRowFromEntity(watchdog)

	_, err := p.db.Exec(
		`INSERT OR REPLACE INTO crew_watchdogs (`+crewWatchdogColumns+`) VALUES (?, ?, ?, ?, ?, ?)`,
		row.ID, row.WorkerSessionID, row.SupervisorSessionID, row.ExpectedBy,
		row.Fired, row.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save crew watchdog: %w", err)
	}
	return nil
}

// MarkWatchdogFired flips a watchdog to fired so it only nudges once.
func (p *crewPersistence) MarkWatchdogFired(id string) error {
	_, err := p.db.Exec(`UPDATE crew_watchdogs SET fired = 1 WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("failed to mark crew watchdog fired: %w", err)
	}
	return nil
}

// ClearWatchdogsForWorker removes every watchdog set for a worker.
func (p *crewPersistence) ClearWatchdogsForWorker(workerSessionID string) error {
	_, err := p.db.Exec(`DELETE FROM crew_watchdogs WHERE worker_session_id = ?`, workerSessionID)
	if err != nil {
		return fmt.Errorf("failed to clear crew watchdogs for worker: %w", err)
	}
	return nil
}

// DeliveryLocks returns the supervisors whose "always deliver" lock is on,
// keyed by supervisor session id. Unlocked supervisors keep no row.
func (p *crewPersistence) DeliveryLocks() (map[string]bool, error) {
	rows, err := p.db.Query(`SELECT supervisor_session_id FROM crew_delivery_locks WHERE locked = 1`)
	if err != nil {
		return nil, fmt.Errorf("failed to list crew delivery locks: %w", err)
	}
	defer rows.Close()

	locks := make(map[string]bool)
	for rows.Next() {
		var sessionID string
		if err := rows.Scan(&sessionID); err != nil {
			return nil, fmt.Errorf("failed to scan crew delivery lock: %w", err)
		}
		locks[sessionID] = true
	}
	return locks, rows.Err()
}

// IsDeliveryLocked reports whether a supervisor's "always deliver" lock is on.
func (p *crewPersistence) IsDeliveryLocked(supervisorSessionID string) (bool, error) {
	var locked int
	err := p.db.QueryRow(`SELECT locked FROM crew_delivery_locks WHERE supervisor_session_id = ?`, supervisorSessionID).Scan(&locked)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("failed to read crew delivery lock: %w", err)
	}
	return locked != 0, nil
}

// SetDeliveryLock upserts a supervisor's "always deliver" lock. Turning the lock
// off deletes the row so the table only holds active locks.
func (p *crewPersistence) SetDeliveryLock(supervisorSessionID string, locked bool) error {
	if !locked {
		if _, err := p.db.Exec(`DELETE FROM crew_delivery_locks WHERE supervisor_session_id = ?`, supervisorSessionID); err != nil {
			return fmt.Errorf("failed to clear crew delivery lock: %w", err)
		}
		return nil
	}

	_, err := p.db.Exec(
		`INSERT OR REPLACE INTO crew_delivery_locks (`+crewDeliveryLockColumns+`) VALUES (?, ?, ?)`,
		supervisorSessionID, 1, time.Now().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("failed to save crew delivery lock: %w", err)
	}
	return nil
}
