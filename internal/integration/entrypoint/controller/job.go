// Package controller contains entrypoint controllers bound to the Wails runtime.
package controller

import (
	"context"

	appAdapter "quant/internal/application/adapter"
	"quant/internal/domain/entity"
	intAdapter "quant/internal/integration/adapter"
	"quant/internal/integration/entrypoint/dto"
)

// jobController implements the integration adapter.JobController interface.
// It is bound to the Wails runtime and exposes job management operations to the frontend.
type jobController struct {
	ctx        context.Context
	jobManager appAdapter.JobManager
}

// NewJobController creates a new job controller.
// Returns the intAdapter.JobController interface, not the concrete type.
func NewJobController(jobManager appAdapter.JobManager) intAdapter.JobController {
	return &jobController{
		jobManager: jobManager,
	}
}

// OnStartup is called when the Wails app starts. The context is saved for runtime method calls.
func (c *jobController) OnStartup(ctx context.Context) {
	c.ctx = ctx
}

// OnShutdown is called when the Wails app is shutting down.
func (c *jobController) OnShutdown(_ context.Context) {
	// No-op for now.
}

// CreateJob creates a new job and returns its response DTO.
func (c *jobController) CreateJob(request dto.CreateJobRequest) (*dto.JobResponse, error) {
	job := entity.Job{
		Name:                request.Name,
		Description:         request.Description,
		Type:                request.Type,
		WorkingDirectory:    request.WorkingDirectory,
		ScheduleEnabled:     request.ScheduleEnabled,
		ScheduleType:        request.ScheduleType,
		CronExpression:      request.CronExpression,
		ScheduleInterval:    request.ScheduleInterval,
		TimeoutSeconds:      request.TimeoutSeconds,
		Prompt:              request.Prompt,
		AllowBypass:         request.AllowBypass,
		AutonomousMode:      request.AutonomousMode,
		MaxRetries:          request.MaxRetries,
		Model:               request.Model,
		OverrideRepoCommand: request.OverrideRepoCommand,
		ClaudeCommand:       request.ClaudeCommand,
		AgentID:             request.AgentID,
		SuccessPrompt:       request.SuccessPrompt,
		FailurePrompt:       request.FailurePrompt,
		MetadataPrompt:      request.MetadataPrompt,
		TriagePrompt:        request.TriagePrompt,
		Interpreter:         request.Interpreter,
		ScriptContent:       request.ScriptContent,
		EnvVariables:        request.EnvVariables,
		WorkspaceID:         request.WorkspaceID,
	}

	created, err := c.jobManager.CreateJob(job, request.OnSuccess, request.OnFailure)
	if err != nil {
		return nil, err
	}

	onSuccess, onFailure, triggeredBy, err := c.jobManager.GetTriggersForJob(created.ID)
	if err != nil {
		return nil, err
	}

	return dto.JobResponseFromEntityPtr(created, onSuccess, onFailure, triggeredBy), nil
}

// UpdateJob updates an existing job and returns its response DTO.
func (c *jobController) UpdateJob(request dto.UpdateJobRequest) (*dto.JobResponse, error) {
	job := entity.Job{
		ID:                  request.ID,
		Name:                request.Name,
		Description:         request.Description,
		Type:                request.Type,
		WorkingDirectory:    request.WorkingDirectory,
		ScheduleEnabled:     request.ScheduleEnabled,
		ScheduleType:        request.ScheduleType,
		CronExpression:      request.CronExpression,
		ScheduleInterval:    request.ScheduleInterval,
		TimeoutSeconds:      request.TimeoutSeconds,
		Prompt:              request.Prompt,
		AllowBypass:         request.AllowBypass,
		AutonomousMode:      request.AutonomousMode,
		MaxRetries:          request.MaxRetries,
		Model:               request.Model,
		OverrideRepoCommand: request.OverrideRepoCommand,
		ClaudeCommand:       request.ClaudeCommand,
		AgentID:             request.AgentID,
		SuccessPrompt:       request.SuccessPrompt,
		FailurePrompt:       request.FailurePrompt,
		MetadataPrompt:      request.MetadataPrompt,
		TriagePrompt:        request.TriagePrompt,
		Interpreter:         request.Interpreter,
		ScriptContent:       request.ScriptContent,
		EnvVariables:        request.EnvVariables,
		WorkspaceID:         request.WorkspaceID,
	}

	updated, err := c.jobManager.UpdateJob(job, request.OnSuccess, request.OnFailure)
	if err != nil {
		return nil, err
	}

	onSuccess, onFailure, triggeredBy, err := c.jobManager.GetTriggersForJob(updated.ID)
	if err != nil {
		return nil, err
	}

	return dto.JobResponseFromEntityPtr(updated, onSuccess, onFailure, triggeredBy), nil
}

