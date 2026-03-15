// Package persistence contains SQLite implementations of persistence interfaces.
package persistence

import (
	"database/sql"
	"fmt"

	"quant/internal/domain/entity"
	"quant/internal/integration/adapter"
	pdto "quant/internal/integration/persistence/dto"
)

// sessionPersistence implements the adapter.SessionPersistence interface using SQLite.
type sessionPersistence struct {
	db *sql.DB
}

// NewSessionPersistence creates a new SQLite session persistence implementation.
// Returns the adapter.SessionPersistence interface, not the concrete type.
func NewSessionPersistence(db *sql.DB) adapter.SessionPersistence {
	return &sessionPersistence{db: db}
}

const sessionColumns = `id, name, description, status, directory, worktree_path, branch_name,
		claude_conv_id, pid, repo_id, task_id, skip_permissions, created_at, updated_at, last_active_at, archived_at`

func scanSessionRow(scanner interface{ Scan(...any) error }) (pdto.SessionRow, error) {
	var row pdto.SessionRow
	err := scanner.Scan(
		&row.ID, &row.Name, &row.Description, &row.Status, &row.Directory,
		&row.WorktreePath, &row.BranchName, &row.ClaudeConvID, &row.PID,
		&row.RepoID, &row.TaskID, &row.SkipPermissions, &row.CreatedAt, &row.UpdatedAt, &row.LastActiveAt,
		&row.ArchivedAt,
	)
	return row, err
}

// FindByID retrieves a session by its ID.
func (p *sessionPersistence) FindByID(id string) (*entity.Session, error) {
	query := `SELECT ` + sessionColumns + ` FROM sessions WHERE id = ?`

	row, err := scanSessionRow(p.db.QueryRow(query, id))

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to find session by id: %w", err)
	}

	session := row.ToEntity()
	return &session, nil
}

// FindAll retrieves all sessions.
func (p *sessionPersistence) FindAll() ([]entity.Session, error) {
	query := `SELECT ` + sessionColumns + ` FROM sessions ORDER BY last_active_at DESC`

	rows, err := p.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to find all sessions: %w", err)
	}
	defer rows.Close()

	var sessions []entity.Session
	for rows.Next() {
		row, err := scanSessionRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan session row: %w", err)
		}
		sessions = append(sessions, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating session rows: %w", err)
	}

	return sessions, nil
}

// FindByRepoID retrieves all sessions for a given repository.
func (p *sessionPersistence) FindByRepoID(repoID string) ([]entity.Session, error) {
	query := `SELECT ` + sessionColumns + ` FROM sessions WHERE repo_id = ? ORDER BY last_active_at DESC`

	rows, err := p.db.Query(query, repoID)
	if err != nil {
		return nil, fmt.Errorf("failed to find sessions by repo id: %w", err)
	}
	defer rows.Close()

	var sessions []entity.Session
	for rows.Next() {
		row, err := scanSessionRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan session row: %w", err)
		}
		sessions = append(sessions, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating session rows: %w", err)
	}

	return sessions, nil
}

// FindByTaskID retrieves all sessions for a given task.
func (p *sessionPersistence) FindByTaskID(taskID string) ([]entity.Session, error) {
	query := `SELECT ` + sessionColumns + ` FROM sessions WHERE task_id = ? ORDER BY last_active_at DESC`

	rows, err := p.db.Query(query, taskID)
	if err != nil {
		return nil, fmt.Errorf("failed to find sessions by task id: %w", err)
	}
	defer rows.Close()

	var sessions []entity.Session
	for rows.Next() {
		row, err := scanSessionRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan session row: %w", err)
		}
		sessions = append(sessions, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating session rows: %w", err)
	}

	return sessions, nil
}

// Save persists a new session to the database.
func (p *sessionPersistence) Save(session entity.Session) error {
	row := pdto.SessionRowFromEntity(session)

	query := `INSERT INTO sessions (id, name, description, status, directory, worktree_path,
		branch_name, claude_conv_id, pid, repo_id, task_id, skip_permissions, created_at, updated_at, last_active_at, archived_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := p.db.Exec(query,
		row.ID, row.Name, row.Description, row.Status, row.Directory,
		row.WorktreePath, row.BranchName, row.ClaudeConvID, row.PID,
		row.RepoID, row.TaskID, row.SkipPermissions,
		row.CreatedAt, row.UpdatedAt, row.LastActiveAt, row.ArchivedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save session: %w", err)
	}

	return nil
}

// Delete removes a session by its ID.
func (p *sessionPersistence) Delete(id string) error {
	query := `DELETE FROM sessions WHERE id = ?`

	result, err := p.db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("failed to delete session: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("session not found: %s", id)
	}

	return nil
}

// UpdateStatus updates only the status of a session.
func (p *sessionPersistence) UpdateStatus(id string, status string) error {
	query := `UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`

	result, err := p.db.Exec(query, status, id)
	if err != nil {
		return fmt.Errorf("failed to update session status: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("session not found: %s", id)
	}

	return nil
}

// Update updates all fields of a session.
func (p *sessionPersistence) Update(session entity.Session) error {
	row := pdto.SessionRowFromEntity(session)

	query := `UPDATE sessions SET name = ?, description = ?, status = ?, directory = ?,
		worktree_path = ?, branch_name = ?, claude_conv_id = ?, pid = ?,
		repo_id = ?, task_id = ?, skip_permissions = ?,
		updated_at = ?, last_active_at = ?, archived_at = ? WHERE id = ?`

	result, err := p.db.Exec(query,
		row.Name, row.Description, row.Status, row.Directory,
		row.WorktreePath, row.BranchName, row.ClaudeConvID, row.PID,
		row.RepoID, row.TaskID, row.SkipPermissions,
		row.UpdatedAt, row.LastActiveAt, row.ArchivedAt, row.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update session: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("session not found: %s", session.ID)
	}

	return nil
}
