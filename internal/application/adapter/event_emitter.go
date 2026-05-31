// Package adapter contains interfaces that application services implement.
package adapter

// EventEmitter defines a layer-clean abstraction for emitting events to the frontend.
type EventEmitter interface {
	Emit(name string, payload any)
}
