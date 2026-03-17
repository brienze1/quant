// Package dto contains persistence data transfer objects for SQLite row mapping.
package dto

import (
	"time"

	"quant/internal/domain/entity"
)

// RepoRow represents a repo row in the SQLite database.
type RepoRow struct {
	ID        string
	Name      string
	Path      string
	CreatedAt string
	UpdatedAt string
	ClosedAt  *string
}

// ToEntity converts a RepoRow to a domain entity.
func (r RepoRow) ToEntity() entity.Repo {
	createdAt, _ := time.Parse(time.RFC3339, r.CreatedAt)
	updatedAt, _ := time.Parse(time.RFC3339, r.UpdatedAt)

	repo := entity.Repo{
		ID:        r.ID,
		Name:      r.Name,
		Path:      r.Path,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}

	if r.ClosedAt != nil {
		t, _ := time.Parse(time.RFC3339, *r.ClosedAt)
		repo.ClosedAt = &t
	}

	return repo
}

// RepoRowFromEntity converts a domain entity to a RepoRow.
func RepoRowFromEntity(repo entity.Repo) RepoRow {
	row := RepoRow{
		ID:        repo.ID,
		Name:      repo.Name,
		Path:      repo.Path,
		CreatedAt: repo.CreatedAt.Format(time.RFC3339),
		UpdatedAt: repo.UpdatedAt.Format(time.RFC3339),
	}

	if repo.ClosedAt != nil {
		s := repo.ClosedAt.Format(time.RFC3339)
		row.ClosedAt = &s
	}

	return row
}
