// Package adapter contains interfaces that application services implement.
package adapter

import "quant/internal/domain/entity"

// MindmapManager defines the service interface for mindmap management operations.
type MindmapManager interface {
	SetNode(scopeType, scopeID, board string, node entity.MindmapNode) (entity.MindmapNode, error)
	RemoveNode(scopeType, scopeID, board, id string, subtree bool) error
	ClearMindmap(scopeType, scopeID, board string) error
	GetMindmap(scopeType, scopeID, board string) ([]entity.MindmapNode, error)
	ListBoards(scopeType, scopeID string) ([]string, error)
}
