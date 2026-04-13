// Package dto contains data transfer objects for the entrypoint layer.
package dto

import (
	"quant/internal/domain/entity"
)

// CreateJobRequest represents the request payload for creating a new job.
type CreateJobRequest struct {
	Name                string            `json:"name"`
	Description         string            `json:"description"`
	Type                string            `json:"type"`
	WorkingDirectory    string            `json:"workingDirectory"`
	ScheduleEnabled     bool              `json:"scheduleEnabled"`
	ScheduleType        string            `json:"scheduleType"`
	CronExpression      string            `json:"cronExpression"`
	ScheduleInterval    int               `json:"scheduleInterval"`
	TimeoutSeconds      int               `json:"timeoutSeconds"`
	Prompt              string            `json:"prompt"`
	AllowBypass         bool              `json:"allowBypass"`
	AutonomousMode      bool              `json:"autonomousMode"`
	MaxRetries          int               `json:"maxRetries"`
	Model               string            `json:"model"`
	OverrideRepoCommand string            `json:"overrideRepoCommand"`
	ClaudeCommand       string            `json:"claudeCommand"`
	AgentID             string            `json:"agentId"`
	SuccessPrompt       string            `json:"successPrompt"`
	FailurePrompt       string            `json:"failurePrompt"`
	MetadataPrompt      string            `json:"metadataPrompt"`
	TriagePrompt        string            `json:"triagePrompt"`
	Interpreter         string            `json:"interpreter"`
	ScriptContent       string            `json:"scriptContent"`
	EnvVariables        map[string]string `json:"envVariables"`
	OnSuccess           []string               `json:"onSuccess"`
	OnFailure           []string               `json:"onFailure"`
	OnCustom            []entity.CustomTriggerRef `json:"onCustom"`
	WorkspaceID         string                 `json:"workspaceId"`
}

// UpdateJobRequest represents the request payload for updating an existing job.
type UpdateJobRequest struct {
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	Description         string            `json:"description"`
	Type                string            `json:"type"`
	WorkingDirectory    string            `json:"workingDirectory"`
	ScheduleEnabled     bool              `json:"scheduleEnabled"`
	ScheduleType        string            `json:"scheduleType"`
	CronExpression      string            `json:"cronExpression"`
	ScheduleInterval    int               `json:"scheduleInterval"`
	TimeoutSeconds      int               `json:"timeoutSeconds"`
	Prompt              string            `json:"prompt"`
	AllowBypass         bool              `json:"allowBypass"`
	AutonomousMode      bool              `json:"autonomousMode"`
	MaxRetries          int               `json:"maxRetries"`
	Model               string            `json:"model"`
	OverrideRepoCommand string            `json:"overrideRepoCommand"`
	ClaudeCommand       string            `json:"claudeCommand"`
	AgentID             string            `json:"agentId"`
	SuccessPrompt       string            `json:"successPrompt"`
	FailurePrompt       string            `json:"failurePrompt"`
	MetadataPrompt      string            `json:"metadataPrompt"`
	TriagePrompt        string            `json:"triagePrompt"`
	Interpreter         string            `json:"interpreter"`
	ScriptContent       string            `json:"scriptContent"`
	EnvVariables        map[string]string `json:"envVariables"`
	OnSuccess           []string               `json:"onSuccess"`
	OnFailure           []string               `json:"onFailure"`
	OnCustom            []entity.CustomTriggerRef `json:"onCustom"`
	WorkspaceID         string                 `json:"workspaceId"`
}

