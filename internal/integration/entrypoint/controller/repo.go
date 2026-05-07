// Package controller contains entrypoint controllers bound to the Wails runtime.
package controller

import (
	"context"
	"os/exec"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"quant/internal/application/adapter"
	intadapter "quant/internal/integration/adapter"
	"quant/internal/integration/entrypoint/dto"
)

// repoController implements the integration adapter.RepoController interface.
// It is bound to the Wails runtime and exposes repo management operations to the frontend.
type repoController struct {
	ctx         context.Context
	repoManager adapter.RepoManager
}

// NewRepoController creates a new repo controller.
// Returns the intadapter.RepoController interface, not the concrete type.
func NewRepoController(repoManager adapter.RepoManager) intadapter.RepoController {
	return &repoController{
		repoManager: repoManager,
	}
}

// OnStartup is called when the Wails app starts. The context is saved for runtime method calls.
func (c *repoController) OnStartup(ctx context.Context) {
	c.ctx = ctx
}

// OnShutdown is called when the Wails app is shutting down.
func (c *repoController) OnShutdown(_ context.Context) {
	// Clean up if needed.
}

// BrowseDirectory opens a native directory picker dialog and returns the selected path.
func (c *repoController) BrowseDirectory() (string, error) {
	path, err := wailsRuntime.OpenDirectoryDialog(c.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select Repository Directory",
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// OpenRepo registers a new repository and returns its response DTO.
func (c *repoController) OpenRepo(request dto.CreateRepoRequest) (*dto.RepoResponse, error) {
	repo, err := c.repoManager.OpenRepo(request.Name, request.Path, request.WorkspaceID)
	if err != nil {
		return nil, err
	}

	return dto.RepoResponseFromEntityPtr(repo), nil
}

// ListReposByWorkspace returns all registered repositories for a workspace as response DTOs.
func (c *repoController) ListReposByWorkspace(workspaceID string) ([]dto.RepoResponse, error) {
	repos, err := c.repoManager.ListReposByWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}

	return dto.RepoResponseListFromEntities(repos), nil
}

// ListClosedReposByWorkspace returns paginated closed repositories for a workspace
// as response DTOs, ordered by most recently closed first.
func (c *repoController) ListClosedReposByWorkspace(workspaceID string, limit int, offset int) ([]dto.RepoResponse, error) {
	repos, err := c.repoManager.ListClosedReposByWorkspace(workspaceID, limit, offset)
	if err != nil {
		return nil, err
	}

	return dto.RepoResponseListFromEntities(repos), nil
}

// GetRepo returns a single repo by ID as a response DTO.
func (c *repoController) GetRepo(id string) (*dto.RepoResponse, error) {
	repo, err := c.repoManager.GetRepo(id)
	if err != nil {
		return nil, err
	}

	return dto.RepoResponseFromEntityPtr(repo), nil
}

// RemoveRepo removes a repository registration.
func (c *repoController) RemoveRepo(id string) error {
	return c.repoManager.RemoveRepo(id)
}

// OpenInTerminal opens the given path in the macOS Terminal app.
func (c *repoController) OpenInTerminal(path string) error {
	cmd := exec.Command("open", "-a", "Terminal", path)
	return cmd.Run()
}

// OpenInFinder opens the given path in macOS Finder.
func (c *repoController) OpenInFinder(path string) error {
	cmd := exec.Command("open", path)
	return cmd.Run()
}
