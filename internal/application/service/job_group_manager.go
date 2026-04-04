// Package service contains application service implementations.
package service

import (
	"fmt"
	"time"

	"github.com/google/uuid"

	"quant/internal/application/adapter"
	"quant/internal/application/usecase"
	"quant/internal/domain/entity"
)

// jobGroupManagerService implements the adapter.JobGroupManager interface.
type jobGroupManagerService struct {
	findJobGroup   usecase.FindJobGroup
	saveJobGroup   usecase.SaveJobGroup
	updateJobGroup usecase.UpdateJobGroup
	deleteJobGroup usecase.DeleteJobGroup
}

// NewJobGroupManagerService creates a new job group manager service.
func NewJobGroupManagerService(
	findJobGroup usecase.FindJobGroup,
	saveJobGroup usecase.SaveJobGroup,
	updateJobGroup usecase.UpdateJobGroup,
	deleteJobGroup usecase.DeleteJobGroup,
) adapter.JobGroupManager {
	return &jobGroupManagerService{
		findJobGroup:   findJobGroup,
		saveJobGroup:   saveJobGroup,
		updateJobGroup: updateJobGroup,
		deleteJobGroup: deleteJobGroup,
	}
}

// CreateJobGroup creates a new job group.
func (s *jobGroupManagerService) CreateJobGroup(group entity.JobGroup) (*entity.JobGroup, error) {
	now := time.Now()
	group.ID = uuid.New().String()
	group.CreatedAt = now
	group.UpdatedAt = now

	if err := s.saveJobGroup.SaveJobGroup(group); err != nil {
		return nil, fmt.Errorf("failed to create job group: %w", err)
	}

	return &group, nil
}

// UpdateJobGroup updates an existing job group.
func (s *jobGroupManagerService) UpdateJobGroup(group entity.JobGroup) (*entity.JobGroup, error) {
	existing, err := s.findJobGroup.FindJobGroupByID(group.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to find job group: %w", err)
	}
	if existing == nil {
		return nil, fmt.Errorf("job group not found: %s", group.ID)
	}

	group.CreatedAt = existing.CreatedAt
	group.UpdatedAt = time.Now()

	if err := s.updateJobGroup.UpdateJobGroup(group); err != nil {
		return nil, fmt.Errorf("failed to update job group: %w", err)
	}

	return &group, nil
}

// DeleteJobGroup deletes a job group by ID.
func (s *jobGroupManagerService) DeleteJobGroup(id string) error {
	return s.deleteJobGroup.DeleteJobGroup(id)
}

// GetJobGroup retrieves a job group by ID.
func (s *jobGroupManagerService) GetJobGroup(id string) (*entity.JobGroup, error) {
	return s.findJobGroup.FindJobGroupByID(id)
}

// ListJobGroupsByWorkspace retrieves all job groups for a workspace.
func (s *jobGroupManagerService) ListJobGroupsByWorkspace(workspaceID string) ([]entity.JobGroup, error) {
	return s.findJobGroup.FindJobGroupsByWorkspace(workspaceID)
}
