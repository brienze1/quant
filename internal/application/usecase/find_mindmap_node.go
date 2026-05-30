package usecase

import (
	"quant/internal/domain/entity"
)

// FindMindmapNode defines the interface for mindmap node retrieval operations.
type FindMindmapNode interface {
	FindMindmapNodesByScope(scopeType, scopeID, board string) ([]entity.MindmapNode, error)
	FindMindmapNodeByID(scopeType, scopeID, board, id string) (*entity.MindmapNode, error)
	DistinctBoards(scopeType, scopeID string) ([]string, error)
}
