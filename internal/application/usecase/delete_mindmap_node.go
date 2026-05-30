package usecase

// DeleteMindmapNode defines the interface for deleting mindmap nodes.
type DeleteMindmapNode interface {
	DeleteMindmapNode(scopeType, scopeID, board, id string) error
	DeleteMindmapSubtree(scopeType, scopeID, board, id string) error
	ClearMindmap(scopeType, scopeID, board string) error
}
