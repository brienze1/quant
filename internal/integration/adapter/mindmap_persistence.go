// Package adapter contains integration adapter interfaces that combine multiple usecase interfaces.
package adapter

import (
	"quant/internal/application/usecase"
)

// MindmapPersistence combines all mindmap-node-related persistence usecase interfaces.
type MindmapPersistence interface {
	usecase.FindMindmapNode
	usecase.SaveMindmapNode
	usecase.DeleteMindmapNode
}
