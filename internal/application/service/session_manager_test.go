package service

import (
	"errors"
	"testing"

	"quant/internal/domain/entity"
)

// stubLoadConfig returns a fixed config (or error) for resolvePull tests.
type stubLoadConfig struct {
	cfg *entity.Config
	err error
}

func (s stubLoadConfig) LoadConfig() (*entity.Config, error) { return s.cfg, s.err }

func boolPtr(v bool) *bool { return &v }

// TestResolvePull covers how the per-repo branch override, the config-wide
// default and the per-session options combine when deciding what to pull.
func TestResolvePull(t *testing.T) {
	repo := &entity.Repo{Name: "creator-api", Path: "/tmp/creator-api"}

	cfg := func() *entity.Config {
		return &entity.Config{
			AutoPull:          true,
			DefaultPullBranch: "main",
			BranchOverrides:   map[string]string{"creator-api": "homolog"},
		}
	}

	cases := []struct {
		name       string
		cfg        *entity.Config
		cfgErr     error
		opts       entity.SessionOptions
		wantPull   bool
		wantBranch string
	}{
		{
			name:       "override-wins-over-config-default",
			cfg:        cfg(),
			opts:       entity.SessionOptions{AutoPull: boolPtr(true), PullBranch: "main"},
			wantPull:   true,
			wantBranch: "homolog",
		},
		{
			name:       "explicit-branch-wins-over-override",
			cfg:        cfg(),
			opts:       entity.SessionOptions{AutoPull: boolPtr(true), PullBranch: "release"},
			wantPull:   true,
			wantBranch: "release",
		},
		{
			name:       "unspecified-autopull-falls-back-to-config",
			cfg:        cfg(),
			opts:       entity.SessionOptions{},
			wantPull:   true,
			wantBranch: "homolog",
		},
		{
			name:     "explicit-autopull-off-never-pulls",
			cfg:      cfg(),
			opts:     entity.SessionOptions{AutoPull: boolPtr(false)},
			wantPull: false,
		},
		{
			name:     "config-autopull-off-never-pulls",
			cfg:      &entity.Config{DefaultPullBranch: "main"},
			opts:     entity.SessionOptions{},
			wantPull: false,
		},
		{
			name: "repo-without-override-uses-default",
			cfg: &entity.Config{
				AutoPull:          true,
				DefaultPullBranch: "develop",
				BranchOverrides:   map[string]string{"other-repo": "homolog"},
			},
			opts:       entity.SessionOptions{AutoPull: boolPtr(true)},
			wantPull:   true,
			wantBranch: "develop",
		},
		{
			name:       "unreadable-config-falls-back-to-main",
			cfgErr:     errors.New("boom"),
			opts:       entity.SessionOptions{AutoPull: boolPtr(true)},
			wantPull:   true,
			wantBranch: "main",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &sessionManagerService{loadConfig: stubLoadConfig{cfg: tc.cfg, err: tc.cfgErr}}
			gotPull, gotBranch := s.resolvePull(repo, tc.opts)
			if gotPull != tc.wantPull {
				t.Fatalf("autoPull = %v, want %v", gotPull, tc.wantPull)
			}
			if tc.wantPull && gotBranch != tc.wantBranch {
				t.Fatalf("branch = %q, want %q", gotBranch, tc.wantBranch)
			}
		})
	}
}
