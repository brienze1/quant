// Package dto contains data transfer objects for the entrypoint layer.
package dto

import (
	"quant/internal/domain/entity"
	"quant/internal/domain/persona"
)

// ShortcutDTO represents a named shell command in config.
type ShortcutDTO struct {
	Name    string `json:"name"`
	Command string `json:"command"`
}

// VoiceConfigDTO is the frontend-facing voice config. The deprecated custom
// endpoint fields (BaseURL/STTBaseURL/TTSBaseURL/APIKey/STTModel/TTSModel) are
// deliberately NOT exposed here: the embedded engine needs no endpoints, and
// the controller carries the stored values forward on every save so a power
// user's hand-edited custom endpoints are never wiped by the Settings UI (see
// controller SaveConfig).
type VoiceConfigDTO struct {
	Enabled        bool    `json:"enabled"`
	Provider       string  `json:"provider"`
	Voice          string  `json:"voice"`
	Language       string  `json:"language"` // voice language: "en" (default) or "pt-br"
	Speed          float64 `json:"speed"`
	PauseMs        int     `json:"pauseMs"`        // VAD redemption window (ms): how long the user can pause before their turn ends
	Instructions   string  `json:"instructions"`   // optional user-authored guidance appended to the built-in voice persona
	ManagedRuntime bool    `json:"managedRuntime"` // user opted into quant-managed local engines (one-click install)
}

// SaveConfigRequest represents the request payload for saving configuration.
type SaveConfigRequest struct {
	// General
	StartOnLogin  bool          `json:"startOnLogin"`
	Notifications bool          `json:"notifications"`
	AutoUpdate    bool          `json:"autoUpdate"`
	Shortcuts     []ShortcutDTO `json:"shortcuts"`

	// Git & Branches
	AutoPull            bool              `json:"autoPull"`
	DefaultPullBranch   string            `json:"defaultPullBranch"`
	BranchNamePattern   string            `json:"branchNamePattern"`
	DeleteBranchOnDone  bool              `json:"deleteBranchOnDone"`
	BranchOverrides     map[string]string `json:"branchOverrides"`
	CommitMessagePrefix string            `json:"commitMessagePrefix"`

	// Sessions
	UseWorktreeDefault    bool     `json:"useWorktreeDefault"`
	SkipPermissions       bool     `json:"skipPermissions"`
	MaxConcurrentSessions int      `json:"maxConcurrentSessions"`
	AutoResumeOnStart     bool     `json:"autoResumeOnStart"`
	AutoStopIdle          bool     `json:"autoStopIdle"`
	IdleTimeoutMinutes    int      `json:"idleTimeoutMinutes"`
	ActiveSessionID       string   `json:"activeSessionId"`
	OpenSessionIDs        []string `json:"openSessionIds"`
	VoicePaneOpen         bool     `json:"voicePaneOpen"`

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
	NewLineKey      string  `json:"newLineKey"`

	// Claude CLI
	CliBinaryPath    string            `json:"cliBinaryPath"`
	ExtraCliArgs     string            `json:"extraCliArgs"`
	DefaultModel     string            `json:"defaultModel"`
	AssistantModel   string            `json:"assistantModel"`
	EnvVariables     map[string]string `json:"envVariables"`
	CommandOverrides map[string]string `json:"commandOverrides"`
	BasePersona      string            `json:"basePersona"` // empty = use built-in default

	// Remote Access
	RemoteAccessEnabled  bool   `json:"remoteAccessEnabled"`
	RemoteAccessPort     int    `json:"remoteAccessPort"`
	RemoteAccessPasscode string `json:"remoteAccessPasscode"`

	// Voice
	Voice VoiceConfigDTO `json:"voice"`
}

