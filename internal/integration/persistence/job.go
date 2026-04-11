// Package persistence contains SQLite implementations of persistence interfaces.
package persistence

import (
	"database/sql"
	"fmt"

	"quant/internal/domain/entity"
	"quant/internal/integration/adapter"
	pdto "quant/internal/integration/persistence/dto"
)

// jobPersistence implements the adapter.JobPersistence interface using SQLite.
type jobPersistence struct {
	db *sql.DB
}

// NewJobPersistence creates a new SQLite job persistence implementation.
// Returns the adapter.JobPersistence interface, not the concrete type.
func NewJobPersistence(db *sql.DB) adapter.JobPersistence {
	return &jobPersistence{db: db}
}

const jobColumns = `id, name, description, type, working_directory, schedule_enabled, schedule_type, cron_expression,
		schedule_interval, schedule_start_time, timeout_seconds, prompt, allow_bypass, autonomous_mode,
		max_retries, model, override_repo_command, claude_command, agent_id, success_prompt, failure_prompt, metadata_prompt, triage_prompt,
		interpreter, script_content, env_variables, workspace_id, created_at, updated_at, last_run_at`

const jobTriggerColumns = `id, source_job_id, target_job_id, trigger_on`

const jobRunColumns = `id, job_id, status, triggered_by, correlation_id, session_id, model_used, duration_ms, tokens_used, result,
		error_message, injected_context, started_at, finished_at`

func scanJobRow(scanner interface{ Scan(...any) error }) (pdto.JobRow, error) {
	var row pdto.JobRow
	err := scanner.Scan(
		&row.ID, &row.Name, &row.Description, &row.Type, &row.WorkingDirectory,
		&row.ScheduleEnabled, &row.ScheduleType, &row.CronExpression,
		&row.ScheduleInterval, &row.ScheduleStartTime, &row.TimeoutSeconds,
		&row.Prompt, &row.AllowBypass, &row.AutonomousMode,
		&row.MaxRetries, &row.Model, &row.OverrideRepoCommand, &row.ClaudeCommand,
		&row.AgentID, &row.SuccessPrompt, &row.FailurePrompt, &row.MetadataPrompt, &row.TriagePrompt,
		&row.Interpreter, &row.ScriptContent, &row.EnvVariables,
		&row.WorkspaceID, &row.CreatedAt, &row.UpdatedAt, &row.LastRunAt,
	)
	return row, err
}

func scanJobTriggerRow(scanner interface{ Scan(...any) error }) (pdto.JobTriggerRow, error) {
	var row pdto.JobTriggerRow
	err := scanner.Scan(
		&row.ID, &row.SourceJobID, &row.TargetJobID, &row.TriggerOn,
	)
	return row, err
}

func scanJobRunRow(scanner interface{ Scan(...any) error }) (pdto.JobRunRow, error) {
	var row pdto.JobRunRow
	err := scanner.Scan(
		&row.ID, &row.JobID, &row.Status, &row.TriggeredBy, &row.CorrelationID, &row.SessionID,
		&row.ModelUsed, &row.DurationMs, &row.TokensUsed, &row.Result,
		&row.ErrorMessage, &row.InjectedContext, &row.StartedAt, &row.FinishedAt,
	)
	return row, err
}

// FindJobByID retrieves a job by its ID.
func (p *jobPersistence) FindJobByID(id string) (*entity.Job, error) {
	query := `SELECT ` + jobColumns + ` FROM jobs WHERE id = ?`

	row, err := scanJobRow(p.db.QueryRow(query, id))

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to find job by id: %w", err)
	}

	job := row.ToEntity()
	return &job, nil
}

// FindAllJobs retrieves all jobs.
func (p *jobPersistence) FindAllJobs() ([]entity.Job, error) {
	query := `SELECT ` + jobColumns + ` FROM jobs ORDER BY created_at DESC`

	rows, err := p.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to find all jobs: %w", err)
	}
	defer rows.Close()

	var jobs []entity.Job
	for rows.Next() {
		row, err := scanJobRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan job row: %w", err)
		}
		jobs = append(jobs, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating job rows: %w", err)
	}

	return jobs, nil
}

// FindScheduledJobs retrieves all jobs that have scheduling enabled.
func (p *jobPersistence) FindScheduledJobs() ([]entity.Job, error) {
	query := `SELECT ` + jobColumns + ` FROM jobs WHERE schedule_enabled = 1`

	rows, err := p.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to find scheduled jobs: %w", err)
	}
	defer rows.Close()

	var jobs []entity.Job
	for rows.Next() {
		row, err := scanJobRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan job row: %w", err)
		}
		jobs = append(jobs, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating job rows: %w", err)
	}

	return jobs, nil
}

