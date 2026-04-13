package usecase

import (
	"quant/internal/domain/entity"
)

// FindJobGroup defines the interface for job group retrieval operations.
type FindJobGroup interface {
	FindJobGroupByID(id string) (*entity.JobGroup, error)
	FindJobGroupsByWorkspace(workspaceID string) ([]entity.JobGroup, error)
	FindJobGroupByJobID(jobID string) (*entity.JobGroup, error)
}
