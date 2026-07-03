// Package adapter contains integration adapter interfaces that combine multiple usecase interfaces.
package adapter

import (
	"quant/internal/application/usecase"
)

// CrewPersistence combines all crew-related persistence usecase interfaces.
type CrewPersistence interface {
	usecase.FindCrew
	usecase.SaveCrew
	usecase.DeleteCrew
}
