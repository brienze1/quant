// Package infra contains the infrastructure layer responsible for bootstrapping the application.
package infra

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"quant/internal/infra/db"
	"quant/internal/infra/dependency"
	"quant/internal/infra/paths"
	"quant/internal/integration/entrypoint/controller"
	quantmcp "quant/internal/integration/mcp"
	"quant/internal/integration/persistence"
	"quant/internal/integration/remote"
	"quant/internal/integration/voice"
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
//  1. Adds the "quant" server entry to the .mcp.json registry (real ~/.mcp.json in
//     production; $QUANT_HOME/.mcp.json in isolated mode).
//  2. Enables it in every detected Claude config dir's settings.local.json
//     (production only; skipped in isolated mode, which relies on --mcp-config trust).
func injectQuantMCP(port int) {
	// 1. Add quant to the .mcp.json registry (only the quant entry — don't touch
	// anything else). In isolated mode (QUANT_HOME set) this targets
	// $QUANT_HOME/.mcp.json so the real ~/.mcp.json is never mutated.
	mcpPath := paths.MCPConfigPath()
	if err := os.MkdirAll(filepath.Dir(mcpPath), 0755); err != nil {
		return
	}
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
		"url":  fmt.Sprintf("http://localhost:%d/mcp", port),
		// Claude Code expands ${QUANT_SESSION_ID} per session from the spawned
		// process env, so each session's mindmap MCP calls are scoped to it.
		"headers": map[string]interface{}{
			"X-Quant-Session": "${QUANT_SESSION_ID}",
		},
	}
	config["mcpServers"] = mcpServers
	out, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(mcpPath, out, 0644)

	// 2. Enable quant in every Claude config dir's settings.local.json.
	// Skip in isolated mode: there we rely on --mcp-config trust at spawn time
	// and must not touch the user's real ~/.claude config. Also honor the
	// explicit QUANT_SKIP_CLAUDE_CONFIG gate.
	if paths.IsIsolated() || paths.SkipClaudeConfigDiscovery() {
		return
	}
	for _, dir := range discoverClaudeConfigDirs() {
		enableQuantInSettingsLocal(filepath.Join(dir, "settings.local.json"))
	}
}

// removeQuantMCP removes the Quant MCP server on shutdown.
//  1. Removes the "quant" entry from the .mcp.json registry (real ~/.mcp.json in
//     production; $QUANT_HOME/.mcp.json in isolated mode).
//  2. Removes it from every detected Claude config dir's settings.local.json
//     (production only; skipped in isolated mode, mirroring inject).
func removeQuantMCP() {
	// 1. Remove quant from the .mcp.json registry (isolated mode targets
	// $QUANT_HOME/.mcp.json, mirroring injectQuantMCP).
	mcpPath := paths.MCPConfigPath()
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

	// 2. Remove from every Claude config dir's settings.local.json.
	// Skip in isolated mode (we never wrote there) and honor the explicit gate.
	if paths.IsIsolated() || paths.SkipClaudeConfigDiscovery() {
		return
	}
	for _, dir := range discoverClaudeConfigDirs() {
		disableQuantInSettingsLocal(filepath.Join(dir, "settings.local.json"))
	}
}

