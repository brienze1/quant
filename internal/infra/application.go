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

// injectQuantMCP adds the Quant MCP server to ~/.claude/settings.json so Claude sessions
// inside Quant automatically have access to job management tools.
func injectQuantMCP() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return
	}
	settingsPath := filepath.Join(homeDir, ".claude", "settings.json")

	// Read existing settings
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		// No settings file — create one with just the MCP config
		data = []byte("{}")
	}

	var settings map[string]interface{}
	if err := json.Unmarshal(data, &settings); err != nil {
		return
	}

	// Add or update mcpServers.quant
	mcpServers, ok := settings["mcpServers"].(map[string]interface{})
	if !ok {
		mcpServers = make(map[string]interface{})
	}
	mcpServers["quant"] = map[string]interface{}{
		"url": "http://localhost:52945/mcp",
	}
	settings["mcpServers"] = mcpServers

	// Write back
	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(settingsPath, out, 0644)
}

// removeQuantMCP removes the Quant MCP server from ~/.claude/settings.json on shutdown.
func removeQuantMCP() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return
	}
	settingsPath := filepath.Join(homeDir, ".claude", "settings.json")

	data, err := os.ReadFile(settingsPath)
	if err != nil {
		return
	}

	var settings map[string]interface{}
	if err := json.Unmarshal(data, &settings); err != nil {
		return
	}

	mcpServers, ok := settings["mcpServers"].(map[string]interface{})
	if ok {
		delete(mcpServers, "quant")
		if len(mcpServers) == 0 {
			delete(settings, "mcpServers")
		} else {
			settings["mcpServers"] = mcpServers
		}
	}

	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(settingsPath, out, 0644)
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
	processManager := injector.ProcessManager()

	// Start MCP server for external AI tools to manage jobs.
	mcpServer := quantmcp.NewQuantMCPServer(injector.JobManager())
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
		},
		OnShutdown: func(ctx context.Context) {
			sessionCtrl.OnShutdown(ctx)
			repoCtrl.OnShutdown(ctx)
			taskCtrl.OnShutdown(ctx)
			actionCtrl.OnShutdown(ctx)
			configCtrl.OnShutdown(ctx)
			jobCtrl.OnShutdown(ctx)
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
		},
	})
	if err != nil {
		return fmt.Errorf("failed to run application: %w", err)
	}

	return nil
}
