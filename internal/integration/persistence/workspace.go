// Package persistence contains SQLite implementations of persistence interfaces.
package persistence

import (
	"database/sql"
	"fmt"

	"quant/internal/domain/entity"
	"quant/internal/integration/adapter"
	pdto "quant/internal/integration/persistence/dto"
)

// workspacePersistence implements the adapter.WorkspacePersistence interface using SQLite.
type workspacePersistence struct {
	db *sql.DB
}

// NewWorkspacePersistence creates a new SQLite workspace persistence implementation.
func NewWorkspacePersistence(db *sql.DB) adapter.WorkspacePersistence {
	return &workspacePersistence{db: db}
}

const workspaceColumns = `id, name, claude_config_path, mcp_config_path, created_at, updated_at`

func scanWorkspaceRow(scanner interface{ Scan(...any) error }) (pdto.WorkspaceRow, error) {
	var row pdto.WorkspaceRow
	err := scanner.Scan(
		&row.ID, &row.Name, &row.ClaudeConfigPath, &row.McpConfigPath, &row.CreatedAt, &row.UpdatedAt,
	)
	return row, err
}

// FindWorkspaceByID retrieves a workspace by its ID.
func (p *workspacePersistence) FindWorkspaceByID(id string) (*entity.Workspace, error) {
	query := `SELECT ` + workspaceColumns + ` FROM workspaces WHERE id = ?`

	row, err := scanWorkspaceRow(p.db.QueryRow(query, id))

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to find workspace by id: %w", err)
	}

	workspace := row.ToEntity()
	return &workspace, nil
}

// FindAllWorkspaces retrieves all workspaces.
func (p *workspacePersistence) FindAllWorkspaces() ([]entity.Workspace, error) {
	query := `SELECT ` + workspaceColumns + ` FROM workspaces ORDER BY created_at ASC`

	rows, err := p.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to find all workspaces: %w", err)
	}
	defer rows.Close()

	var workspaces []entity.Workspace
	for rows.Next() {
		row, err := scanWorkspaceRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan workspace row: %w", err)
		}
		workspaces = append(workspaces, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating workspace rows: %w", err)
	}

	return workspaces, nil
}

// SaveWorkspace persists a new workspace to the database.
func (p *workspacePersistence) SaveWorkspace(workspace entity.Workspace) error {
	row := pdto.WorkspaceRowFromEntity(workspace)

	query := `INSERT INTO workspaces (id, name, claude_config_path, mcp_config_path, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)`

	_, err := p.db.Exec(query,
		row.ID, row.Name, row.ClaudeConfigPath, row.McpConfigPath, row.CreatedAt, row.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save workspace: %w", err)
	}

	return nil
}

// UpdateWorkspace updates all fields of a workspace.
func (p *workspacePersistence) UpdateWorkspace(workspace entity.Workspace) error {
	row := pdto.WorkspaceRowFromEntity(workspace)

	query := `UPDATE workspaces SET name = ?, claude_config_path = ?, mcp_config_path = ?, updated_at = ? WHERE id = ?`

	result, err := p.db.Exec(query, row.Name, row.ClaudeConfigPath, row.McpConfigPath, row.UpdatedAt, row.ID)
	if err != nil {
		return fmt.Errorf("failed to update workspace: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("workspace not found: %s", workspace.ID)
	}

	return nil
}

// DeleteWorkspace removes a workspace by its ID.
// All entities belonging to this workspace are deleted.
func (p *workspacePersistence) DeleteWorkspace(id string) error {
	// Delete all entities belonging to this workspace
	_, _ = p.db.Exec(`DELETE FROM actions WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?)`, id)
	_, _ = p.db.Exec(`DELETE FROM sessions WHERE workspace_id = ?`, id)
	_, _ = p.db.Exec(`DELETE FROM job_runs WHERE job_id IN (SELECT id FROM jobs WHERE workspace_id = ?)`, id)
	_, _ = p.db.Exec(`DELETE FROM job_triggers WHERE source_job_id IN (SELECT id FROM jobs WHERE workspace_id = ?) OR target_job_id IN (SELECT id FROM jobs WHERE workspace_id = ?)`, id, id)
	_, _ = p.db.Exec(`DELETE FROM jobs WHERE workspace_id = ?`, id)
	_, _ = p.db.Exec(`DELETE FROM agents WHERE workspace_id = ?`, id)
	_, _ = p.db.Exec(`DELETE FROM tasks WHERE repo_id IN (SELECT id FROM repos WHERE workspace_id = ?)`, id)
	_, _ = p.db.Exec(`DELETE FROM repos WHERE workspace_id = ?`, id)

	query := `DELETE FROM workspaces WHERE id = ?`

	result, err := p.db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("failed to delete workspace: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("workspace not found: %s", id)
	}

	return nil
}
