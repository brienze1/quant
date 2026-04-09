// Package dto contains persistence data transfer objects for SQLite row mapping.
package dto

import (
	"database/sql"
	"time"

	"quant/internal/domain/entity"
)

// JobRunRow represents a job run row in the SQLite database.
type JobRunRow struct {
	ID           string
	JobID        string
	Status       string
	TriggeredBy   sql.NullString
	CorrelationID string
	SessionID     sql.NullString
	ModelUsed    string
	DurationMs   int64
	TokensUsed   int
	Result          string
	ErrorMessage    string
	InjectedContext string
	StartedAt       string
	FinishedAt   sql.NullString
}

// ToEntity converts a JobRunRow to a domain entity.
func (r JobRunRow) ToEntity() entity.JobRun {
	startedAt, _ := time.Parse(time.RFC3339, r.StartedAt)

	var finishedAt *time.Time
	if r.FinishedAt.Valid {
		t, _ := time.Parse(time.RFC3339, r.FinishedAt.String)
		finishedAt = &t
	}

	triggeredBy := ""
	if r.TriggeredBy.Valid {
		triggeredBy = r.TriggeredBy.String
	}

	sessionID := ""
	if r.SessionID.Valid {
		sessionID = r.SessionID.String
	}

	return entity.JobRun{
		ID:           r.ID,
		JobID:        r.JobID,
		Status:       r.Status,
		TriggeredBy:   triggeredBy,
		CorrelationID: r.CorrelationID,
		SessionID:     sessionID,
		ModelUsed:     r.ModelUsed,
		DurationMs:   r.DurationMs,
		TokensUsed:   r.TokensUsed,
		Result:          r.Result,
		ErrorMessage:    r.ErrorMessage,
		InjectedContext: r.InjectedContext,
		StartedAt:       startedAt,
		FinishedAt:      finishedAt,
	}
}

// JobRunRowFromEntity converts a domain entity to a JobRunRow.
func JobRunRowFromEntity(run entity.JobRun) JobRunRow {
	var finishedAt sql.NullString
	if run.FinishedAt != nil {
		finishedAt = sql.NullString{String: run.FinishedAt.Format(time.RFC3339), Valid: true}
	}

	var triggeredBy sql.NullString
	if run.TriggeredBy != "" {
		triggeredBy = sql.NullString{String: run.TriggeredBy, Valid: true}
	}

	var sessionID sql.NullString
	if run.SessionID != "" {
		sessionID = sql.NullString{String: run.SessionID, Valid: true}
	}

	return JobRunRow{
		ID:            run.ID,
		JobID:         run.JobID,
		Status:        run.Status,
		TriggeredBy:   triggeredBy,
		CorrelationID: run.CorrelationID,
		SessionID:     sessionID,
		ModelUsed:     run.ModelUsed,
		DurationMs:   run.DurationMs,
		TokensUsed:   run.TokensUsed,
		Result:          run.Result,
		ErrorMessage:    run.ErrorMessage,
		InjectedContext: run.InjectedContext,
		StartedAt:       run.StartedAt.Format(time.RFC3339),
		FinishedAt:   finishedAt,
	}
}
