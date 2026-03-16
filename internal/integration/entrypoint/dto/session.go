// Package dto contains data transfer objects for the entrypoint layer.
package dto

import (
	"quant/internal/domain/entity"
)

// CreateSessionRequest represents the request payload for creating a new session.
type CreateSessionRequest struct {
	Name            string `json:"name"`
	Description     string `json:"description"`
	RepoID          string `json:"repoId"`
	TaskID          string `json:"taskId"`
	SessionType     string `json:"sessionType"`
	UseWorktree     bool   `json:"useWorktree"`
	SkipPermissions bool   `json:"skipPermissions"`

	// Advanced options (per-session overrides from config defaults)
	AutoPull          bool   `json:"autoPull"`
	PullBranch        string `json:"pullBranch"`
	BranchNamePattern string `json:"branchNamePattern"`
	Model             string `json:"model"`
	ExtraCliArgs      string `json:"extraCliArgs"`
	DirectoryOverride string `json:"directoryOverride"`
}

// SessionResponse represents the response payload for session data.
type SessionResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	SessionType  string `json:"sessionType"`
	Status       string `json:"status"`
	Directory    string `json:"directory"`
	WorktreePath string `json:"worktreePath"`
	BranchName   string `json:"branchName"`
	ClaudeConvID string `json:"claudeConvId"`
	PID          int    `json:"pid"`
	RepoID       string `json:"repoId"`
	TaskID       string `json:"taskId"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	LastActiveAt string `json:"lastActiveAt"`
	ArchivedAt   string `json:"archivedAt"`
}

// SessionResponseFromEntity converts a domain entity to a SessionResponse DTO.
func SessionResponseFromEntity(session entity.Session) SessionResponse {
	var archivedAt string
	if session.ArchivedAt != nil {
		archivedAt = session.ArchivedAt.Format("2006-01-02T15:04:05Z07:00")
	}

	return SessionResponse{
		ID:           session.ID,
		Name:         session.Name,
		Description:  session.Description,
		SessionType:  session.SessionType,
		Status:       session.Status,
		Directory:    session.Directory,
		WorktreePath: session.WorktreePath,
		BranchName:   session.BranchName,
		ClaudeConvID: session.ClaudeConvID,
		PID:          session.PID,
		RepoID:       session.RepoID,
		TaskID:       session.TaskID,
		CreatedAt:    session.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:    session.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		LastActiveAt: session.LastActiveAt.Format("2006-01-02T15:04:05Z07:00"),
		ArchivedAt:   archivedAt,
	}
}

// SessionResponseFromEntityPtr converts a domain entity pointer to a SessionResponse DTO pointer.
func SessionResponseFromEntityPtr(session *entity.Session) *SessionResponse {
	if session == nil {
		return nil
	}
	response := SessionResponseFromEntity(*session)
	return &response
}

// SessionResponseListFromEntities converts a slice of domain entities to a slice of SessionResponse DTOs.
func SessionResponseListFromEntities(sessions []entity.Session) []SessionResponse {
	responses := make([]SessionResponse, len(sessions))
	for i, session := range sessions {
		responses[i] = SessionResponseFromEntity(session)
	}
	return responses
}
