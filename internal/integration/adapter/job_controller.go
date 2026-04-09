package adapter

import (
	"context"

	"quant/internal/integration/entrypoint/dto"
)

// JobController defines the interface for the job entrypoint controller.
// This interface is what the Wails app binds to.
type JobController interface {
	OnStartup(ctx context.Context)
	OnShutdown(ctx context.Context)
	CreateJob(request dto.CreateJobRequest) (*dto.JobResponse, error)
	UpdateJob(request dto.UpdateJobRequest) (*dto.JobResponse, error)
	DeleteJob(id string) error
	GetJob(id string) (*dto.JobResponse, error)
	ListJobs() ([]dto.JobResponse, error)
	RunJob(id string) (*dto.JobRunResponse, error)
	CancelRun(runID string) error
	GetRun(runID string) (*dto.JobRunResponse, error)
	ListRunsByJob(jobID string) ([]dto.JobRunResponse, error)
	GetRunOutput(runID string) (string, error)
	RerunJob(jobID string, originalRunID string) (*dto.JobRunResponse, error)
	ResumeJob(runID string, context string) (*dto.JobRunResponse, error)
	AdvancePipeline(runID string, targetJobID string, context string) (*dto.JobRunResponse, error)
	ListRunsByCorrelation(correlationID string) ([]dto.JobRunResponse, error)
}