// SaveJob persists a new job to the database.
func (p *jobPersistence) SaveJob(job entity.Job) error {
	row := pdto.JobRowFromEntity(job)

	query := `INSERT INTO jobs (id, name, description, type, working_directory, schedule_enabled, schedule_type,
		cron_expression, schedule_interval, schedule_start_time, timeout_seconds, prompt, allow_bypass,
		autonomous_mode, max_retries, model, override_repo_command, claude_command, agent_id,
		success_prompt, failure_prompt, metadata_prompt, triage_prompt,
		interpreter, script_content, env_variables, workspace_id, created_at, updated_at, last_run_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := p.db.Exec(query,
		row.ID, row.Name, row.Description, row.Type, row.WorkingDirectory,
		row.ScheduleEnabled, row.ScheduleType, row.CronExpression,
		row.ScheduleInterval, row.ScheduleStartTime, row.TimeoutSeconds,
		row.Prompt, row.AllowBypass, row.AutonomousMode,
		row.MaxRetries, row.Model, row.OverrideRepoCommand, row.ClaudeCommand,
		row.AgentID, row.SuccessPrompt, row.FailurePrompt, row.MetadataPrompt, row.TriagePrompt,
		row.Interpreter, row.ScriptContent, row.EnvVariables,
		row.WorkspaceID, row.CreatedAt, row.UpdatedAt, row.LastRunAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save job: %w", err)
	}

	return nil
}

// UpdateJob updates all fields of a job.
func (p *jobPersistence) UpdateJob(job entity.Job) error {
	row := pdto.JobRowFromEntity(job)

	query := `UPDATE jobs SET name = ?, description = ?, type = ?, working_directory = ?,
		schedule_enabled = ?, schedule_type = ?, cron_expression = ?, schedule_interval = ?,
		schedule_start_time = ?, timeout_seconds = ?, prompt = ?, allow_bypass = ?,
		autonomous_mode = ?, max_retries = ?, model = ?, override_repo_command = ?,
		claude_command = ?, agent_id = ?, success_prompt = ?, failure_prompt = ?, metadata_prompt = ?, triage_prompt = ?,
		interpreter = ?, script_content = ?, env_variables = ?,
		workspace_id = ?, updated_at = ?, last_run_at = ? WHERE id = ?`

	result, err := p.db.Exec(query,
		row.Name, row.Description, row.Type, row.WorkingDirectory,
		row.ScheduleEnabled, row.ScheduleType, row.CronExpression, row.ScheduleInterval,
		row.ScheduleStartTime, row.TimeoutSeconds, row.Prompt, row.AllowBypass,
		row.AutonomousMode, row.MaxRetries, row.Model, row.OverrideRepoCommand,
		row.ClaudeCommand, row.AgentID, row.SuccessPrompt, row.FailurePrompt, row.MetadataPrompt, row.TriagePrompt,
		row.Interpreter, row.ScriptContent, row.EnvVariables,
		row.WorkspaceID, row.UpdatedAt, row.LastRunAt, row.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update job: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("job not found: %s", job.ID)
	}

	return nil
}

// DeleteJob removes a job by its ID.
func (p *jobPersistence) DeleteJob(id string) error {
	query := `DELETE FROM jobs WHERE id = ?`

	result, err := p.db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("failed to delete job: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("job not found: %s", id)
	}

	return nil
}

// FindTriggersBySourceJobID retrieves all triggers for a given source job.
func (p *jobPersistence) FindTriggersBySourceJobID(jobID string) ([]entity.JobTrigger, error) {
	query := `SELECT ` + jobTriggerColumns + ` FROM job_triggers WHERE source_job_id = ?`

	rows, err := p.db.Query(query, jobID)
	if err != nil {
		return nil, fmt.Errorf("failed to find triggers by source job id: %w", err)
	}
	defer rows.Close()

	var triggers []entity.JobTrigger
	for rows.Next() {
		row, err := scanJobTriggerRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan job trigger row: %w", err)
		}
		triggers = append(triggers, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating job trigger rows: %w", err)
	}

	return triggers, nil
}

// FindTriggersByTargetJobID retrieves all triggers for a given target job.
func (p *jobPersistence) FindTriggersByTargetJobID(jobID string) ([]entity.JobTrigger, error) {
	query := `SELECT ` + jobTriggerColumns + ` FROM job_triggers WHERE target_job_id = ?`

	rows, err := p.db.Query(query, jobID)
	if err != nil {
		return nil, fmt.Errorf("failed to find triggers by target job id: %w", err)
	}
	defer rows.Close()

	var triggers []entity.JobTrigger
	for rows.Next() {
		row, err := scanJobTriggerRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan job trigger row: %w", err)
		}
		triggers = append(triggers, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating job trigger rows: %w", err)
	}

	return triggers, nil
}

// SaveJobTrigger persists a new job trigger to the database.
func (p *jobPersistence) SaveJobTrigger(trigger entity.JobTrigger) error {
	row := pdto.JobTriggerRowFromEntity(trigger)

	query := `INSERT INTO job_triggers (id, source_job_id, target_job_id, trigger_on)
		VALUES (?, ?, ?, ?)`

	_, err := p.db.Exec(query, row.ID, row.SourceJobID, row.TargetJobID, row.TriggerOn)
	if err != nil {
		return fmt.Errorf("failed to save job trigger: %w", err)
	}

	return nil
}

// DeleteJobTrigger removes a job trigger by its ID.
func (p *jobPersistence) DeleteJobTrigger(id string) error {
	query := `DELETE FROM job_triggers WHERE id = ?`

	result, err := p.db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("failed to delete job trigger: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("job trigger not found: %s", id)
	}

	return nil
}

// DeleteTriggersBySourceJobID removes all triggers for a given source job.
func (p *jobPersistence) DeleteTriggersBySourceJobID(jobID string) error {
	query := `DELETE FROM job_triggers WHERE source_job_id = ?`

	_, err := p.db.Exec(query, jobID)
	if err != nil {
		return fmt.Errorf("failed to delete triggers by source job id: %w", err)
	}

	return nil
}

// FindJobRunByID retrieves a job run by its ID.
func (p *jobPersistence) FindJobRunByID(id string) (*entity.JobRun, error) {
	query := `SELECT ` + jobRunColumns + ` FROM job_runs WHERE id = ?`

	row, err := scanJobRunRow(p.db.QueryRow(query, id))

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to find job run by id: %w", err)
	}

	run := row.ToEntity()
	return &run, nil
}

// FindJobRunsByJobID retrieves all runs for a given job.
func (p *jobPersistence) FindJobRunsByJobID(jobID string) ([]entity.JobRun, error) {
	query := `SELECT ` + jobRunColumns + ` FROM job_runs WHERE job_id = ? ORDER BY started_at DESC`

	rows, err := p.db.Query(query, jobID)
	if err != nil {
		return nil, fmt.Errorf("failed to find job runs by job id: %w", err)
	}
	defer rows.Close()

	var runs []entity.JobRun
	for rows.Next() {
		row, err := scanJobRunRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan job run row: %w", err)
		}
		runs = append(runs, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating job run rows: %w", err)
	}

	return runs, nil
}

// FindJobRunsByJobIDPaginated retrieves runs for a job with limit and offset.
func (p *jobPersistence) FindJobRunsByJobIDPaginated(jobID string, limit, offset int) ([]entity.JobRun, error) {
	query := `SELECT ` + jobRunColumns + ` FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`

	rows, err := p.db.Query(query, jobID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to find job runs by job id (paginated): %w", err)
	}
	defer rows.Close()

	var runs []entity.JobRun
	for rows.Next() {
		row, err := scanJobRunRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan job run row: %w", err)
		}
		runs = append(runs, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating job run rows: %w", err)
	}

	return runs, nil
}

// FindJobRunsByCorrelationID retrieves all runs sharing a correlation ID.
func (p *jobPersistence) FindJobRunsByCorrelationID(correlationID string) ([]entity.JobRun, error) {
	query := `SELECT ` + jobRunColumns + ` FROM job_runs WHERE correlation_id = ? ORDER BY started_at ASC`

	rows, err := p.db.Query(query, correlationID)
	if err != nil {
		return nil, fmt.Errorf("failed to list runs by correlation: %w", err)
	}
	defer rows.Close()

	var runs []entity.JobRun
	for rows.Next() {
		row, err := scanJobRunRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan job run row: %w", err)
		}
		runs = append(runs, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating job run rows: %w", err)
	}

	return runs, nil
}

// SaveJobRun persists a new job run to the database.
func (p *jobPersistence) SaveJobRun(run entity.JobRun) error {
	row := pdto.JobRunRowFromEntity(run)

	query := `INSERT INTO job_runs (id, job_id, status, triggered_by, correlation_id, session_id, model_used, duration_ms, tokens_used,
		result, error_message, injected_context, started_at, finished_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := p.db.Exec(query,
		row.ID, row.JobID, row.Status, row.TriggeredBy, row.CorrelationID, row.SessionID,
		row.ModelUsed, row.DurationMs, row.TokensUsed, row.Result,
		row.ErrorMessage, row.InjectedContext, row.StartedAt, row.FinishedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save job run: %w", err)
	}

	return nil
}

// UpdateJobRun updates all fields of a job run.
func (p *jobPersistence) UpdateJobRun(run entity.JobRun) error {
	row := pdto.JobRunRowFromEntity(run)

	query := `UPDATE job_runs SET job_id = ?, status = ?, triggered_by = ?, correlation_id = ?, session_id = ?,
		model_used = ?, duration_ms = ?, tokens_used = ?, result = ?, error_message = ?,
		injected_context = ?, started_at = ?, finished_at = ? WHERE id = ?`

	result, err := p.db.Exec(query,
		row.JobID, row.Status, row.TriggeredBy, row.CorrelationID, row.SessionID,
		row.ModelUsed, row.DurationMs, row.TokensUsed, row.Result, row.ErrorMessage,
		row.InjectedContext, row.StartedAt, row.FinishedAt, row.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update job run: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("job run not found: %s", run.ID)
	}

	return nil
}
