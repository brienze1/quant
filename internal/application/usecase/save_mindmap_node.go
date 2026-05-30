package usecase

import (
	"quant/internal/domain/entity"
)

// SaveMindmapNode defines the interface for persisting (upserting) a mindmap node.
type SaveMindmapNode interface {
	SaveMindmapNode(node entity.MindmapNode) error
}
