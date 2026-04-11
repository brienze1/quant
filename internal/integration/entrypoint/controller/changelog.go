package controller

import (
	"context"
	"encoding/json"
	"fmt"

	intadapter "quant/internal/integration/adapter"
	"quant/internal/domain/entity"
)

// changelogController implements the integration adapter.ChangelogController interface.
type changelogController struct {
	ctx           context.Context
	changelogData []byte
}

// NewChangelogController creates a new changelog controller.
func NewChangelogController(changelogData []byte) intadapter.ChangelogController {
	return &changelogController{
		changelogData: changelogData,
	}
}

// OnStartup is called when the Wails app starts.
func (c *changelogController) OnStartup(ctx context.Context) {
	c.ctx = ctx
}

// OnShutdown is called when the Wails app is shutting down.
func (c *changelogController) OnShutdown(_ context.Context) {}

// GetChangelog returns the full changelog parsed from the embedded JSON.
func (c *changelogController) GetChangelog() (*entity.Changelog, error) {
	var changelog entity.Changelog
	if err := json.Unmarshal(c.changelogData, &changelog); err != nil {
		return nil, fmt.Errorf("failed to parse changelog: %w", err)
	}
	return &changelog, nil
}

// GetVersion returns the current app version (latest tag from changelog).
func (c *changelogController) GetVersion() string {
	var changelog entity.Changelog
	if err := json.Unmarshal(c.changelogData, &changelog); err != nil || len(changelog.Entries) == 0 {
		return "v0.0.0"
	}
	return changelog.Entries[0].Version
}
