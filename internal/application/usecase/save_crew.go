package usecase

import (
	"quant/internal/domain/entity"
)

// SaveCrew defines the interface for persisting crew assignments, envelopes and watchdogs.
type SaveCrew interface {
	SaveAssignment(assignment entity.CrewAssignment) error
	SaveEnvelope(envelope entity.CrewEnvelope) error
	SaveWatchdog(watchdog entity.CrewWatchdog) error
	MarkEnvelopeDelivered(id string) error
	MarkWatchdogFired(id string) error
	SetDeliveryLock(supervisorSessionID string, locked bool) error
}