// JobResponse represents the response payload for job data.
type JobResponse struct {
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	Description         string            `json:"description"`
	Type                string            `json:"type"`
	WorkingDirectory    string            `json:"workingDirectory"`
	ScheduleEnabled     bool              `json:"scheduleEnabled"`
	ScheduleType        string            `json:"scheduleType"`
	CronExpression      string            `json:"cronExpression"`
	ScheduleInterval    int               `json:"scheduleInterval"`
	TimeoutSeconds      int               `json:"timeoutSeconds"`
	Prompt              string            `json:"prompt"`
	AllowBypass         bool              `json:"allowBypass"`
	AutonomousMode      bool              `json:"autonomousMode"`
	MaxRetries          int               `json:"maxRetries"`
	Model               string            `json:"model"`
	OverrideRepoCommand string            `json:"overrideRepoCommand"`
	ClaudeCommand       string            `json:"claudeCommand"`
	AgentID             string            `json:"agentId"`
	SuccessPrompt       string            `json:"successPrompt"`
	FailurePrompt       string            `json:"failurePrompt"`
	MetadataPrompt      string            `json:"metadataPrompt"`
	TriagePrompt        string            `json:"triagePrompt"`
	Interpreter         string            `json:"interpreter"`
	ScriptContent       string            `json:"scriptContent"`
	EnvVariables        map[string]string `json:"envVariables"`
	WorkspaceID         string            `json:"workspaceId"`
	CreatedAt           string            `json:"createdAt"`
	UpdatedAt           string            `json:"updatedAt"`
	OnSuccess           []string               `json:"onSuccess"`
	OnFailure           []string               `json:"onFailure"`
	OnCustom            []CustomTriggerResponse `json:"onCustom"`
	TriggeredBy         []TriggerRef           `json:"triggeredBy"`
}

// CustomTriggerResponse represents a custom trigger in the job response.
type CustomTriggerResponse struct {
	TargetJobID  string `json:"targetJobId"`
	CustomPrompt string `json:"customPrompt"`
}

// TriggerRef describes a trigger relationship with its type.
type TriggerRef struct {
	JobID        string `json:"jobId"`
	TriggerOn    string `json:"triggerOn"`    // "success" | "failure" | "custom"
	CustomPrompt string `json:"customPrompt"` // only set when TriggerOn == "custom"
}

// JobRunResponse represents the response payload for job run data.
type JobRunResponse struct {
	ID           string `json:"id"`
	JobID        string `json:"jobId"`
	Status       string `json:"status"`
	TriggeredBy   string `json:"triggeredBy"`
	CorrelationID string `json:"correlationId"`
	SessionID     string `json:"sessionId"`
	ModelUsed    string `json:"modelUsed"`
	DurationMs   int64  `json:"durationMs"`
	TokensUsed   int    `json:"tokensUsed"`
	Result          string `json:"result"`
	ErrorMessage    string `json:"errorMessage"`
	InjectedContext string `json:"injectedContext"`
	StartedAt       string `json:"startedAt"`
	FinishedAt      string `json:"finishedAt"`
}

// JobResponseFromEntity converts a domain entity to a JobResponse DTO with trigger information.
func JobResponseFromEntity(job entity.Job, onSuccess []entity.JobTrigger, onFailure []entity.JobTrigger, onCustom []entity.JobTrigger, triggeredBy []entity.JobTrigger) JobResponse {
	successIDs := make([]string, len(onSuccess))
	for i, t := range onSuccess {
		successIDs[i] = t.TargetJobID
	}

	failureIDs := make([]string, len(onFailure))
	for i, t := range onFailure {
		failureIDs[i] = t.TargetJobID
	}

	customTriggers := make([]CustomTriggerResponse, len(onCustom))
	for i, t := range onCustom {
		customTriggers[i] = CustomTriggerResponse{TargetJobID: t.TargetJobID, CustomPrompt: t.CustomPrompt}
	}

	triggeredByRefs := make([]TriggerRef, len(triggeredBy))
	for i, t := range triggeredBy {
		triggeredByRefs[i] = TriggerRef{JobID: t.SourceJobID, TriggerOn: t.TriggerOn, CustomPrompt: t.CustomPrompt}
	}

	return JobResponse{
		ID:                  job.ID,
		Name:                job.Name,
		Description:         job.Description,
		Type:                job.Type,
		WorkingDirectory:    job.WorkingDirectory,
		ScheduleEnabled:     job.ScheduleEnabled,
		ScheduleType:        job.ScheduleType,
		CronExpression:      job.CronExpression,
		ScheduleInterval:    job.ScheduleInterval,
		TimeoutSeconds:      job.TimeoutSeconds,
		Prompt:              job.Prompt,
		AllowBypass:         job.AllowBypass,
		AutonomousMode:      job.AutonomousMode,
		MaxRetries:          job.MaxRetries,
		Model:               job.Model,
		OverrideRepoCommand: job.OverrideRepoCommand,
		ClaudeCommand:       job.ClaudeCommand,
		AgentID:             job.AgentID,
		SuccessPrompt:       job.SuccessPrompt,
		FailurePrompt:       job.FailurePrompt,
		MetadataPrompt:      job.MetadataPrompt,
		TriagePrompt:        job.TriagePrompt,
		Interpreter:         job.Interpreter,
		ScriptContent:       job.ScriptContent,
		EnvVariables:        job.EnvVariables,
		WorkspaceID:         job.WorkspaceID,
		CreatedAt:           job.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:           job.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		OnSuccess:           successIDs,
		OnFailure:           failureIDs,
		OnCustom:            customTriggers,
		TriggeredBy:         triggeredByRefs,
	}
}

