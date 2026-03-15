// Package adapter contains integration adapter interfaces that combine multiple usecase interfaces.
package adapter

import (
	"quant/internal/application/usecase"
)

// DatabaseManager combines database-related usecase interfaces.
// Integration implementations must implement this interface.
type DatabaseManager interface {
	usecase.ResetDatabase
	usecase.ClearSessionLogs
	usecase.GetDatabasePath
}
