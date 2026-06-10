// Package controller contains Wails-bound entrypoint controllers.
package controller

import (
	"context"

	appAdapter "quant/internal/application/adapter"
	intAdapter "quant/internal/integration/adapter"
	"quant/internal/integration/entrypoint/dto"
)

// fileController implements the intAdapter.FileController interface.
type fileController struct {
	ctx         context.Context
	fileManager appAdapter.FileManager
}

// NewFileController creates a new Wails-bound file controller.
func NewFileController(fileManager appAdapter.FileManager) intAdapter.FileController {
	return &fileController{
		fileManager: fileManager,
	}
}

func (c *fileController) OnStartup(ctx context.Context) {
	c.ctx = ctx
}

func (c *fileController) OnShutdown(_ context.Context) {}

// ListDir returns a single directory level of the session's working directory.
func (c *fileController) ListDir(sessionID, relPath string) ([]dto.FileEntryResponse, error) {
	entries, err := c.fileManager.ListDir(sessionID, relPath)
	if err != nil {
		return nil, err
	}

	return dto.FileEntryResponseListFromEntities(entries), nil
}

// ReadFile reads a file's content from the session's working directory.
func (c *fileController) ReadFile(sessionID, relPath string) (dto.FileContentResponse, error) {
	content, err := c.fileManager.ReadFile(sessionID, relPath)
	if err != nil {
		return dto.FileContentResponse{}, err
	}

	return dto.FileContentResponseFromEntity(content), nil
}

// ReadFileBase64 reads a file's raw bytes as base64 from the session's working directory.
func (c *fileController) ReadFileBase64(sessionID, relPath string) (dto.FileBase64Response, error) {
	content, err := c.fileManager.ReadFileBase64(sessionID, relPath)
	if err != nil {
		return dto.FileBase64Response{}, err
	}

	return dto.FileBase64ResponseFromEntity(content), nil
}

// WriteFile writes content to a file in the session's working directory.
func (c *fileController) WriteFile(sessionID, relPath, content string) error {
	return c.fileManager.WriteFile(sessionID, relPath, content)
}

// CreateFile creates a new empty file in the session's working directory.
func (c *fileController) CreateFile(sessionID, relPath string) error {
	return c.fileManager.CreateFile(sessionID, relPath)
}

// CreateDir creates a directory in the session's working directory.
func (c *fileController) CreateDir(sessionID, relPath string) error {
	return c.fileManager.CreateDir(sessionID, relPath)
}

// RenamePath renames or moves a file/directory within the session's working directory.
func (c *fileController) RenamePath(sessionID, oldRelPath, newRelPath string) error {
	return c.fileManager.RenamePath(sessionID, oldRelPath, newRelPath)
}

// DeletePath permanently deletes a file or directory from the session's working directory.
func (c *fileController) DeletePath(sessionID, relPath string, recursive bool) error {
	return c.fileManager.DeletePath(sessionID, relPath, recursive)
}
