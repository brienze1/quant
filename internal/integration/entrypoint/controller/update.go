package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"quant/internal/domain/entity"
	intadapter "quant/internal/integration/adapter"
)

// githubLatestReleaseURL returns the latest published release for the repo.
const githubLatestReleaseURL = "https://api.github.com/repos/brienze1/quant/releases/latest"

// updateController implements the integration adapter.UpdateController interface.
// It checks GitHub for newer releases, upgrades via Homebrew, and relaunches.
type updateController struct {
	ctx           context.Context
	changelogData []byte
}

// NewUpdateController creates a new update controller. The embedded changelog is
// used as the source of truth for the running app version (same as the changelog
// controller), avoiding a second baked-in version constant.
func NewUpdateController(changelogData []byte) intadapter.UpdateController {
	return &updateController{changelogData: changelogData}
}

// OnStartup is called when the Wails app starts. The context is saved for runtime calls.
func (c *updateController) OnStartup(ctx context.Context) {
	c.ctx = ctx
}

// OnShutdown is called when the Wails app is shutting down.
func (c *updateController) OnShutdown(_ context.Context) {}

// currentVersion returns the running app version from the embedded changelog.
func (c *updateController) currentVersion() string {
	var changelog entity.Changelog
	if err := json.Unmarshal(c.changelogData, &changelog); err != nil || len(changelog.Entries) == 0 {
		return "v0.0.0"
	}
	return changelog.Entries[0].Version
}

// CheckForUpdate queries the GitHub releases API for the latest tag and reports
// whether it is newer than the running version.
func (c *updateController) CheckForUpdate() (*entity.UpdateInfo, error) {
	current := c.currentVersion()

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(c.ctx, http.MethodGet, githubLatestReleaseURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var release struct {
		TagName string `json:"tag_name"`
		Body    string `json:"body"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.Unmarshal(body, &release); err != nil {
		return nil, fmt.Errorf("could not parse GitHub response: %w", err)
	}

	return &entity.UpdateInfo{
		CurrentVersion:  current,
		LatestVersion:   release.TagName,
		UpdateAvailable: compareVersions(release.TagName, current) > 0,
		ReleaseNotes:    release.Body,
		ReleaseURL:      release.HTMLURL,
	}, nil
}

// PerformUpdate upgrades the app via Homebrew. This mirrors the auto-update path
// in infra.Run but runs on demand and surfaces failures with brew output.
func (c *updateController) PerformUpdate() error {
	if out, err := exec.Command("brew", "update").CombinedOutput(); err != nil {
		return fmt.Errorf("brew update failed: %s", strings.TrimSpace(string(out)))
	}
	if out, err := exec.Command("brew", "upgrade", "quant").CombinedOutput(); err != nil {
		return fmt.Errorf("brew upgrade failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// Restart relaunches the app so the upgraded binary takes effect, then quits the
// current instance.
func (c *updateController) Restart() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}

	// On macOS the binary lives inside a .app bundle; re-open the bundle via
	// LaunchServices so a fresh instance starts cleanly. Otherwise exec the
	// binary directly.
	if bundle := macAppBundle(exe); bundle != "" {
		if err := exec.Command("open", "-n", bundle).Start(); err != nil {
			return err
		}
	} else {
		cmd := exec.Command(exe)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Start(); err != nil {
			return err
		}
	}

	// Give the relaunch a moment to spawn before tearing this instance down.
	go func() {
		time.Sleep(500 * time.Millisecond)
		wailsRuntime.Quit(c.ctx)
	}()
	return nil
}

// macAppBundle returns the path to the enclosing .app bundle for a macOS
// executable (".../Quant.app/Contents/MacOS/quant" -> ".../Quant.app"), or ""
// when the executable is not inside a bundle.
func macAppBundle(exe string) string {
	const marker = ".app/Contents/MacOS/"
	if i := strings.Index(exe, marker); i != -1 {
		return exe[:i+len(".app")]
	}
	return ""
}

// compareVersions returns 1 if a > b, -1 if a < b, and 0 if equal. It accepts an
// optional leading "v" and ignores any pre-release/build suffix.
func compareVersions(a, b string) int {
	pa, pb := parseVersion(a), parseVersion(b)
	for i := 0; i < 3; i++ {
		switch {
		case pa[i] > pb[i]:
			return 1
		case pa[i] < pb[i]:
			return -1
		}
	}
	return 0
}

// parseVersion splits a "vMAJOR.MINOR.PATCH" string into its numeric parts,
// tolerating a missing "v", missing parts, and pre-release suffixes.
func parseVersion(v string) [3]int {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+"); i != -1 {
		v = v[:i]
	}
	var out [3]int
	for i, part := range strings.Split(v, ".") {
		if i > 2 {
			break
		}
		n, _ := strconv.Atoi(part)
		out[i] = n
	}
	return out
}
