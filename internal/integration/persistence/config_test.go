package persistence

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"quant/internal/domain/entity"
)

// newTestConfigPersistence points a config store at an isolated file.
func newTestConfigPersistence(t *testing.T) *configPersistence {
	t.Helper()
	return &configPersistence{filePath: filepath.Join(t.TempDir(), "config.json")}
}

func TestConfigCacheServesRepeatReads(t *testing.T) {
	p := newTestConfigPersistence(t)

	cfg := entity.NewDefaultConfig()
	cfg.DefaultPullBranch = "trunk"
	if err := p.SaveConfig(&cfg); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	// Deleting the file would break an uncached read, so a successful read here
	// proves the cache served it.
	first, err := p.LoadConfig()
	if err != nil || first.DefaultPullBranch != "trunk" {
		t.Fatalf("LoadConfig: %v (%+v)", err, first)
	}

	second, err := p.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig (cached): %v", err)
	}
	if second.DefaultPullBranch != "trunk" {
		t.Errorf("cached read returned %q", second.DefaultPullBranch)
	}
	if first == second {
		t.Error("each read should get its own copy, not the cached pointer")
	}
}

func TestConfigCacheNoticesAnEditOnDisk(t *testing.T) {
	p := newTestConfigPersistence(t)

	cfg := entity.NewDefaultConfig()
	cfg.DefaultPullBranch = "main"
	if err := p.SaveConfig(&cfg); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	if _, err := p.LoadConfig(); err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	// An edit made outside the app — a different size and modification time.
	if err := os.WriteFile(p.filePath, []byte(`{"defaultPullBranch":"develop"}`), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	_ = os.Chtimes(p.filePath, time.Now().Add(time.Second), time.Now().Add(time.Second))

	reloaded, err := p.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig after edit: %v", err)
	}
	if reloaded.DefaultPullBranch != "develop" {
		t.Errorf("an external edit was not picked up: got %q", reloaded.DefaultPullBranch)
	}
}

func TestConfigCacheIsNotMutableThroughACopy(t *testing.T) {
	p := newTestConfigPersistence(t)

	cfg := entity.NewDefaultConfig()
	cfg.CommandOverrides = map[string]string{"work": "claude-da"}
	if err := p.SaveConfig(&cfg); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	loaded, err := p.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	loaded.CommandOverrides["work"] = "tampered"
	loaded.Shortcuts = append(loaded.Shortcuts, entity.Shortcut{Name: "x"})

	again, err := p.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if again.CommandOverrides["work"] != "claude-da" {
		t.Errorf("the cache was mutated through a handed-out copy: %q", again.CommandOverrides["work"])
	}
}
