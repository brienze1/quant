package adapter

import (
	"context"

	"quant/internal/integration/entrypoint/dto"
)

// MindmapController defines the interface for the mindmap entrypoint controller.
type MindmapController interface {
	OnStartup(ctx context.Context)
	OnShutdown(ctx context.Context)
	GetMindmap(sessionID, board string) ([]dto.MindmapNodeResponse, error)
	SetMindmapNode(sessionID, board string, req dto.MindmapNodeRequest) (dto.MindmapNodeResponse, error)
	RemoveMindmapNode(sessionID, board, id string, subtree bool) error
	ClearMindmapBoard(sessionID, board string) error
	ListBoards(sessionID string) ([]string, error)
	MoveBoard(sessionID, board, toSessionID string) (string, error)
}
