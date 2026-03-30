// Package dto contains persistence data transfer objects for SQLite row mapping.
package dto

import (
	"database/sql"
	"encoding/json"
	"time"

	"quant/internal/domain/entity"
)

// JobRow represents a job row in the SQLite database.
type JobRow struct {
	ID                  string
	Name                string
	Description         string
	Type                string
	WorkingDirectory    string
	ScheduleEnabled     int
	ScheduleType        string
	CronExpression      string
	ScheduleInterval    int
	ScheduleStartTime   sql.NullString
	TimeoutSeconds      int
	Prompt              string
	AllowBypass         int
	AutonomousMode      int
	MaxRetries          int
	Model               string
	OverrideRepoCommand string
	ClaudeCommand       string
	SuccessPrompt       string
	FailurePrompt       string
	MetadataPrompt      string
	Interpreter         string
	ScriptContent       string
	EnvVariables        string // JSON
	CreatedAt           string
	UpdatedAt           string
	LastRunAt           sql.NullString
}

// ToEntity converts a JobRow to a domain entity.
func (r JobRow) ToEntity() entity.Job {
	createdAt, _ := time.Parse(time.RFC3339, r.CreatedAt)
	updatedAt, _ := time.Parse(time.RFC3339, r.UpdatedAt)

	var scheduleStartTime *time.Time
	if r.ScheduleStartTime.Valid {
		t, _ := time.Parse(time.RFC3339, r.ScheduleStartTime.String)
		scheduleStartTime = &t
	}

	envVars := make(map[string]string)
	if r.EnvVariables != "" {
		_ = json.Unmarshal([]byte(r.EnvVariables), &envVars)
	}

	var lastRunAt *time.Time
	if r.LastRunAt.Valid {
		t, _ := time.Parse(time.RFC3339, r.LastRunAt.String)
		lastRunAt = &t
	}

	return entity.Job{
		ID:                  r.ID,
		Name:                r.Name,
		Description:         r.Description,
		Type:                r.Type,
		WorkingDirectory:    r.WorkingDirectory,
		ScheduleEnabled:     r.ScheduleEnabled == 1,
		ScheduleType:        r.ScheduleType,
		CronExpression:      r.CronExpression,
		ScheduleInterval:    r.ScheduleInterval,
		ScheduleStartTime:   scheduleStartTime,
		TimeoutSeconds:      r.TimeoutSeconds,
		Prompt:              r.Prompt,
		AllowBypass:         r.AllowBypass == 1,
		AutonomousMode:      r.AutonomousMode == 1,
		MaxRetries:          r.MaxRetries,
		Model:               r.Model,
		OverrideRepoCommand: r.OverrideRepoCommand,
		ClaudeCommand:       r.ClaudeCommand,
		SuccessPrompt:       r.SuccessPrompt,
		FailurePrompt:       r.FailurePrompt,
		MetadataPrompt:      r.MetadataPrompt,
		Interpreter:         r.Interpreter,
		ScriptContent:       r.ScriptContent,
		EnvVariables:        envVars,
		CreatedAt:           createdAt,
		UpdatedAt:           updatedAt,
		LastRunAt:           lastRunAt,
	}
}

// JobRowFromEntity converts a domain entity to a JobRow.
func JobRowFromEntity(job entity.Job) JobRow {
	var scheduleStartTime sql.NullString
	if job.ScheduleStartTime != nil {
		scheduleStartTime = sql.NullString{String: job.ScheduleStartTime.Format(time.RFC3339), Valid: true}
	}

	var lastRunAt sql.NullString
	if job.LastRunAt != nil {
		lastRunAt = sql.NullString{String: job.LastRunAt.Format(time.RFC3339), Valid: true}
	}

	envJSON, _ := json.Marshal(job.EnvVariables)
	if job.EnvVariables == nil {
		envJSON = []byte("{}")
	}

	scheduleEnabled := 0
	if job.ScheduleEnabled {
		scheduleEnabled = 1
	}
	allowBypass := 0
	if job.AllowBypass {
		allowBypass = 1
	}
	autonomousMode := 0
	if job.AutonomousMode {
		autonomousMode = 1
	}

	return JobRow{
		ID:                  job.ID,
		Name:                job.Name,
		Description:         job.Description,
		Type:                job.Type,
		WorkingDirectory:    job.WorkingDirectory,
		ScheduleEnabled:     scheduleEnabled,
		ScheduleType:        job.ScheduleType,
		CronExpression:      job.CronExpression,
		ScheduleInterval:    job.ScheduleInterval,
		ScheduleStartTime:   scheduleStartTime,
		TimeoutSeconds:      job.TimeoutSeconds,
		Prompt:              job.Prompt,
		AllowBypass:         allowBypass,
		AutonomousMode:      autonomousMode,
		MaxRetries:          job.MaxRetries,
		Model:               job.Model,
		OverrideRepoCommand: job.OverrideRepoCommand,
		ClaudeCommand:       job.ClaudeCommand,
		SuccessPrompt:       job.SuccessPrompt,
		FailurePrompt:       job.FailurePrompt,
		MetadataPrompt:      job.MetadataPrompt,
		Interpreter:         job.Interpreter,
		ScriptContent:       job.ScriptContent,
		EnvVariables:        string(envJSON),
		CreatedAt:           job.CreatedAt.Format(time.RFC3339),
		UpdatedAt:           job.UpdatedAt.Format(time.RFC3339),
		LastRunAt:           lastRunAt,
	}
}
