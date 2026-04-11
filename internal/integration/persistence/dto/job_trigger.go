// Package dto contains persistence data transfer objects for SQLite row mapping.
package dto

import (
	"quant/internal/domain/entity"
)

// JobTriggerRow represents a job trigger row in the SQLite database.
type JobTriggerRow struct {
	ID           string
	SourceJobID  string
	TargetJobID  string
	TriggerOn    string
	CustomPrompt string
}

// ToEntity converts a JobTriggerRow to a domain entity.
func (r JobTriggerRow) ToEntity() entity.JobTrigger {
	return entity.JobTrigger{
		ID:           r.ID,
		SourceJobID:  r.SourceJobID,
		TargetJobID:  r.TargetJobID,
		TriggerOn:    r.TriggerOn,
		CustomPrompt: r.CustomPrompt,
	}
}

// JobTriggerRowFromEntity converts a domain entity to a JobTriggerRow.
func JobTriggerRowFromEntity(trigger entity.JobTrigger) JobTriggerRow {
	return JobTriggerRow{
		ID:           trigger.ID,
		SourceJobID:  trigger.SourceJobID,
		TargetJobID:  trigger.TargetJobID,
		TriggerOn:    trigger.TriggerOn,
		CustomPrompt: trigger.CustomPrompt,
	}
}
