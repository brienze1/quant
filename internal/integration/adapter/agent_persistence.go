// Package adapter contains integration adapter interfaces that combine multiple usecase interfaces.
package adapter

import (
	"quant/internal/application/usecase"
)

// AgentPersistence combines all agent-related persistence usecase interfaces.
// Integration persistence implementations must implement this interface.
type AgentPersistence interface {
	usecase.FindAgent
	usecase.SaveAgent
	usecase.UpdateAgent
	usecase.DeleteAgent
}
