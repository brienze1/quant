// Package adapter contains integration adapter interfaces that combine multiple usecase interfaces.
package adapter

import (
	"quant/internal/application/usecase"
)

// ConfigPersistence combines all config-related persistence usecase interfaces.
// Integration persistence implementations must implement this interface.
type ConfigPersistence interface {
	usecase.LoadConfig
	usecase.SaveConfig
}
