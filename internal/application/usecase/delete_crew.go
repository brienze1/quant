package usecase

// DeleteCrew defines the interface for deleting crew assignments and watchdogs.
type DeleteCrew interface {
	DeleteAssignment(workerSessionID string) error
	ClearWatchdogsForWorker(workerSessionID string) error
}
