package e2e

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"

	mcpclient "github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"

	"quant/internal/domain/entity"
)

// initGitRepo makes a temp git repo with one commit so a worktree can be cut
// from it.
func initGitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, args := range [][]string{{"init"}, {"commit", "--allow-empty", "-m", "init"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@test.com",
			"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@test.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	return dir
}

// TestCreateSessionFollowsConfiguredDefaults verifies that a session created
// through the MCP without advanced options gets what the create-session modal
// would have given it: the configured worktree default, branch-name pattern,
// permission default, model and extra CLI args.
func TestCreateSessionFollowsConfiguredDefaults(t *testing.T) {
	h := newHarness(t)

	cfg, err := h.injector.ConfigPersistence().LoadConfig()
	if err != nil || cfg == nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	cfg.AutoPull = false // no remote in a temp repo
	cfg.UseWorktreeDefault = true
	cfg.BranchNamePattern = "wip/{session}"
	cfg.SkipPermissions = true
	cfg.DefaultModel = "claude-opus-4-6"
	cfg.ExtraCliArgs = "--verbose"
	if err := h.injector.ConfigPersistence().SaveConfig(cfg); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	repo, err := h.injector.RepoManager().OpenRepo("defaults", initGitRepo(t), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}

	created := h.call("create_session", map[string]any{
		"name":        "worker one",
		"sessionType": "claude",
		"repoId":      repo.ID,
		"taskTag":     "defaults",
	})

	if got := created["branchName"]; got != "wip/worker-one" {
		t.Errorf("branchName: got %v, want wip/worker-one — the configured pattern was ignored", got)
	}
	if created["worktreePath"] == "" {
		t.Error("expected a worktree, the configured default is on")
	}
	if got := created["model"]; got != "claude-opus-4-6" {
		t.Errorf("model: got %v, want the configured default", got)
	}

	id, _ := created["id"].(string)
	session, err := h.injector.SessionManager().GetSession(id)
	if err != nil || session == nil {
		t.Fatalf("GetSession: %v", err)
	}
	if !session.SkipPermissions {
		t.Error("skipPermissions: the configured default was ignored")
	}
	if session.ExtraCliArgs != "--verbose" {
		t.Errorf("extraCliArgs: got %q, want the configured %q", session.ExtraCliArgs, "--verbose")
	}
	if !strings.HasPrefix(session.Directory, session.WorktreePath) {
		t.Errorf("session should run in its worktree: directory %q, worktree %q", session.Directory, session.WorktreePath)
	}
}

// TestCreateSessionExplicitOptionsWinOverConfig verifies an agent that does pass
// an option is obeyed, so the defaults never override an explicit choice.
func TestCreateSessionExplicitOptionsWinOverConfig(t *testing.T) {
	h := newHarness(t)

	cfg, err := h.injector.ConfigPersistence().LoadConfig()
	if err != nil || cfg == nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	cfg.AutoPull = false
	cfg.UseWorktreeDefault = true
	cfg.SkipPermissions = true
	cfg.DefaultModel = "claude-opus-4-6"
	if err := h.injector.ConfigPersistence().SaveConfig(cfg); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	repo, err := h.injector.RepoManager().OpenRepo("explicit", initGitRepo(t), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}

	created := h.call("create_session", map[string]any{
		"name":            "plain",
		"sessionType":     "claude",
		"repoId":          repo.ID,
		"taskTag":         "explicit",
		"useWorktree":     false,
		"skipPermissions": false,
		"model":           "claude-haiku-4-5-20251001",
	})

	if got := created["worktreePath"]; got != "" {
		t.Errorf("useWorktree:false was overridden by the config default: %v", got)
	}
	if got := created["model"]; got != "claude-haiku-4-5-20251001" {
		t.Errorf("model: got %v, want the explicitly requested one", got)
	}
	id, _ := created["id"].(string)
	session, _ := h.injector.SessionManager().GetSession(id)
	if session == nil || session.SkipPermissions {
		t.Error("skipPermissions:false was overridden by the config default")
	}
}

// TestCreateSessionInheritsCallerWorkspace verifies a session created from
// inside another session lands in that session's workspace and picks up the
// workspace's own CLI command, instead of landing in workspace limbo with the
// plain "claude" binary.
func TestCreateSessionInheritsCallerWorkspace(t *testing.T) {
	h := newHarness(t)

	other, err := h.injector.WorkspaceManager().CreateWorkspace(entity.Workspace{Name: "aliased"})
	if err != nil {
		t.Fatalf("CreateWorkspace: %v", err)
	}
	other.CrewCliCommand = "claude-da"
	if _, err := h.injector.WorkspaceManager().UpdateWorkspace(*other); err != nil {
		t.Fatalf("UpdateWorkspace: %v", err)
	}

	cfg, err := h.injector.ConfigPersistence().LoadConfig()
	if err != nil || cfg == nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	cfg.AutoPull = false
	if err := h.injector.ConfigPersistence().SaveConfig(cfg); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	repo, err := h.injector.RepoManager().OpenRepo("aliased-repo", initGitRepo(t), other.ID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}
	task, err := h.injector.TaskManager().CreateTask(repo.ID, "alias", "alias")
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	caller, err := h.injector.SessionManager().CreateSession("caller", "", "claude", repo.ID, task.ID, entity.SessionOptions{
		WorkspaceID: other.ID,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	client, err := mcpclient.NewStreamableHttpClient(
		fmt.Sprintf("http://localhost:%d/mcp", h.server.Port()),
		transport.WithHTTPHeaders(map[string]string{
			"X-Quant-Session":       caller.ID,
			"X-Quant-Session-Token": caller.McpToken,
		}),
	)
	if err != nil {
		t.Fatalf("NewStreamableHttpClient: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })
	if err := client.Start(h.ctx); err != nil {
		t.Fatalf("client.Start: %v", err)
	}
	initReq := mcp.InitializeRequest{}
	initReq.Params.ProtocolVersion = mcp.LATEST_PROTOCOL_VERSION
	initReq.Params.ClientInfo = mcp.Implementation{Name: "quant-e2e-caller", Version: "1.0.0"}
	if _, err := client.Initialize(h.ctx, initReq); err != nil {
		t.Fatalf("client.Initialize: %v", err)
	}

	req := mcp.CallToolRequest{}
	req.Params.Name = "create_session"
	req.Params.Arguments = map[string]any{
		"name":        "spawned",
		"sessionType": "claude",
		"repoId":      repo.ID,
		"taskId":      task.ID,
	}
	res, err := client.CallTool(h.ctx, req)
	if err != nil {
		t.Fatalf("CallTool: %v", err)
	}
	if res.IsError {
		t.Fatalf("create_session failed: %s", firstText(t, res))
	}

	sessions, err := h.injector.SessionManager().ListSessionsByRepo(repo.ID)
	if err != nil {
		t.Fatalf("ListSessionsByRepo: %v", err)
	}
	var spawned *entity.Session
	for i := range sessions {
		if sessions[i].Name == "spawned" {
			spawned = &sessions[i]
		}
	}
	if spawned == nil {
		t.Fatal("the created session was not found")
	}
	if spawned.WorkspaceID != other.ID {
		t.Errorf("workspace: got %q, want the caller's %q", spawned.WorkspaceID, other.ID)
	}
	if spawned.CliCommand != "claude-da" {
		t.Errorf("cliCommand: got %q, want the workspace's %q", spawned.CliCommand, "claude-da")
	}
}
