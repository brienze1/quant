package controller

import "testing"

// TestGetVersion verifies the version source: the build-time injected Version
// (set via -ldflags "-X ...Version=...") takes precedence, and source builds
// without it fall back to the newest changelog entry.
//
// Run without ldflags -> exercises the fallback branch.
// Run with    go test -ldflags "-X quant/internal/integration/entrypoint/controller.Version=v9.9.9"
//   -> exercises the injected branch and proves the ldflags symbol path is exact.
func TestGetVersion(t *testing.T) {
	c := NewChangelogController([]byte(`{"entries":[{"version":"v1.2.3"},{"version":"v1.2.2"}]}`))
	got := c.GetVersion()

	if Version != "" {
		if got != Version {
			t.Fatalf("with injected build version: want %q, got %q", Version, got)
		}
		return
	}
	if got != "v1.2.3" {
		t.Fatalf("source build (no ldflags): want changelog fallback %q, got %q", "v1.2.3", got)
	}
}

// TestGetVersion_EmptyChangelogFallback ensures a missing/empty changelog with
// no injected version degrades to a sentinel rather than panicking.
func TestGetVersion_EmptyChangelogFallback(t *testing.T) {
	if Version != "" {
		t.Skip("build version injected; fallback path not exercised")
	}
	c := NewChangelogController([]byte(`{"entries":[]}`))
	if got := c.GetVersion(); got != "v0.0.0" {
		t.Fatalf("want v0.0.0 sentinel, got %q", got)
	}
}
