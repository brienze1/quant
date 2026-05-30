// Package service contains application service implementations.
package service

import (
	"fmt"
	"time"

	"quant/internal/application/adapter"
	"quant/internal/application/usecase"
	"quant/internal/domain/entity"
)

// validMindmapStatuses holds the allowed status values for a mindmap node.
var validMindmapStatuses = map[string]bool{
	"planned":     true,
	"in_progress": true,
	"done":        true,
	"blocked":     true,
}

// mindmapManagerService implements the adapter.MindmapManager interface.
type mindmapManagerService struct {
	findMindmapNode   usecase.FindMindmapNode
	saveMindmapNode   usecase.SaveMindmapNode
	deleteMindmapNode usecase.DeleteMindmapNode
	emitter           adapter.EventEmitter
}

// NewMindmapManagerService creates a new mindmap manager service.
func NewMindmapManagerService(
	find usecase.FindMindmapNode,
	save usecase.SaveMindmapNode,
	del usecase.DeleteMindmapNode,
	emitter adapter.EventEmitter,
) adapter.MindmapManager {
	return &mindmapManagerService{
		findMindmapNode:   find,
		saveMindmapNode:   save,
		deleteMindmapNode: del,
		emitter:           emitter,
	}
}

// SetNode validates, normalizes and upserts a mindmap node, then emits a snapshot.
func (s *mindmapManagerService) SetNode(scopeType, scopeID, board string, node entity.MindmapNode) (entity.MindmapNode, error) {
	if board == "" {
		board = "default"
	}

	// Force the node into the passed scope and board.
	node.ScopeType = scopeType
	node.ScopeID = scopeID
	node.Board = board

	// Default and validate status.
	if node.Status == "" {
		node.Status = "planned"
	}
	if !validMindmapStatuses[node.Status] {
		return entity.MindmapNode{}, fmt.Errorf("invalid mindmap status: %s", node.Status)
	}

	// Default kind.
	if node.Kind == "" {
		node.Kind = "node"
	}

	// Clamp progress.
	if node.Progress < -1 {
		node.Progress = -1
	}
	if node.Progress > 100 {
		node.Progress = 100
	}

	// Validate parent: must exist in this scope/board and must not create a cycle.
	if node.ParentID != "" {
		if err := s.validateParent(scopeType, scopeID, board, node.ID, node.ParentID); err != nil {
			return entity.MindmapNode{}, err
		}
	}

	// Stamp timestamps: preserve CreatedAt for existing nodes.
	now := time.Now()
	existing, err := s.findMindmapNode.FindMindmapNodeByID(scopeType, scopeID, board, node.ID)
	if err != nil {
		return entity.MindmapNode{}, fmt.Errorf("failed to look up mindmap node: %w", err)
	}
	if existing != nil {
		node.CreatedAt = existing.CreatedAt
	} else {
		node.CreatedAt = now
	}
	node.UpdatedAt = now

	if err := s.saveMindmapNode.SaveMindmapNode(node); err != nil {
		return entity.MindmapNode{}, fmt.Errorf("failed to save mindmap node: %w", err)
	}

	s.emitSnapshot(scopeType, scopeID, board)

	return node, nil
}

// validateParent ensures the parent exists in the scope/board and that linking does not create a cycle.
func (s *mindmapManagerService) validateParent(scopeType, scopeID, board, nodeID, parentID string) error {
	if parentID == nodeID {
		return fmt.Errorf("mindmap node cannot be its own parent: %s", nodeID)
	}

	nodes, err := s.findMindmapNode.FindMindmapNodesByScope(scopeType, scopeID, board)
	if err != nil {
		return fmt.Errorf("failed to load mindmap nodes: %w", err)
	}

	parentOf := make(map[string]string, len(nodes))
	exists := make(map[string]bool, len(nodes))
	for _, n := range nodes {
		parentOf[n.ID] = n.ParentID
		exists[n.ID] = true
	}

	if !exists[parentID] {
		return fmt.Errorf("mindmap parent not found in scope: %s", parentID)
	}

	// Walk up from parent; if we reach nodeID, linking would create a cycle.
	current := parentID
	seen := make(map[string]bool)
	for current != "" {
		if current == nodeID {
			return fmt.Errorf("mindmap parent change would create a cycle for node: %s", nodeID)
		}
		if seen[current] {
			break
		}
		seen[current] = true
		current = parentOf[current]
	}

	return nil
}

