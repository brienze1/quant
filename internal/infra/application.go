// Package infra contains the infrastructure layer responsible for bootstrapping the application.
package infra

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"quant/internal/infra/db"
	"quant/internal/infra/dependency"
	quantmcp "quant/internal/integration/mcp"
	"quant/internal/integration/persistence"
)

// discoverClaudeConfigDirs finds all Claude config directories.
// Looks for ~/.claude and ~/.claude-* directories that contain settings.local.json
// (or could contain one — we create it if missing).
func discoverClaudeConfigDirs() []string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil
	}

	var dirs []string

	// Always include the default
	dirs = append(dirs, filepath.Join(homeDir, ".claude"))

	// Scan for ~/.claude-* directories (e.g. ~/.claude-bl, ~/.claude-sec, ~/.claude-bh)
	entries, err := os.ReadDir(homeDir)
	if err != nil {
		return dirs
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() && strings.HasPrefix(name, ".claude-") {
			dirs = append(dirs, filepath.Join(homeDir, name))
		}
	}

	return dirs
}

// enableQuantInSettingsLocal adds "quant" to enabledMcpjsonServers in a settings.local.json file.
func enableQuantInSettingsLocal(settingsPath string) {
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		data = []byte("{}")
	}
	var settings map[string]interface{}
	if json.Unmarshal(data, &settings) != nil {
		settings = make(map[string]interface{})
	}

	enabled, _ := settings["enabledMcpjsonServers"].([]interface{})
	for _, v := range enabled {
		if v == "quant" {
			return // already enabled
		}
	}
	enabled = append(enabled, "quant")
	settings["enabledMcpjsonServers"] = enabled

	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(settingsPath, out, 0644)
}

// disableQuantInSettingsLocal removes "quant" from enabledMcpjsonServers in a settings.local.json file.
func disableQuantInSettingsLocal(settingsPath string) {
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		return
	}
	var settings map[string]interface{}
	if json.Unmarshal(data, &settings) != nil {
		return
	}

	enabled, ok := settings["enabledMcpjsonServers"].([]interface{})
	if !ok {
		return
	}
	var filtered []interface{}
	for _, v := range enabled {
		if v != "quant" {
			filtered = append(filtered, v)
		}
	}
	settings["enabledMcpjsonServers"] = filtered

	out, _ := json.MarshalIndent(settings, "", "  ")
	_ = os.WriteFile(settingsPath, out, 0644)
}

// injectQuantMCP registers the Quant MCP server so all Claude accounts can discover it.
// 1. Adds the "quant" server entry to ~/.mcp.json (the global server registry).
// 2. Enables it in every detected Claude config dir's settings.local.json.
func injectQuantMCP() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return
	}

	// 1. Add quant to ~/.mcp.json (only the quant entry — don't touch anything else)
	mcpPath := filepath.Join(homeDir, ".mcp.json")
	data, err := os.ReadFile(mcpPath)
	if err != nil {
		data = []byte("{}")
	}
	var config map[string]interface{}
	if json.Unmarshal(data, &config) != nil {
		config = make(map[string]interface{})
	}
	mcpServers, ok := config["mcpServers"].(map[string]interface{})
	if !ok {
		mcpServers = make(map[string]interface{})
	}
	mcpServers["quant"] = map[string]interface{}{
		"type": "http",
		"url":  "http://localhost:52945/mcp",
	}
	config["mcpServers"] = mcpServers
	out, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(mcpPath, out, 0644)

	// 2. Enable quant in every Claude config dir's settings.local.json
	for _, dir := range discoverClaudeConfigDirs() {
		enableQuantInSettingsLocal(filepath.Join(dir, "settings.local.json"))
	}
}

// removeQuantMCP removes the Quant MCP server on shutdown.
// 1. Removes the "quant" entry from ~/.mcp.json.
// 2. Removes it from every detected Claude config dir's settings.local.json.
func removeQuantMCP() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return
	}

	// 1. Remove quant from ~/.mcp.json
	mcpPath := filepath.Join(homeDir, ".mcp.json")
	data, err := os.ReadFile(mcpPath)
	if err != nil {
		return
	}
	var config map[string]interface{}
	if json.Unmarshal(data, &config) != nil {
		return
	}
	if mcpServers, ok := config["mcpServers"].(map[string]interface{}); ok {
		delete(mcpServers, "quant")
		config["mcpServers"] = mcpServers
	}
	out, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(mcpPath, out, 0644)

	// 2. Remove from every Claude config dir's settings.local.json
	for _, dir := range discoverClaudeConfigDirs() {
		disableQuantInSettingsLocal(filepath.Join(dir, "settings.local.json"))
	}
}

