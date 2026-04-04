// Package adapter contains interfaces that application services implement.
package adapter

import "quant/internal/domain/entity"

// JobGroupManager defines the service interface for job group management operations.
type JobGroupManager interface {
	CreateJobGroup(group entity.JobGroup) (*entity.JobGroup, error)
	UpdateJobGroup(group entity.JobGroup) (*entity.JobGroup, error)
	DeleteJobGroup(id string) error
	GetJobGroup(id string) (*entity.JobGroup, error)
	ListJobGroupsByWorkspace(workspaceID string) ([]entity.JobGroup, error)
}
