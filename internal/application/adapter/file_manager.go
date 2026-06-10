// Package adapter contains interfaces that application services implement.
package adapter

import "quant/internal/domain/entity"

// FileManager defines the service interface for sandboxed file operations
// scoped to a session's working directory.
type FileManager interface {
	ListDir(sessionID, relPath string) ([]entity.FileEntry, error)
	ReadFile(sessionID, relPath string) (entity.FileContent, error)
	ReadFileBase64(sessionID, relPath string) (entity.FileBase64Content, error)
	WriteFile(sessionID, relPath, content string) error
	CreateFile(sessionID, relPath string) error
	CreateDir(sessionID, relPath string) error
	RenamePath(sessionID, oldRelPath, newRelPath string) error
	DeletePath(sessionID, relPath string, recursive bool) error
}