// ConfigResponse represents the response payload for configuration data.
type ConfigResponse struct {
	// General
	StartOnLogin  bool          `json:"startOnLogin"`
	Notifications bool          `json:"notifications"`
	AutoUpdate    bool          `json:"autoUpdate"`
	Shortcuts     []ShortcutDTO `json:"shortcuts"`

	// Git & Branches
	AutoPull            bool              `json:"autoPull"`
	DefaultPullBranch   string            `json:"defaultPullBranch"`
	BranchNamePattern   string            `json:"branchNamePattern"`
	DeleteBranchOnDone  bool              `json:"deleteBranchOnDone"`
	BranchOverrides     map[string]string `json:"branchOverrides"`
	CommitMessagePrefix string            `json:"commitMessagePrefix"`

	// Sessions
	UseWorktreeDefault    bool     `json:"useWorktreeDefault"`
	SkipPermissions       bool     `json:"skipPermissions"`
	MaxConcurrentSessions int      `json:"maxConcurrentSessions"`
	AutoResumeOnStart     bool     `json:"autoResumeOnStart"`
	AutoStopIdle          bool     `json:"autoStopIdle"`
	IdleTimeoutMinutes    int      `json:"idleTimeoutMinutes"`
	ActiveSessionID       string   `json:"activeSessionId"`
	OpenSessionIDs        []string `json:"openSessionIds"`
	VoicePaneOpen         bool     `json:"voicePaneOpen"`

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
	NewLineKey      string  `json:"newLineKey"`

	// Claude CLI
	CliBinaryPath    string            `json:"cliBinaryPath"`
	ExtraCliArgs     string            `json:"extraCliArgs"`
	DefaultModel     string            `json:"defaultModel"`
	AssistantModel   string            `json:"assistantModel"`
	EnvVariables     map[string]string `json:"envVariables"`
	CommandOverrides map[string]string `json:"commandOverrides"`
	BasePersona      string            `json:"basePersona"` // user override; empty = built-in default in use
	// DefaultBasePersona is read-only: the built-in persona.Base text, so the UI can
	// show it as the placeholder/preview and offer a "reset to default" action.
	DefaultBasePersona string `json:"defaultBasePersona"`

	// Remote Access
	RemoteAccessEnabled  bool   `json:"remoteAccessEnabled"`
	RemoteAccessPort     int    `json:"remoteAccessPort"`
	RemoteAccessPasscode string `json:"remoteAccessPasscode"`

	// Voice — the deprecated endpoint/key/model fields are never returned.
	Voice VoiceConfigDTO `json:"voice"`
}

