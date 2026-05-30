// Package dto contains data transfer objects for the entrypoint layer.
package dto

import (
	"quant/internal/domain/entity"
)

// MindmapNodeResponse represents the response payload for a single mindmap node.
type MindmapNodeResponse struct {
	ID       string `json:"id"`
	ParentID string `json:"parentId"`
	Kind     string `json:"kind"`
	Label    string `json:"label"`
	Text     string `json:"text"`
	Status   string `json:"status"`
	Note     string `json:"note"`
	Progress int    `json:"progress"`
	Board    string `json:"board"`
}

// MindmapNodeRequest represents the request payload to create or update a single mindmap node.
// The scope (scopeType/scopeID) is set by the controller; the board travels alongside.
type MindmapNodeRequest struct {
	ID       string `json:"id"`
	ParentID string `json:"parentId"`
	Kind     string `json:"kind"`
	Label    string `json:"label"`
	Text     string `json:"text"`
	Status   string `json:"status"`
	Note     string `json:"note"`
	Progress int    `json:"progress"`
	Board    string `json:"board"`
}

// ToEntity converts a MindmapNodeRequest to a domain entity. The scope is set by the controller.
func (r MindmapNodeRequest) ToEntity() entity.MindmapNode {
	return entity.MindmapNode{
		ID:       r.ID,
		Board:    r.Board,
		ParentID: r.ParentID,
		Kind:     r.Kind,
		Label:    r.Label,
		Text:     r.Text,
		Status:   r.Status,
		Note:     r.Note,
		Progress: r.Progress,
	}
}

// MindmapNodeResponseFromEntity converts a domain entity to a MindmapNodeResponse DTO.
func MindmapNodeResponseFromEntity(n entity.MindmapNode) MindmapNodeResponse {
	return MindmapNodeResponse{
		ID:       n.ID,
		ParentID: n.ParentID,
		Kind:     n.Kind,
		Label:    n.Label,
		Text:     n.Text,
		Status:   n.Status,
		Note:     n.Note,
		Progress: n.Progress,
		Board:    n.Board,
	}
}

// MindmapNodeResponseListFromEntities converts a slice of domain entities to a slice of MindmapNodeResponse DTOs.
func MindmapNodeResponseListFromEntities(nodes []entity.MindmapNode) []MindmapNodeResponse {
	responses := make([]MindmapNodeResponse, len(nodes))
	for i, node := range nodes {
		responses[i] = MindmapNodeResponseFromEntity(node)
	}
	return responses
}
