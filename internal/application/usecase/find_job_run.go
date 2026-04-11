package usecase

import (
	"quant/internal/domain/entity"
)

// FindJobRun defines the interface for job run retrieval operations.
type FindJobRun interface {
	FindJobRunByID(id string) (*entity.JobRun, error)
	FindJobRunsByJobID(jobID string) ([]entity.JobRun, error)
	FindJobRunsByJobIDPaginated(jobID string, limit, offset int) ([]entity.JobRun, error)
	FindJobRunsByCorrelationID(correlationID string) ([]entity.JobRun, error)
}
