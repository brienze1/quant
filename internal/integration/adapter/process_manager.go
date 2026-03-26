package adapter

import (
	"context"

	"quant/internal/application/usecase"
)

// ProcessManager combines process-related usecase interfaces.
// Integration process implementations must implement this interface.
type ProcessManager interface {
	usecase.SpawnProcess
	usecase.UpdateCliBinaryConfig
	SetContext(ctx context.Context)
}
