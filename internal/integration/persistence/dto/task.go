// Package dto contains persistence data transfer objects for SQLite row mapping.
package dto

import (
	"database/sql"
	"time"

	"quant/internal/domain/entity"
)

// TaskRow represents a task row in the SQLite database.
type TaskRow struct {
	ID         string
	RepoID     string
	Tag        string
	Name       string
	CreatedAt  string
	UpdatedAt  string
	ArchivedAt sql.NullString
}

// ToEntity converts a TaskRow to a domain entity.
func (r TaskRow) ToEntity() entity.Task {
	createdAt, _ := time.Parse(time.RFC3339, r.CreatedAt)
	updatedAt, _ := time.Parse(time.RFC3339, r.UpdatedAt)

	var archivedAt *time.Time
	if r.ArchivedAt.Valid {
		t, _ := time.Parse(time.RFC3339, r.ArchivedAt.String)
		archivedAt = &t
	}

	return entity.Task{
		ID:         r.ID,
		RepoID:     r.RepoID,
		Tag:        r.Tag,
		Name:       r.Name,
		CreatedAt:  createdAt,
		UpdatedAt:  updatedAt,
		ArchivedAt: archivedAt,
	}
}

// TaskRowFromEntity converts a domain entity to a TaskRow.
func TaskRowFromEntity(task entity.Task) TaskRow {
	var archivedAt sql.NullString
	if task.ArchivedAt != nil {
		archivedAt = sql.NullString{String: task.ArchivedAt.Format(time.RFC3339), Valid: true}
	}

	return TaskRow{
		ID:         task.ID,
		RepoID:     task.RepoID,
		Tag:        task.Tag,
		Name:       task.Name,
		CreatedAt:  task.CreatedAt.Format(time.RFC3339),
		UpdatedAt:  task.UpdatedAt.Format(time.RFC3339),
		ArchivedAt: archivedAt,
	}
}
