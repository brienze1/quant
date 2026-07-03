// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// ProcessActivity is a point-in-time snapshot of a session process's PTY
// activity, used for idle detection before injecting text into the terminal.
type ProcessActivity struct {
	LastOutputAt    time.Time
	Busy            bool
	BusyClearedAt   time.Time
	LastUserInputAt time.Time
	Tail            []byte
}
