package controller

import (
	"context"
	"encoding/json"
	"fmt"

	intadapter "quant/internal/integration/adapter"
	"quant/internal/domain/entity"
)

// Version is the app version, injected at build time via
//
//	-ldflags "-X quant/internal/integration/entrypoint/controller.Version=v3.1.23"
//
// (the Homebrew formula sets it to the release tag). It is empty for `go run`
// and source builds without that flag, in which case GetVersion falls back to
// the newest changelog entry. Injecting the tag keeps the displayed version in
// lockstep with the actual release, instead of trailing changelog.json.
var Version string

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

// GetVersion returns the current app version. It prefers the build-time
// injected Version (the release tag); when that is empty (dev/source builds)
// it falls back to the newest changelog entry.
func (c *changelogController) GetVersion() string {
	if Version != "" {
		return Version
	}
	var changelog entity.Changelog
	if err := json.Unmarshal(c.changelogData, &changelog); err != nil || len(changelog.Entries) == 0 {
		return "v0.0.0"
	}
	return changelog.Entries[0].Version
}