// Run bootstraps and starts the Wails application with all dependencies wired.
func Run(assets embed.FS) error {
	database, err := db.NewSQLiteConnection()
	if err != nil {
		return fmt.Errorf("failed to initialize database: %w", err)
	}
	defer database.Close()

	// On startup, mark any "running" sessions as "paused" since their processes
	// died when the app was closed. Output is preserved on disk for replay.
	_, _ = database.Exec(`UPDATE sessions SET status = 'paused', pid = 0 WHERE status = 'running'`)

	// Mark any "running" job runs as "failed" since they were interrupted by app restart.
	_, _ = database.Exec(`UPDATE job_runs SET status = 'failed', error_message = 'interrupted by app restart' WHERE status = 'running'`)

	// Load config early to check auto-update preference.
	configPersistence := persistence.NewConfigPersistence()
	cfg, _ := configPersistence.LoadConfig()
	if cfg != nil && cfg.AutoUpdate {
		go func() {
			exec.Command("brew", "update").Run()
			exec.Command("brew", "upgrade", "quant").Run()
		}()
	}

	injector := dependency.NewInjector(database)
	sessionCtrl := injector.SessionController()
	repoCtrl := injector.RepoController()
	taskCtrl := injector.TaskController()
	actionCtrl := injector.ActionController()
	configCtrl := injector.ConfigController()
	jobCtrl := injector.JobController()
	agentCtrl := injector.AgentController()
	workspaceCtrl := injector.WorkspaceController()
	jobGroupCtrl := injector.JobGroupController()
	processManager := injector.ProcessManager()

	// Start MCP server for external AI tools to manage jobs.
	mcpServer := quantmcp.NewQuantMCPServer(injector.JobManager(), injector.AgentManager(), injector.SessionManager(), injector.WorkspaceManager(), injector.RepoManager(), injector.JobGroupManager())
	go func() {
		if err := mcpServer.Start(); err != nil {
			fmt.Printf("MCP server error: %v\n", err)
		}
	}()

	// Inject Quant MCP into Claude settings so sessions auto-discover it.
	injectQuantMCP()

	// Start job scheduler for recurring/one-time scheduled jobs.
	jobScheduler := injector.JobScheduler()
	jobScheduler.Start()

	err = wails.Run(&options.App{
		Title:  ">_ quant",
		Width:  1440,
		Height: 900,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 10, G: 10, B: 10, A: 1},
		OnStartup: func(ctx context.Context) {
			processManager.SetContext(ctx)
			sessionCtrl.OnStartup(ctx)
			repoCtrl.OnStartup(ctx)
			taskCtrl.OnStartup(ctx)
			actionCtrl.OnStartup(ctx)
			configCtrl.OnStartup(ctx)
			jobCtrl.OnStartup(ctx)
			agentCtrl.OnStartup(ctx)
			workspaceCtrl.OnStartup(ctx)
			jobGroupCtrl.OnStartup(ctx)
		},
		OnShutdown: func(ctx context.Context) {
			sessionCtrl.OnShutdown(ctx)
			repoCtrl.OnShutdown(ctx)
			taskCtrl.OnShutdown(ctx)
			actionCtrl.OnShutdown(ctx)
			configCtrl.OnShutdown(ctx)
			jobCtrl.OnShutdown(ctx)
			agentCtrl.OnShutdown(ctx)
			workspaceCtrl.OnShutdown(ctx)
			jobGroupCtrl.OnShutdown(ctx)
			jobScheduler.Stop()
			_ = mcpServer.Stop()
			removeQuantMCP()
		},
		Bind: []interface{}{
			sessionCtrl,
			repoCtrl,
			taskCtrl,
			actionCtrl,
			configCtrl,
			jobCtrl,
			agentCtrl,
			workspaceCtrl,
			jobGroupCtrl,
		},
	})
	if err != nil {
		return fmt.Errorf("failed to run application: %w", err)
	}

	return nil
}