// JobResponseFromEntityPtr converts a domain entity pointer to a JobResponse DTO pointer.
func JobResponseFromEntityPtr(job *entity.Job, onSuccess []entity.JobTrigger, onFailure []entity.JobTrigger, onCustom []entity.JobTrigger, triggeredBy []entity.JobTrigger) *JobResponse {
	if job == nil {
		return nil
	}
	response := JobResponseFromEntity(*job, onSuccess, onFailure, onCustom, triggeredBy)
	return &response
}

// JobResponseListFromEntities converts a slice of jobs with their triggers to a slice of JobResponse DTOs.
func JobResponseListFromEntities(jobs []entity.Job, triggersFn func(jobID string) ([]entity.JobTrigger, []entity.JobTrigger, []entity.JobTrigger, []entity.JobTrigger, error)) ([]JobResponse, error) {
	responses := make([]JobResponse, len(jobs))
	for i, job := range jobs {
		onSuccess, onFailure, onCustom, triggeredBy, err := triggersFn(job.ID)
		if err != nil {
			return nil, err
		}
		responses[i] = JobResponseFromEntity(job, onSuccess, onFailure, onCustom, triggeredBy)
	}
	return responses, nil
}

// JobRunResponseFromEntity converts a domain entity to a JobRunResponse DTO.
func JobRunResponseFromEntity(run entity.JobRun) JobRunResponse {
	var finishedAt string
	if run.FinishedAt != nil {
		finishedAt = run.FinishedAt.Format("2006-01-02T15:04:05Z07:00")
	}

	return JobRunResponse{
		ID:           run.ID,
		JobID:        run.JobID,
		Status:       run.Status,
		TriggeredBy:   run.TriggeredBy,
		CorrelationID: run.CorrelationID,
		SessionID:     run.SessionID,
		ModelUsed:    run.ModelUsed,
		DurationMs:   run.DurationMs,
		TokensUsed:   run.TokensUsed,
		Result:          run.Result,
		ErrorMessage:    run.ErrorMessage,
		InjectedContext: run.InjectedContext,
		StartedAt:       run.StartedAt.Format("2006-01-02T15:04:05Z07:00"),
		FinishedAt:   finishedAt,
	}
}

// JobRunResponseFromEntityPtr converts a domain entity pointer to a JobRunResponse DTO pointer.
func JobRunResponseFromEntityPtr(run *entity.JobRun) *JobRunResponse {
	if run == nil {
		return nil
	}
	response := JobRunResponseFromEntity(*run)
	return &response
}

// JobRunResponseListFromEntities converts a slice of domain entities to a slice of JobRunResponse DTOs.
func JobRunResponseListFromEntities(runs []entity.JobRun) []JobRunResponse {
	responses := make([]JobRunResponse, len(runs))
	for i, run := range runs {
		responses[i] = JobRunResponseFromEntity(run)
	}
	return responses
}
