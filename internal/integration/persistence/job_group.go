// Package persistence contains SQLite implementations of persistence interfaces.
package persistence

import (
	"database/sql"
	"fmt"

	"github.com/google/uuid"

	"quant/internal/domain/entity"
	"quant/internal/integration/adapter"
	pdto "quant/internal/integration/persistence/dto"
)

// jobGroupPersistence implements the adapter.JobGroupPersistence interface using SQLite.
type jobGroupPersistence struct {
	db *sql.DB
}

// NewJobGroupPersistence creates a new SQLite job group persistence implementation.
func NewJobGroupPersistence(db *sql.DB) adapter.JobGroupPersistence {
	return &jobGroupPersistence{db: db}
}

const jobGroupColumns = `id, name, workspace_id, created_at, updated_at`

func scanJobGroupRow(scanner interface{ Scan(...any) error }) (pdto.JobGroupRow, error) {
	var row pdto.JobGroupRow
	err := scanner.Scan(&row.ID, &row.Name, &row.WorkspaceID, &row.CreatedAt, &row.UpdatedAt)
	return row, err
}

// loadJobIDs fetches all job IDs for a given group.
func (p *jobGroupPersistence) loadJobIDs(groupID string) ([]string, error) {
	rows, err := p.db.Query(`SELECT job_id FROM job_group_members WHERE job_group_id = ?`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// FindJobGroupByID retrieves a job group by its ID.
func (p *jobGroupPersistence) FindJobGroupByID(id string) (*entity.JobGroup, error) {
	query := `SELECT ` + jobGroupColumns + ` FROM job_groups WHERE id = ?`
	row, err := scanJobGroupRow(p.db.QueryRow(query, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to find job group by id: %w", err)
	}

	group := row.ToEntity()
	group.JobIDs, err = p.loadJobIDs(id)
	if err != nil {
		return nil, fmt.Errorf("failed to load job group members: %w", err)
	}

	return &group, nil
}

// FindJobGroupsByWorkspace retrieves all job groups for a specific workspace.
func (p *jobGroupPersistence) FindJobGroupsByWorkspace(workspaceID string) ([]entity.JobGroup, error) {
	query := `SELECT ` + jobGroupColumns + ` FROM job_groups WHERE workspace_id = ? ORDER BY created_at ASC`
	rows, err := p.db.Query(query, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to find job groups: %w", err)
	}
	defer rows.Close()

	var groups []entity.JobGroup
	for rows.Next() {
		row, err := scanJobGroupRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan job group row: %w", err)
		}
		group := row.ToEntity()
		group.JobIDs, err = p.loadJobIDs(group.ID)
		if err != nil {
			return nil, fmt.Errorf("failed to load job group members: %w", err)
		}
		groups = append(groups, group)
	}
	return groups, rows.Err()
}

// SaveJobGroup persists a new job group with its member jobs.
func (p *jobGroupPersistence) SaveJobGroup(group entity.JobGroup) error {
	row := pdto.JobGroupRowFromEntity(group)

	_, err := p.db.Exec(
		`INSERT INTO job_groups (id, name, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		row.ID, row.Name, row.WorkspaceID, row.CreatedAt, row.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save job group: %w", err)
	}

	for _, jobID := range group.JobIDs {
		_, err := p.db.Exec(
			`INSERT OR IGNORE INTO job_group_members (id, job_group_id, job_id) VALUES (?, ?, ?)`,
			uuid.New().String(), group.ID, jobID,
		)
		if err != nil {
			return fmt.Errorf("failed to save job group member: %w", err)
		}
	}

	return nil
}

// UpdateJobGroup updates a job group and replaces its member jobs.
func (p *jobGroupPersistence) UpdateJobGroup(group entity.JobGroup) error {
	row := pdto.JobGroupRowFromEntity(group)

	result, err := p.db.Exec(
		`UPDATE job_groups SET name = ?, workspace_id = ?, updated_at = ? WHERE id = ?`,
		row.Name, row.WorkspaceID, row.UpdatedAt, row.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update job group: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("job group not found: %s", group.ID)
	}

	// Replace members
	_, _ = p.db.Exec(`DELETE FROM job_group_members WHERE job_group_id = ?`, group.ID)
	for _, jobID := range group.JobIDs {
		_, err := p.db.Exec(
			`INSERT OR IGNORE INTO job_group_members (id, job_group_id, job_id) VALUES (?, ?, ?)`,
			uuid.New().String(), group.ID, jobID,
		)
		if err != nil {
			return fmt.Errorf("failed to save job group member: %w", err)
		}
	}

	return nil
}

// DeleteJobGroup removes a job group by its ID (cascade deletes members).
func (p *jobGroupPersistence) DeleteJobGroup(id string) error {
	_, _ = p.db.Exec(`DELETE FROM job_group_members WHERE job_group_id = ?`, id)

	result, err := p.db.Exec(`DELETE FROM job_groups WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("failed to delete job group: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("job group not found: %s", id)
	}
	return nil
}