// RemoveNode deletes a node (optionally with its subtree) and emits a snapshot.
func (s *mindmapManagerService) RemoveNode(scopeType, scopeID, board, id string, subtree bool) error {
	if board == "" {
		board = "default"
	}

	if subtree {
		if err := s.deleteMindmapNode.DeleteMindmapSubtree(scopeType, scopeID, board, id); err != nil {
			return fmt.Errorf("failed to delete mindmap subtree: %w", err)
		}
	} else {
		if err := s.deleteMindmapNode.DeleteMindmapNode(scopeType, scopeID, board, id); err != nil {
			return fmt.Errorf("failed to delete mindmap node: %w", err)
		}
	}

	s.emitSnapshot(scopeType, scopeID, board)

	return nil
}

// ClearMindmap removes all nodes for a scope/board and emits a snapshot.
func (s *mindmapManagerService) ClearMindmap(scopeType, scopeID, board string) error {
	if board == "" {
		board = "default"
	}

	if err := s.deleteMindmapNode.ClearMindmap(scopeType, scopeID, board); err != nil {
		return fmt.Errorf("failed to clear mindmap: %w", err)
	}

	s.emitSnapshot(scopeType, scopeID, board)

	return nil
}

// GetMindmap returns all nodes for a scope/board.
func (s *mindmapManagerService) GetMindmap(scopeType, scopeID, board string) ([]entity.MindmapNode, error) {
	if board == "" {
		board = "default"
	}
	return s.findMindmapNode.FindMindmapNodesByScope(scopeType, scopeID, board)
}

// ListBoards returns the distinct board names for a scope.
func (s *mindmapManagerService) ListBoards(scopeType, scopeID string) ([]string, error) {
	return s.findMindmapNode.DistinctBoards(scopeType, scopeID)
}

// MoveBoard moves every node of a board from one session to another and emits
// snapshots for both the source and target panes. Returns the final board name.
func (s *mindmapManagerService) MoveBoard(scopeType, fromScopeID, board, toScopeID string) (string, error) {
	if board == "" {
		board = "default"
	}

	finalBoard, err := s.findMindmapNode.MoveBoard(scopeType, fromScopeID, board, toScopeID)
	if err != nil {
		return "", fmt.Errorf("failed to move mindmap board: %w", err)
	}

	s.emitSnapshot(scopeType, fromScopeID, board)
	s.emitSnapshot(scopeType, toScopeID, finalBoard)

	return finalBoard, nil
}

// emitSnapshot loads the current nodes for the scope/board and emits them in the frontend JSON shape.
func (s *mindmapManagerService) emitSnapshot(scopeType, scopeID, board string) {
	if s.emitter == nil {
		return
	}

	nodes, err := s.findMindmapNode.FindMindmapNodesByScope(scopeType, scopeID, board)
	if err != nil {
		return
	}

	payloadNodes := make([]map[string]any, 0, len(nodes))
	for _, n := range nodes {
		payloadNodes = append(payloadNodes, map[string]any{
			"id":       n.ID,
			"parentId": n.ParentID,
			"kind":     n.Kind,
			"label":    n.Label,
			"text":     n.Text,
			"status":   n.Status,
			"note":     n.Note,
			"progress": n.Progress,
		})
	}

	s.emitter.Emit("mindmap:updated", map[string]any{
		"sessionId": scopeID,
		"board":     board,
		"nodes":     payloadNodes,
	})
}
