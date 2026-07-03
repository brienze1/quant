// Package dto contains persistence data transfer objects for SQLite row mapping.
package dto

import (
	"database/sql"
	"time"

	"quant/internal/domain/entity"
)

// CrewAssignmentRow represents a crew_assignments row in the SQLite database.
type CrewAssignmentRow struct {
	WorkerSessionID     string
	SupervisorSessionID string
	CreatedAt           string
}

// ToEntity converts a CrewAssignmentRow to a domain entity.
func (r CrewAssignmentRow) ToEntity() entity.CrewAssignment {
	createdAt, _ := time.Parse(time.RFC3339, r.CreatedAt)

	return entity.CrewAssignment{
		WorkerSessionID:     r.WorkerSessionID,
		SupervisorSessionID: r.SupervisorSessionID,
		CreatedAt:           createdAt,
	}
}

// CrewAssignmentRowFromEntity converts a domain entity to a CrewAssignmentRow.
func CrewAssignmentRowFromEntity(a entity.CrewAssignment) CrewAssignmentRow {
	return CrewAssignmentRow{
		WorkerSessionID:     a.WorkerSessionID,
		SupervisorSessionID: a.SupervisorSessionID,
		CreatedAt:           a.CreatedAt.Format(time.RFC3339),
	}
}

// CrewEnvelopeRow represents a crew_envelopes row in the SQLite database.
type CrewEnvelopeRow struct {
	ID            string
	FromSessionID string
	ToSessionID   string
	Type          string
	Summary       string
	Status        string
	CreatedAt     string
	DeliveredAt   sql.NullString
}

// ToEntity converts a CrewEnvelopeRow to a domain entity.
func (r CrewEnvelopeRow) ToEntity() entity.CrewEnvelope {
	createdAt, _ := time.Parse(time.RFC3339, r.CreatedAt)

	var deliveredAt *time.Time
	if r.DeliveredAt.Valid {
		if t, err := time.Parse(time.RFC3339, r.DeliveredAt.String); err == nil {
			deliveredAt = &t
		}
	}

	return entity.CrewEnvelope{
		ID:            r.ID,
		FromSessionID: r.FromSessionID,
		ToSessionID:   r.ToSessionID,
		Type:          r.Type,
		Summary:       r.Summary,
		Status:        r.Status,
		CreatedAt:     createdAt,
		DeliveredAt:   deliveredAt,
	}
}

// CrewEnvelopeRowFromEntity converts a domain entity to a CrewEnvelopeRow.
func CrewEnvelopeRowFromEntity(e entity.CrewEnvelope) CrewEnvelopeRow {
	row := CrewEnvelopeRow{
		ID:            e.ID,
		FromSessionID: e.FromSessionID,
		ToSessionID:   e.ToSessionID,
		Type:          e.Type,
		Summary:       e.Summary,
		Status:        e.Status,
		CreatedAt:     e.CreatedAt.Format(time.RFC3339),
	}
	if e.DeliveredAt != nil {
		row.DeliveredAt = sql.NullString{String: e.DeliveredAt.Format(time.RFC3339), Valid: true}
	}
	return row
}

// CrewWatchdogRow represents a crew_watchdogs row in the SQLite database.
type CrewWatchdogRow struct {
	ID                  string
	WorkerSessionID     string
	SupervisorSessionID string
	ExpectedBy          string
	Fired               int
	CreatedAt           string
}

// ToEntity converts a CrewWatchdogRow to a domain entity.
func (r CrewWatchdogRow) ToEntity() entity.CrewWatchdog {
	expectedBy, _ := time.Parse(time.RFC3339, r.ExpectedBy)
	createdAt, _ := time.Parse(time.RFC3339, r.CreatedAt)

	return entity.CrewWatchdog{
		ID:                  r.ID,
		WorkerSessionID:     r.WorkerSessionID,
		SupervisorSessionID: r.SupervisorSessionID,
		ExpectedBy:          expectedBy,
		Fired:               r.Fired != 0,
		CreatedAt:           createdAt,
	}
}

// CrewWatchdogRowFromEntity converts a domain entity to a CrewWatchdogRow.
func CrewWatchdogRowFromEntity(w entity.CrewWatchdog) CrewWatchdogRow {
	fired := 0
	if w.Fired {
		fired = 1
	}
	return CrewWatchdogRow{
		ID:                  w.ID,
		WorkerSessionID:     w.WorkerSessionID,
		SupervisorSessionID: w.SupervisorSessionID,
		ExpectedBy:          w.ExpectedBy.Format(time.RFC3339),
		Fired:               fired,
		CreatedAt:           w.CreatedAt.Format(time.RFC3339),
	}
}