// ConfigResponseFromEntity converts a domain entity to a ConfigResponse DTO.
func ConfigResponseFromEntity(cfg entity.Config) ConfigResponse {
	shortcuts := make([]ShortcutDTO, len(cfg.Shortcuts))
	for i, s := range cfg.Shortcuts {
		shortcuts[i] = ShortcutDTO{Name: s.Name, Command: s.Command}
	}
	return ConfigResponse{
		StartOnLogin:          cfg.StartOnLogin,
		Notifications:         cfg.Notifications,
		AutoUpdate:            cfg.AutoUpdate,
		Shortcuts:             shortcuts,
		AutoPull:              cfg.AutoPull,
		DefaultPullBranch:     cfg.DefaultPullBranch,
		BranchNamePattern:     cfg.BranchNamePattern,
		DeleteBranchOnDone:    cfg.DeleteBranchOnDone,
		BranchOverrides:       cfg.BranchOverrides,
		CommitMessagePrefix:   cfg.CommitMessagePrefix,
		UseWorktreeDefault:    cfg.UseWorktreeDefault,
		SkipPermissions:       cfg.SkipPermissions,
		MaxConcurrentSessions: cfg.MaxConcurrentSessions,
		AutoResumeOnStart:     cfg.AutoResumeOnStart,
		AutoStopIdle:          cfg.AutoStopIdle,
		IdleTimeoutMinutes:    cfg.IdleTimeoutMinutes,
		ActiveSessionID:       cfg.ActiveSessionID,
		OpenSessionIDs:        cfg.OpenSessionIDs,
		VoicePaneOpen:         cfg.VoicePaneOpen,
		DataDirectory:         cfg.DataDirectory,
		WorktreeDirectory:     cfg.WorktreeDirectory,
		LogDirectory:          cfg.LogDirectory,
		FontFamily:            cfg.FontFamily,
		FontSize:              cfg.FontSize,
		LineHeight:            cfg.LineHeight,
		CursorStyle:           cfg.CursorStyle,
		CursorBlink:           cfg.CursorBlink,
		ScrollbackLines:       cfg.ScrollbackLines,
		NewLineKey:            cfg.NewLineKey,
		CliBinaryPath:         cfg.CliBinaryPath,
		ExtraCliArgs:          cfg.ExtraCliArgs,
		DefaultModel:          cfg.DefaultModel,
		AssistantModel:        cfg.AssistantModel,
		EnvVariables:          cfg.EnvVariables,
		CommandOverrides:      cfg.CommandOverrides,
		BasePersona:           cfg.BasePersona,
		DefaultBasePersona:    persona.Base,
		RemoteAccessEnabled:   cfg.RemoteAccessEnabled,
		RemoteAccessPort:      cfg.RemoteAccessPort,
		RemoteAccessPasscode:  cfg.RemoteAccessPasscode,
		// The deprecated endpoint/key/model fields are intentionally omitted.
		Voice: VoiceConfigDTO{
			Enabled:        cfg.Voice.Enabled,
			Provider:       cfg.Voice.Provider,
			Voice:          cfg.Voice.Voice,
			Language:       cfg.Voice.Language,
			Speed:          cfg.Voice.Speed,
			PauseMs:        cfg.Voice.PauseMs,
			Instructions:   cfg.Voice.Instructions,
			ManagedRuntime: cfg.Voice.ManagedRuntime,
		},
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

	commandOverrides := r.CommandOverrides
	if commandOverrides == nil {
		commandOverrides = make(map[string]string)
	}

	shortcuts := make([]entity.Shortcut, len(r.Shortcuts))
	for i, s := range r.Shortcuts {
		shortcuts[i] = entity.Shortcut{Name: s.Name, Command: s.Command}
	}

	return entity.Config{
		StartOnLogin:          r.StartOnLogin,
		Notifications:         r.Notifications,
		AutoUpdate:            r.AutoUpdate,
		Shortcuts:             shortcuts,
		AutoPull:              r.AutoPull,
		DefaultPullBranch:     r.DefaultPullBranch,
		BranchNamePattern:     r.BranchNamePattern,
		DeleteBranchOnDone:    r.DeleteBranchOnDone,
		BranchOverrides:       branchOverrides,
		CommitMessagePrefix:   r.CommitMessagePrefix,
		UseWorktreeDefault:    r.UseWorktreeDefault,
		SkipPermissions:       r.SkipPermissions,
		MaxConcurrentSessions: r.MaxConcurrentSessions,
		AutoResumeOnStart:     r.AutoResumeOnStart,
		AutoStopIdle:          r.AutoStopIdle,
		IdleTimeoutMinutes:    r.IdleTimeoutMinutes,
		ActiveSessionID:       r.ActiveSessionID,
		OpenSessionIDs:        r.OpenSessionIDs,
		VoicePaneOpen:         r.VoicePaneOpen,
		DataDirectory:         r.DataDirectory,
		WorktreeDirectory:     r.WorktreeDirectory,
		LogDirectory:          r.LogDirectory,
		FontFamily:            r.FontFamily,
		FontSize:              r.FontSize,
		LineHeight:            r.LineHeight,
		CursorStyle:           r.CursorStyle,
		CursorBlink:           r.CursorBlink,
		ScrollbackLines:       r.ScrollbackLines,
		NewLineKey:            r.NewLineKey,
		CliBinaryPath:         r.CliBinaryPath,
		ExtraCliArgs:          r.ExtraCliArgs,
		DefaultModel:          r.DefaultModel,
		AssistantModel:        r.AssistantModel,
		EnvVariables:          envVariables,
		CommandOverrides:      commandOverrides,
		BasePersona:           r.BasePersona,
		RemoteAccessEnabled:   r.RemoteAccessEnabled,
		RemoteAccessPort:      r.RemoteAccessPort,
		RemoteAccessPasscode:  r.RemoteAccessPasscode,
		// The deprecated endpoint/key/model fields are not carried by the DTO;
		// the controller copies the stored values forward on save.
		Voice: entity.VoiceConfig{
			Enabled:        r.Voice.Enabled,
			Provider:       r.Voice.Provider,
			Voice:          r.Voice.Voice,
			Language:       r.Voice.Language,
			Speed:          r.Voice.Speed,
			PauseMs:        r.Voice.PauseMs,
			Instructions:   r.Voice.Instructions,
			ManagedRuntime: r.Voice.ManagedRuntime,
		},
	}
}
