// Package adapter contains interfaces that application services implement.
package adapter

import "quant/internal/domain/entity"

// JobManager defines the service interface for job management operations.
// This is the application adapter that the jobManagerService implements.
type JobManager interface {
	CreateJob(job entity.Job, onSuccess []string, onFailure []string) (*entity.Job, error)
	UpdateJob(job entity.Job, onSuccess []string, onFailure []string) (*entity.Job, error)
	DeleteJob(id string) error
	GetJob(id string) (*entity.Job, error)
	ListJobs() ([]entity.Job, error)
	GetTriggersForJob(jobID string) (onSuccess []entity.JobTrigger, onFailure []entity.JobTrigger, triggeredBy []entity.JobTrigger, err error)
	RunJob(jobID string, triggeredByRunID string, correlationID ...string) (*entity.JobRun, error)
	RunJobWithContext(jobID string, context string) (*entity.JobRun, error)
	RerunJob(jobID string, originalRunID string) (*entity.JobRun, error)
	CancelRun(runID string) error
	GetRun(runID string) (*entity.JobRun, error)
	ListRunsByJob(jobID string) ([]entity.JobRun, error)
	ListRunsByJobPaginated(jobID string, limit, offset int) ([]entity.JobRun, error)
	GetRunOutput(runID string) (string, error)
	ResumeJob(runID string, extraContext string) (*entity.JobRun, error)
	AdvancePipeline(runID string, targetJobID string, extraContext string) (*entity.JobRun, error)
	ListRunsByCorrelation(correlationID string) ([]entity.JobRun, error)
}
