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

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"quant/internal/infra/db"
	"quant/internal/infra/dependency"
	quantmcp "quant/internal/integration/mcp"
	"quant/internal/integration/persistence"
)

// injectQuantMCP adds the Quant MCP server to ~/.mcp.json so Claude sessions
// automatically have access to job management tools.
func injectQuantMCP() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return
	}
	mcpPath := filepath.Join(homeDir, ".mcp.json")

	// Read existing config
	data, err := os.ReadFile(mcpPath)
	if err != nil {
		data = []byte("{}")
	}

	var config map[string]interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return
	}

	// Add quant to mcpServers
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

	// Also enable in ~/.claude/settings.local.json
	localSettingsPath := filepath.Join(homeDir, ".claude", "settings.local.json")
	localData, err := os.ReadFile(localSettingsPath)
	if err != nil {
		localData = []byte("{}")
	}
	var localSettings map[string]interface{}
	if err := json.Unmarshal(localData, &localSettings); err != nil {
		return
	}
	enabled, _ := localSettings["enabledMcpjsonServers"].([]interface{})
	found := false
	for _, v := range enabled {
		if v == "quant" {
			found = true
			break
		}
	}
	if !found {
		enabled = append(enabled, "quant")
		localSettings["enabledMcpjsonServers"] = enabled
		localOut, err := json.MarshalIndent(localSettings, "", "  ")
		if err != nil {
			return
		}
		_ = os.WriteFile(localSettingsPath, localOut, 0644)
	}
}

// removeQuantMCP removes the Quant MCP server from ~/.mcp.json on shutdown.
func removeQuantMCP() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return
	}
	mcpPath := filepath.Join(homeDir, ".mcp.json")

	data, err := os.ReadFile(mcpPath)
	if err != nil {
		return
	}

	var config map[string]interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return
	}

	mcpServers, ok := config["mcpServers"].(map[string]interface{})
	if ok {
		delete(mcpServers, "quant")
		config["mcpServers"] = mcpServers
	}

	out, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(mcpPath, out, 0644)

	// Also remove from enabledMcpjsonServers in settings.local.json
	localSettingsPath := filepath.Join(homeDir, ".claude", "settings.local.json")
	localData, localErr := os.ReadFile(localSettingsPath)
	if localErr != nil {
		return
	}
	var localSettings map[string]interface{}
	if json.Unmarshal(localData, &localSettings) != nil {
		return
	}
	if enabled, ok := localSettings["enabledMcpjsonServers"].([]interface{}); ok {
		var filtered []interface{}
		for _, v := range enabled {
			if v != "quant" {
				filtered = append(filtered, v)
			}
		}
		localSettings["enabledMcpjsonServers"] = filtered
		localOut, _ := json.MarshalIndent(localSettings, "", "  ")
		_ = os.WriteFile(localSettingsPath, localOut, 0644)
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