// DeleteJob deletes a job by ID.
func (c *jobController) DeleteJob(id string) error {
	return c.jobManager.DeleteJob(id)
}

// GetJob returns a single job by ID as a response DTO.
func (c *jobController) GetJob(id string) (*dto.JobResponse, error) {
	job, err := c.jobManager.GetJob(id)
	if err != nil {
		return nil, err
	}

	onSuccess, onFailure, triggeredBy, err := c.jobManager.GetTriggersForJob(job.ID)
	if err != nil {
		return nil, err
	}

	return dto.JobResponseFromEntityPtr(job, onSuccess, onFailure, triggeredBy), nil
}

// ListJobs returns all jobs as response DTOs.
func (c *jobController) ListJobs() ([]dto.JobResponse, error) {
	jobs, err := c.jobManager.ListJobs()
	if err != nil {
		return nil, err
	}

	return dto.JobResponseListFromEntities(jobs, c.jobManager.GetTriggersForJob)
}

// RunJob starts a new run for a job.
func (c *jobController) RunJob(id string) (*dto.JobRunResponse, error) {
	run, err := c.jobManager.RunJob(id, "")
	if err != nil {
		return nil, err
	}

	return dto.JobRunResponseFromEntityPtr(run), nil
}

// RerunJob creates a new run for a job, preserving trigger context from a previous run.
func (c *jobController) RerunJob(jobID string, originalRunID string) (*dto.JobRunResponse, error) {
	run, err := c.jobManager.RerunJob(jobID, originalRunID)
	if err != nil {
		return nil, err
	}
	return dto.JobRunResponseFromEntityPtr(run), nil
}

// CancelRun cancels a running job run.
func (c *jobController) CancelRun(runID string) error {
	return c.jobManager.CancelRun(runID)
}

// GetRun returns a job run by ID as a response DTO.
func (c *jobController) GetRun(runID string) (*dto.JobRunResponse, error) {
	run, err := c.jobManager.GetRun(runID)
	if err != nil {
		return nil, err
	}

	return dto.JobRunResponseFromEntityPtr(run), nil
}

// ListRunsByJob returns all runs for a job as response DTOs.
func (c *jobController) ListRunsByJob(jobID string) ([]dto.JobRunResponse, error) {
	runs, err := c.jobManager.ListRunsByJob(jobID)
	if err != nil {
		return nil, err
	}

	return dto.JobRunResponseListFromEntities(runs), nil
}

// ListRunsByJobPaginated returns a page of runs for a job as response DTOs.
func (c *jobController) ListRunsByJobPaginated(jobID string, limit, offset int) ([]dto.JobRunResponse, error) {
	runs, err := c.jobManager.ListRunsByJobPaginated(jobID, limit, offset)
	if err != nil {
		return nil, err
	}

	return dto.JobRunResponseListFromEntities(runs), nil
}

// ResumeJob resumes a waiting job run with injected resolution context.
func (c *jobController) ResumeJob(runID string, context string) (*dto.JobRunResponse, error) {
	run, err := c.jobManager.ResumeJob(runID, context)
	if err != nil {
		return nil, err
	}
	return dto.JobRunResponseFromEntityPtr(run), nil
}

// AdvancePipeline handles all pipeline advancement from a waiting run.
func (c *jobController) AdvancePipeline(runID string, targetJobID string, context string) (*dto.JobRunResponse, error) {
	run, err := c.jobManager.AdvancePipeline(runID, targetJobID, context)
	if err != nil {
		return nil, err
	}
	return dto.JobRunResponseFromEntityPtr(run), nil
}

// ListRunsByCorrelation returns all runs in a pipeline by correlation ID.
func (c *jobController) ListRunsByCorrelation(correlationID string) ([]dto.JobRunResponse, error) {
	runs, err := c.jobManager.ListRunsByCorrelation(correlationID)
	if err != nil {
		return nil, err
	}
	return dto.JobRunResponseListFromEntities(runs), nil
}

// GetRunOutput returns the output of a job run.
func (c *jobController) GetRunOutput(runID string) (string, error) {
	return c.jobManager.GetRunOutput(runID)
}
