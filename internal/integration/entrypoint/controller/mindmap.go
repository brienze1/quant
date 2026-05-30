// Package controller contains Wails-bound entrypoint controllers.
package controller

import (
	"context"

	appAdapter "quant/internal/application/adapter"
	intAdapter "quant/internal/integration/adapter"
	"quant/internal/integration/entrypoint/dto"
)

// mindmapController implements the intAdapter.MindmapController interface.
type mindmapController struct {
	ctx            context.Context
	mindmapManager appAdapter.MindmapManager
}

// NewMindmapController creates a new Wails-bound mindmap controller.
func NewMindmapController(mindmapManager appAdapter.MindmapManager) intAdapter.MindmapController {
	return &mindmapController{
		mindmapManager: mindmapManager,
	}
}

func (c *mindmapController) OnStartup(ctx context.Context) {
	c.ctx = ctx
}

func (c *mindmapController) OnShutdown(_ context.Context) {}

// defaultBoard returns the board name, defaulting to "default" when empty.
func defaultBoard(board string) string {
	if board == "" {
		return "default"
	}
	return board
}

// GetMindmap retrieves the mindmap nodes for a given session and board.
func (c *mindmapController) GetMindmap(sessionID, board string) ([]dto.MindmapNodeResponse, error) {
	nodes, err := c.mindmapManager.GetMindmap("session", sessionID, defaultBoard(board))
	if err != nil {
		return nil, err
	}

	return dto.MindmapNodeResponseListFromEntities(nodes), nil
}

// SetMindmapNode creates or updates a single mindmap node from the UI.
func (c *mindmapController) SetMindmapNode(sessionID, board string, req dto.MindmapNodeRequest) (dto.MindmapNodeResponse, error) {
	node := req.ToEntity()
	saved, err := c.mindmapManager.SetNode("session", sessionID, defaultBoard(board), node)
	if err != nil {
		return dto.MindmapNodeResponse{}, err
	}

	return dto.MindmapNodeResponseFromEntity(saved), nil
}

// RemoveMindmapNode removes a node (optionally its subtree) from a session's board.
func (c *mindmapController) RemoveMindmapNode(sessionID, board, id string, subtree bool) error {
	return c.mindmapManager.RemoveNode("session", sessionID, defaultBoard(board), id, subtree)
}

// ClearMindmapBoard removes all nodes from a session's board.
func (c *mindmapController) ClearMindmapBoard(sessionID, board string) error {
	return c.mindmapManager.ClearMindmap("session", sessionID, defaultBoard(board))
}

// ListBoards returns the distinct board names for a session.
func (c *mindmapController) ListBoards(sessionID string) ([]string, error) {
	return c.mindmapManager.ListBoards("session", sessionID)
}
