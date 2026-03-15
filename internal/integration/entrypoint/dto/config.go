// Package dto contains data transfer objects for the entrypoint layer.
package dto

import (
	"quant/internal/domain/entity"
)

// SaveConfigRequest represents the request payload for saving configuration.
type SaveConfigRequest struct {
	// General
	StartOnLogin  bool `json:"startOnLogin"`
	Notifications bool `json:"notifications"`

	// Git & Branches
	AutoPull           bool              `json:"autoPull"`
	DefaultPullBranch  string            `json:"defaultPullBranch"`
	BranchNamePattern  string            `json:"branchNamePattern"`
	DeleteBranchOnDone bool              `json:"deleteBranchOnDone"`
	BranchOverrides    map[string]string `json:"branchOverrides"`

	// Sessions
	UseWorktreeDefault    bool `json:"useWorktreeDefault"`
	SkipPermissions       bool `json:"skipPermissions"`
	MaxConcurrentSessions int  `json:"maxConcurrentSessions"`
	AutoResumeOnStart     bool `json:"autoResumeOnStart"`
	AutoStopIdle          bool `json:"autoStopIdle"`
	IdleTimeoutMinutes    int  `json:"idleTimeoutMinutes"`

	// Storage & Data
	DataDirectory     string `json:"dataDirectory"`
	WorktreeDirectory string `json:"worktreeDirectory"`
	LogDirectory      string `json:"logDirectory"`

	// Terminal
	FontFamily      string  `json:"fontFamily"`
	FontSize        int     `json:"fontSize"`
	LineHeight      float64 `json:"lineHeight"`
	CursorStyle     string  `json:"cursorStyle"`
	CursorBlink     bool    `json:"cursorBlink"`
	ScrollbackLines int     `json:"scrollbackLines"`

	// Claude CLI
	CliBinaryPath string            `json:"cliBinaryPath"`
	ExtraCliArgs  string            `json:"extraCliArgs"`
	DefaultModel  string            `json:"defaultModel"`
	EnvVariables  map[string]string `json:"envVariables"`
}

// ConfigResponse represents the response payload for configuration data.
type ConfigResponse struct {
	// General
	StartOnLogin  bool `json:"startOnLogin"`
	Notifications bool `json:"notifications"`

	// Git & Branches
	AutoPull           bool              `json:"autoPull"`
	DefaultPullBranch  string            `json:"defaultPullBranch"`
	BranchNamePattern  string            `json:"branchNamePattern"`
	DeleteBranchOnDone bool              `json:"deleteBranchOnDone"`
	BranchOverrides    map[string]string `json:"branchOverrides"`

	// Sessions
	UseWorktreeDefault    bool `json:"useWorktreeDefault"`
	SkipPermissions       bool `json:"skipPermissions"`
	MaxConcurrentSessions int  `json:"maxConcurrentSessions"`
	AutoResumeOnStart     bool `json:"autoResumeOnStart"`
	AutoStopIdle          bool `json:"autoStopIdle"`
	IdleTimeoutMinutes    int  `json:"idleTimeoutMinutes"`

	// Storage & Data
	DataDirectory     string `json:"dataDirectory"`
	WorktreeDirectory string `json:"worktreeDirectory"`
	LogDirectory      string `json:"logDirectory"`

	// Terminal
	FontFamily      string  `json:"fontFamily"`
	FontSize        int     `json:"fontSize"`
	LineHeight      float64 `json:"lineHeight"`
	CursorStyle     string  `json:"cursorStyle"`
	CursorBlink     bool    `json:"cursorBlink"`
	ScrollbackLines int     `json:"scrollbackLines"`

	// Claude CLI
	CliBinaryPath string            `json:"cliBinaryPath"`
	ExtraCliArgs  string            `json:"extraCliArgs"`
	DefaultModel  string            `json:"defaultModel"`
	EnvVariables  map[string]string `json:"envVariables"`
}