// Run bootstraps and starts the Wails application with all dependencies wired.
func Run(assets embed.FS, changelogData []byte) error {
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

	injector := dependency.NewInjector(database, changelogData)
	sessionCtrl := injector.SessionController()
	repoCtrl := injector.RepoController()
	taskCtrl := injector.TaskController()
	actionCtrl := injector.ActionController()
	configCtrl := injector.ConfigController()
	jobCtrl := injector.JobController()
	agentCtrl := injector.AgentController()
	workspaceCtrl := injector.WorkspaceController()
	jobGroupCtrl := injector.JobGroupController()
	mindmapCtrl := injector.MindmapController()
	crewCtrl := injector.CrewController()
	crewManager := injector.CrewManager()
	fileCtrl := injector.FileController()
	changelogCtrl := injector.ChangelogController()
	updateCtrl := injector.UpdateController()
	// Voice bridge connects the MCP voice tools (Go) to the frontend audio
	// pipeline: a tool emits "voice:request" via remote.Emit (native webview +
	// remote browser clients) and blocks until VoiceResult resolves it. Shared
	// between the voice controller (which resolves) and the MCP server (which
	// requests).
	voiceBridge := voice.NewBridge(remote.Emit)
	voiceCtrl := voice.NewVoiceController(injector.ConfigManager(), voiceBridge, injector.SessionManager())
	processManager := injector.ProcessManager()

	// Start MCP server for external AI tools to manage jobs.
	mcpServer := quantmcp.NewQuantMCPServer(injector.JobManager(), injector.AgentManager(), injector.SessionManager(), injector.WorkspaceManager(), injector.RepoManager(), injector.JobGroupManager(), injector.MindmapManager(), injector.FileManager(), crewManager, injector.TaskManager(), voiceBridge)
	mcpPort := mcpServer.Port()
	fmt.Printf("[quant] MCP server on port %d → http://localhost:%d/mcp\n", mcpPort, mcpPort)
	if mcpPort != quantmcp.DefaultPort {
		fmt.Printf("[quant] Default port %d was busy, using %d instead\n", quantmcp.DefaultPort, mcpPort)
	}
	if err := mcpServer.Start(); err != nil {
		fmt.Printf("MCP server error: %v\n", err)
	}

	// Inject Quant MCP into Claude settings so sessions auto-discover it.
	// Skip injection when QUANT_SKIP_MCP_INJECT=1 (e.g. running a second instance for testing).
	if os.Getenv("QUANT_SKIP_MCP_INJECT") != "1" {
		injectQuantMCP(mcpPort)
	} else {
		fmt.Println("[quant] Skipping MCP injection (QUANT_SKIP_MCP_INJECT=1)")
	}

	// Start job scheduler for recurring/one-time scheduled jobs.
	jobScheduler := injector.JobScheduler()
	jobScheduler.Start()

	// Remote access: optional browser transport behind a Cloudflare quick tunnel.
	// Off by default; the same bound controllers are reused over HTTP/WS so the
	// React app runs unmodified in a browser via the injected window.go shim.
	assetsSub, _ := fs.Sub(assets, "frontend/dist")
	remoteControllers := map[string]interface{}{
		"sessionController":   sessionCtrl,
		"repoController":      repoCtrl,
		"taskController":      taskCtrl,
		"actionController":    actionCtrl,
		"configController":    configCtrl,
		"jobController":       jobCtrl,
		"agentController":     agentCtrl,
		"workspaceController": workspaceCtrl,
		"jobGroupController":  jobGroupCtrl,
		"mindmapController":   mindmapCtrl,
		"crewController":      crewCtrl,
		"fileController":      fileCtrl,
		"changelogController": changelogCtrl,
		"updateController":    updateCtrl,
		"voiceController":     voiceCtrl,
	}
	remoteManager := remote.NewManager(assetsSub, remoteControllers, injector.ConfigPersistence())
	remoteCtrl := controller.NewRemoteController(remoteManager)
	// remoteController is intentionally NOT added to remoteControllers: tunnel
	// control (enable/disable, passcode regen) must not be reachable through the
	// tunnel itself. It is bound to Wails below for the desktop UI only.

	err = wails.Run(&options.App{
		Title:  ">_ quant",
		Width:  1440,
		Height: 900,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 10, G: 10, B: 10, A: 1},
		// macOS only: merge the native title bar into the app's own top toolbar.
		// HiddenInset keeps the traffic-light buttons but removes the separate OS
		// title strip and the ">_ quant" title text, giving a single unified bar.
		// Windows/Linux are unaffected by Mac options.
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
		},
		OnStartup: func(ctx context.Context) {
			processManager.SetContext(ctx)
			injector.EventEmitter().SetContext(ctx)
			sessionCtrl.OnStartup(ctx)
			repoCtrl.OnStartup(ctx)
			taskCtrl.OnStartup(ctx)
			actionCtrl.OnStartup(ctx)
			configCtrl.OnStartup(ctx)
			jobCtrl.OnStartup(ctx)
			agentCtrl.OnStartup(ctx)
			workspaceCtrl.OnStartup(ctx)
			jobGroupCtrl.OnStartup(ctx)
			mindmapCtrl.OnStartup(ctx)
			crewCtrl.OnStartup(ctx)
			crewManager.Start()
			fileCtrl.OnStartup(ctx)
			changelogCtrl.OnStartup(ctx)
			updateCtrl.OnStartup(ctx)
			voiceCtrl.OnStartup(ctx)
			remoteCtrl.OnStartup(ctx)
			// Auto-resume remote access if it was enabled before the last shutdown.
			// Runs after controllers have their context set, since RPC dispatch
			// invokes those same controller methods.
			remoteManager.StartIfEnabled()
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
			mindmapCtrl.OnShutdown(ctx)
			crewManager.Stop()
			crewCtrl.OnShutdown(ctx)
			fileCtrl.OnShutdown(ctx)
			changelogCtrl.OnShutdown(ctx)
			updateCtrl.OnShutdown(ctx)
			voiceCtrl.OnShutdown(ctx)
			remoteCtrl.OnShutdown(ctx)
			remoteManager.Stop()
			jobScheduler.Stop()
			_ = mcpServer.Stop()
			if os.Getenv("QUANT_SKIP_MCP_INJECT") != "1" {
				removeQuantMCP()
			}
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
			mindmapCtrl,
			crewCtrl,
			fileCtrl,
			changelogCtrl,
			updateCtrl,
			voiceCtrl,
			remoteCtrl,
		},
	})
	if err != nil {
		return fmt.Errorf("failed to run application: %w", err)
	}

	return nil
}
