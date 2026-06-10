// Package dto contains data transfer objects for the entrypoint layer.
package dto

import (
	"time"

	"quant/internal/domain/entity"
)

// FileEntryResponse represents a single directory entry in a session's working directory.
type FileEntryResponse struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

// FileContentResponse represents the result of reading a file from a session's working directory.
type FileContentResponse struct {
	Content  string `json:"content"`
	Size     int64  `json:"size"`
	TooLarge bool   `json:"tooLarge"`
	Binary   bool   `json:"binary"`
}

// FileBase64Response represents the result of reading a file's raw bytes as base64
// from a session's working directory.
type FileBase64Response struct {
	ContentBase64 string `json:"contentBase64"`
	Mime          string `json:"mime"`
	Size          int64  `json:"size"`
	TooLarge      bool   `json:"tooLarge"`
}

// FileEntryResponseFromEntity converts a domain entity to a FileEntryResponse DTO.
func FileEntryResponseFromEntity(e entity.FileEntry) FileEntryResponse {
	return FileEntryResponse{
		Name:    e.Name,
		Path:    e.Path,
		IsDir:   e.IsDir,
		Size:    e.Size,
		ModTime: e.ModTime.Format(time.RFC3339),
	}
}

// FileEntryResponseListFromEntities converts a slice of domain entities to a slice of FileEntryResponse DTOs.
func FileEntryResponseListFromEntities(entries []entity.FileEntry) []FileEntryResponse {
	responses := make([]FileEntryResponse, len(entries))
	for i, entry := range entries {
		responses[i] = FileEntryResponseFromEntity(entry)
	}
	return responses
}

// FileContentResponseFromEntity converts a domain entity to a FileContentResponse DTO.
func FileContentResponseFromEntity(c entity.FileContent) FileContentResponse {
	return FileContentResponse{
		Content:  c.Content,
		Size:     c.Size,
		TooLarge: c.TooLarge,
		Binary:   c.Binary,
	}
}

// FileBase64ResponseFromEntity converts a domain entity to a FileBase64Response DTO.
func FileBase64ResponseFromEntity(c entity.FileBase64Content) FileBase64Response {
	return FileBase64Response{
		ContentBase64: c.ContentBase64,
		Mime:          c.Mime,
		Size:          c.Size,
		TooLarge:      c.TooLarge,
	}
}