// ConfigResponseFromEntity converts a domain entity to a ConfigResponse DTO.
func ConfigResponseFromEntity(cfg entity.Config) ConfigResponse {
	return ConfigResponse{
		StartOnLogin:          cfg.StartOnLogin,
		Notifications:         cfg.Notifications,
		AutoPull:              cfg.AutoPull,
		DefaultPullBranch:     cfg.DefaultPullBranch,
		BranchNamePattern:     cfg.BranchNamePattern,
		DeleteBranchOnDone:    cfg.DeleteBranchOnDone,
		BranchOverrides:       cfg.BranchOverrides,
		UseWorktreeDefault:    cfg.UseWorktreeDefault,
		SkipPermissions:       cfg.SkipPermissions,
		MaxConcurrentSessions: cfg.MaxConcurrentSessions,
		AutoResumeOnStart:     cfg.AutoResumeOnStart,
		AutoStopIdle:          cfg.AutoStopIdle,
		IdleTimeoutMinutes:    cfg.IdleTimeoutMinutes,
		DataDirectory:         cfg.DataDirectory,
		WorktreeDirectory:     cfg.WorktreeDirectory,
		LogDirectory:          cfg.LogDirectory,
		FontFamily:            cfg.FontFamily,
		FontSize:              cfg.FontSize,
		LineHeight:            cfg.LineHeight,
		CursorStyle:           cfg.CursorStyle,
		CursorBlink:           cfg.CursorBlink,
		ScrollbackLines:       cfg.ScrollbackLines,
		CliBinaryPath:         cfg.CliBinaryPath,
		ExtraCliArgs:          cfg.ExtraCliArgs,
		DefaultModel:          cfg.DefaultModel,
		EnvVariables:          cfg.EnvVariables,
	}
}

// ConfigResponseFromEntityPtr converts a domain entity pointer to a ConfigResponse DTO pointer.
func ConfigResponseFromEntityPtr(cfg *entity.Config) *ConfigResponse {
	if cfg == nil {
		return nil
	}
	response := ConfigResponseFromEntity(*cfg)
	return &response
}

// ToEntity converts a SaveConfigRequest DTO to a domain entity.
func (r SaveConfigRequest) ToEntity() entity.Config {
	branchOverrides := r.BranchOverrides
	if branchOverrides == nil {
		branchOverrides = make(map[string]string)
	}

	envVariables := r.EnvVariables
	if envVariables == nil {
		envVariables = make(map[string]string)
	}

	return entity.Config{
		StartOnLogin:          r.StartOnLogin,
		Notifications:         r.Notifications,
		AutoPull:              r.AutoPull,
		DefaultPullBranch:     r.DefaultPullBranch,
		BranchNamePattern:     r.BranchNamePattern,
		DeleteBranchOnDone:    r.DeleteBranchOnDone,
		BranchOverrides:       branchOverrides,
		UseWorktreeDefault:    r.UseWorktreeDefault,
		SkipPermissions:       r.SkipPermissions,
		MaxConcurrentSessions: r.MaxConcurrentSessions,
		AutoResumeOnStart:     r.AutoResumeOnStart,
		AutoStopIdle:          r.AutoStopIdle,
		IdleTimeoutMinutes:    r.IdleTimeoutMinutes,
		DataDirectory:         r.DataDirectory,
		WorktreeDirectory:     r.WorktreeDirectory,
		LogDirectory:          r.LogDirectory,
		FontFamily:            r.FontFamily,
		FontSize:              r.FontSize,
		LineHeight:            r.LineHeight,
		CursorStyle:           r.CursorStyle,
		CursorBlink:           r.CursorBlink,
		ScrollbackLines:       r.ScrollbackLines,
		CliBinaryPath:         r.CliBinaryPath,
		ExtraCliArgs:          r.ExtraCliArgs,
		DefaultModel:          r.DefaultModel,
		EnvVariables:          envVariables,
	}
}
