// Package dto contains persistence data transfer objects for SQLite row mapping.
package dto

import (
	"database/sql"
	"strings"
	"time"

	"quant/internal/domain/entity"
)

// SessionRow represents a session row in the SQLite database.
type SessionRow struct {
	ID              string
	Name            string
	Description     sql.NullString
	SessionType     string
	Status          string
	Directory       string
	WorktreePath    sql.NullString
	BranchName      sql.NullString
	ClaudeConvID    sql.NullString
	PID             int
	RepoID          sql.NullString
	TaskID          sql.NullString
	SkipPermissions bool
	Model           sql.NullString
	ExtraCliArgs    sql.NullString
	WorkspaceID     string
	NoFlicker       int
	SortOrder       int
	CliCommand      string
	McpToken        string
	MessagingMode   string
	MessagingPeers  string
	CreatedAt       string
	UpdatedAt       string
	LastActiveAt    string
	ArchivedAt      sql.NullString
}

// ToEntity converts a SessionRow to a domain entity.
func (r SessionRow) ToEntity() entity.Session {
	createdAt, _ := time.Parse(time.RFC3339, r.CreatedAt)
	updatedAt, _ := time.Parse(time.RFC3339, r.UpdatedAt)
	lastActiveAt, _ := time.Parse(time.RFC3339, r.LastActiveAt)

	var archivedAt *time.Time
	if r.ArchivedAt.Valid {
		t, _ := time.Parse(time.RFC3339, r.ArchivedAt.String)
		archivedAt = &t
	}

	return entity.Session{
		ID:              r.ID,
		Name:            r.Name,
		Description:     r.Description.String,
		SessionType:     r.SessionType,
		Status:          r.Status,
		Directory:       r.Directory,
		WorktreePath:    r.WorktreePath.String,
		BranchName:      r.BranchName.String,
		ClaudeConvID:    r.ClaudeConvID.String,
		PID:             r.PID,
		RepoID:          r.RepoID.String,
		TaskID:          r.TaskID.String,
		SkipPermissions: r.SkipPermissions,
		Model:           r.Model.String,
		ExtraCliArgs:    r.ExtraCliArgs.String,
		WorkspaceID:     r.WorkspaceID,
		NoFlicker:       r.NoFlicker == 1,
		CliCommand:      r.CliCommand,
		McpToken:        r.McpToken,
		MessagingMode:   r.MessagingMode,
		MessagingPeers:  splitPeers(r.MessagingPeers),
		SortOrder:       r.SortOrder,
		CreatedAt:       createdAt,
		UpdatedAt:       updatedAt,
		LastActiveAt:    lastActiveAt,
		ArchivedAt:      archivedAt,
	}
}

// SessionRowFromEntity converts a domain entity to a SessionRow.
func SessionRowFromEntity(session entity.Session) SessionRow {
	var archivedAt sql.NullString
	if session.ArchivedAt != nil {
		archivedAt = sql.NullString{String: session.ArchivedAt.Format(time.RFC3339), Valid: true}
	}

	return SessionRow{
		ID:              session.ID,
		Name:            session.Name,
		Description:     toNullString(session.Description),
		SessionType:     session.SessionType,
		Status:          session.Status,
		Directory:       session.Directory,
		WorktreePath:    toNullString(session.WorktreePath),
		BranchName:      toNullString(session.BranchName),
		ClaudeConvID:    toNullString(session.ClaudeConvID),
		PID:             session.PID,
		RepoID:          toNullString(session.RepoID),
		TaskID:          toNullString(session.TaskID),
		SkipPermissions: session.SkipPermissions,
		Model:           toNullString(session.Model),
		ExtraCliArgs:    toNullString(session.ExtraCliArgs),
		WorkspaceID:     session.WorkspaceID,
		NoFlicker:       boolToInt(session.NoFlicker),
		CliCommand:      session.CliCommand,
		McpToken:        session.McpToken,
		MessagingMode:   session.MessagingMode,
		MessagingPeers:  joinPeers(session.MessagingPeers),
		SortOrder:       session.SortOrder,
		CreatedAt:       session.CreatedAt.Format(time.RFC3339),
		UpdatedAt:       session.UpdatedAt.Format(time.RFC3339),
		LastActiveAt:    session.LastActiveAt.Format(time.RFC3339),
		ArchivedAt:      archivedAt,
	}
}

// boolToInt converts a bool to an int (1 or 0).
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// toNullString converts a string to sql.NullString.
func toNullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

// splitPeers parses the stored messaging allowlist. Session IDs never contain a
// comma, so a comma-separated list keeps the column readable in the DB.
func splitPeers(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}

	parts := strings.Split(raw, ",")
	peers := make([]string, 0, len(parts))
	for _, part := range parts {
		if id := strings.TrimSpace(part); id != "" {
			peers = append(peers, id)
		}
	}
	return peers
}

// joinPeers renders the messaging allowlist for storage.
func joinPeers(peers []string) string {
	cleaned := make([]string, 0, len(peers))
	for _, id := range peers {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			cleaned = append(cleaned, trimmed)
		}
	}
	return strings.Join(cleaned, ",")
}
