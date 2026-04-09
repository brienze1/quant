// Package jobrunstatus contains string constants for job run status values.
package jobrunstatus

const (
	// Pending indicates the run is queued but not yet started.
	Pending = "pending"

	// Running indicates the run is currently executing.
	Running = "running"

	// Success indicates the run completed successfully.
	Success = "success"

	// Failed indicates the run encountered an error.
	Failed = "failed"

	// Cancelled indicates the run was manually cancelled.
	Cancelled = "cancelled"

	// TimedOut indicates the run exceeded its timeout limit.
	TimedOut = "timed_out"

	// Waiting indicates the run needs human intervention before continuing.
	Waiting = "waiting"
)
