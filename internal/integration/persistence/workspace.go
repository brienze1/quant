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

// workspaceColumns lists the workspace columns in scan order. voice_config is
// appended last (it was added via ALTER TABLE), and the scan + INSERT below must
// keep the same ordering. voice_config is nullable, so it is scanned into a
// sql.NullString and copied into the row only when present.
const workspaceColumns = `id, name, claude_config_path, mcp_config_path, created_at, updated_at, voice_config`

func scanWorkspaceRow(scanner interface{ Scan(...any) error }) (pdto.WorkspaceRow, error) {
	var row pdto.WorkspaceRow
	var voiceConfig sql.NullString
	err := scanner.Scan(
		&row.ID, &row.Name, &row.ClaudeConfigPath, &row.McpConfigPath, &row.CreatedAt, &row.UpdatedAt, &voiceConfig,
	)
	if voiceConfig.Valid {
		row.VoiceConfig = voiceConfig.String
	}
	return row, err
}

// nullableString maps "" to a NULL voice_config column (no override) and any
// non-empty JSON blob to a stored string, so an absent override reads back as
// NULL rather than an empty string.
func nullableString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
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

	query := `INSERT INTO workspaces (id, name, claude_config_path, mcp_config_path, created_at, updated_at, voice_config)
		VALUES (?, ?, ?, ?, ?, ?, ?)`

	_, err := p.db.Exec(query,
		row.ID, row.Name, row.ClaudeConfigPath, row.McpConfigPath, row.CreatedAt, row.UpdatedAt, nullableString(row.VoiceConfig),
	)
	if err != nil {
		return fmt.Errorf("failed to save workspace: %w", err)
	}

	return nil
}

// UpdateWorkspace updates all fields of a workspace.
func (p *workspacePersistence) UpdateWorkspace(workspace entity.Workspace) error {
	row := pdto.WorkspaceRowFromEntity(workspace)

	query := `UPDATE workspaces SET name = ?, claude_config_path = ?, mcp_config_path = ?, voice_config = ?, updated_at = ? WHERE id = ?`

	result, err := p.db.Exec(query, row.Name, row.ClaudeConfigPath, row.McpConfigPath, nullableString(row.VoiceConfig), row.UpdatedAt, row.ID)
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
