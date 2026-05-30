// Package events contains the Wails runtime event emitter implementation.
package events

import (
	"context"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Emitter emits events to the frontend via the Wails runtime.
type Emitter struct {
	ctx context.Context
}

// NewEmitter creates a new event emitter.
func NewEmitter() *Emitter {
	return &Emitter{}
}

// SetContext sets the Wails runtime context used for emitting events.
func (e *Emitter) SetContext(ctx context.Context) {
	e.ctx = ctx
}

// Emit sends an event with the given name and payload to the frontend.
func (e *Emitter) Emit(name string, payload any) {
	if e.ctx != nil {
		wailsRuntime.EventsEmit(e.ctx, name, payload)
	}
}
