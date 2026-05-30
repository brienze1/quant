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
	// RunJob starts a new run.
	//   - inputs: typed metadata for the run's pre-run validation gate. For a
	//     ROOT run (triggeredByRunID == "") this becomes the run's initial
	//     Metadata (the "inbound" the gate validates against). For a TRIGGERED
	//     run the gate ignores inputs and reads the parent run's Metadata
	//     instead — fireTriggers passes the parent's typed metadata through
	//     upstream's existing trigger/injected_context plumbing, so passing
	//     nil here is the right default for trigger-paths.
	//   - correlationID: upstream's pipeline-wide id (variadic, optional).
	RunJob(jobID string, triggeredByRunID string, inputs map[string]any, correlationID ...string) (*entity.JobRun, error)
	// RunJobWithContext starts a ROOT run with prompt-injected context.
	//   - context: freeform string prepended to the prompt only (does NOT feed
	//     the validation gate).
	//   - inputs: typed metadata that DOES feed the pre-run validation gate,
	//     same semantics as RunJob's inputs for a root run. Pass nil when the
	//     target job declares no required inputs.
	RunJobWithContext(jobID string, context string, inputs map[string]any) (*entity.JobRun, error)
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
