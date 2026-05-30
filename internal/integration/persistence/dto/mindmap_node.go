// Package dto contains persistence data transfer objects for SQLite row mapping.
package dto

import (
	"time"

	"quant/internal/domain/entity"
)

// MindmapNodeRow represents a mindmap_nodes row in the SQLite database.
type MindmapNodeRow struct {
	ID        string
	ScopeType string
	ScopeID   string
	Board     string
	ParentID  string
	Kind      string
	Label     string
	Text      string
	Status    string
	Note      string
	Color     string
	Progress  int
	SortOrder int
	CreatedAt string
	UpdatedAt string
}

// ToEntity converts a MindmapNodeRow to a domain entity.
func (r MindmapNodeRow) ToEntity() entity.MindmapNode {
	createdAt, _ := time.Parse(time.RFC3339, r.CreatedAt)
	updatedAt, _ := time.Parse(time.RFC3339, r.UpdatedAt)

	return entity.MindmapNode{
		ID:        r.ID,
		ScopeType: r.ScopeType,
		ScopeID:   r.ScopeID,
		Board:     r.Board,
		ParentID:  r.ParentID,
		Kind:      r.Kind,
		Label:     r.Label,
		Text:      r.Text,
		Status:    r.Status,
		Note:      r.Note,
		Color:     r.Color,
		Progress:  r.Progress,
		SortOrder: r.SortOrder,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}
}

// MindmapNodeRowFromEntity converts a domain entity to a MindmapNodeRow.
func MindmapNodeRowFromEntity(node entity.MindmapNode) MindmapNodeRow {
	return MindmapNodeRow{
		ID:        node.ID,
		ScopeType: node.ScopeType,
		ScopeID:   node.ScopeID,
		Board:     node.Board,
		ParentID:  node.ParentID,
		Kind:      node.Kind,
		Label:     node.Label,
		Text:      node.Text,
		Status:    node.Status,
		Note:      node.Note,
		Color:     node.Color,
		Progress:  node.Progress,
		SortOrder: node.SortOrder,
		CreatedAt: node.CreatedAt.Format(time.RFC3339),
		UpdatedAt: node.UpdatedAt.Format(time.RFC3339),
	}
}
