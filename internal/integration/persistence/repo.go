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

// repoPersistence implements the adapter.RepoPersistence interface using SQLite.
type repoPersistence struct {
	db *sql.DB
}

// NewRepoPersistence creates a new SQLite repo persistence implementation.
// Returns the adapter.RepoPersistence interface, not the concrete type.
func NewRepoPersistence(db *sql.DB) adapter.RepoPersistence {
	return &repoPersistence{db: db}
}

// FindRepoByID retrieves a repo by its ID.
func (p *repoPersistence) FindRepoByID(id string) (*entity.Repo, error) {
	query := `SELECT id, name, path, created_at, updated_at, closed_at FROM repos WHERE id = ?`

	var row pdto.RepoRow
	err := p.db.QueryRow(query, id).Scan(
		&row.ID, &row.Name, &row.Path, &row.CreatedAt, &row.UpdatedAt, &row.ClosedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to find repo by id: %w", err)
	}

	repo := row.ToEntity()
	return &repo, nil
}

// FindRepoByPath retrieves a repo by its filesystem path.
func (p *repoPersistence) FindRepoByPath(path string) (*entity.Repo, error) {
	query := `SELECT id, name, path, created_at, updated_at, closed_at FROM repos WHERE path = ?`

	var row pdto.RepoRow
	err := p.db.QueryRow(query, path).Scan(
		&row.ID, &row.Name, &row.Path, &row.CreatedAt, &row.UpdatedAt, &row.ClosedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to find repo by path: %w", err)
	}

	repo := row.ToEntity()
	return &repo, nil
}

// FindAllRepos retrieves all open (non-closed) repos.
func (p *repoPersistence) FindAllRepos() ([]entity.Repo, error) {
	query := `SELECT id, name, path, created_at, updated_at, closed_at FROM repos WHERE closed_at IS NULL ORDER BY created_at DESC`

	rows, err := p.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to find all repos: %w", err)
	}
	defer rows.Close()

	var repos []entity.Repo
	for rows.Next() {
		var row pdto.RepoRow
		err := rows.Scan(
			&row.ID, &row.Name, &row.Path, &row.CreatedAt, &row.UpdatedAt, &row.ClosedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan repo row: %w", err)
		}
		repos = append(repos, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating repo rows: %w", err)
	}

	return repos, nil
}

// SaveRepo persists a new repo to the database.
func (p *repoPersistence) SaveRepo(repo entity.Repo) error {
	row := pdto.RepoRowFromEntity(repo)

	query := `INSERT INTO repos (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`

	_, err := p.db.Exec(query, row.ID, row.Name, row.Path, row.CreatedAt, row.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to save repo: %w", err)
	}

	return nil
}

// DeleteRepo soft-closes a repo by setting its closed_at timestamp.
func (p *repoPersistence) DeleteRepo(id string) error {
	query := `UPDATE repos SET closed_at = ?, updated_at = ? WHERE id = ?`

	now := time.Now().Format(time.RFC3339)
	result, err := p.db.Exec(query, now, now, id)
	if err != nil {
		return fmt.Errorf("failed to close repo: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("repo not found: %s", id)
	}

	return nil
}

// ReopenRepo clears the closed_at timestamp to reopen a previously closed repo.
func (p *repoPersistence) ReopenRepo(id string, name string) error {
	query := `UPDATE repos SET closed_at = NULL, name = ?, updated_at = ? WHERE id = ?`

	now := time.Now().Format(time.RFC3339)
	_, err := p.db.Exec(query, name, now, id)
	if err != nil {
		return fmt.Errorf("failed to reopen repo: %w", err)
	}

	return nil
}

// UpdateRepo updates all fields of a repo.
func (p *repoPersistence) UpdateRepo(repo entity.Repo) error {
	row := pdto.RepoRowFromEntity(repo)

	query := `UPDATE repos SET name = ?, path = ?, updated_at = ? WHERE id = ?`

	result, err := p.db.Exec(query, row.Name, row.Path, row.UpdatedAt, row.ID)
	if err != nil {
		return fmt.Errorf("failed to update repo: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("repo not found: %s", repo.ID)
	}

	return nil
}
