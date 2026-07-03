package usecase

import (
	"quant/internal/domain/entity"
)

// SessionActivity exposes per-session process activity for idle detection, and
// raw injected writes that deliberately do NOT arm the user-typing guard.
type SessionActivity interface {
	Activity(sessionID string) (entity.ProcessActivity, bool)
	WriteInjected(sessionID string, data string) error
}
