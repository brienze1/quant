package e2e

import (
	"context"
	"fmt"
	"strings"
	"testing"

	mcpclient "github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"

	"quant/internal/domain/entity"
)

// otherWorkspaceSession creates a repo, task and session in a second workspace.
func otherWorkspaceSession(t *testing.T, h *harness, name string) *entity.Session {
	t.Helper()

	ws, err := h.injector.WorkspaceManager().CreateWorkspace(entity.Workspace{Name: "other-" + name})
	if err != nil {
		t.Fatalf("CreateWorkspace: %v", err)
	}
	repo, err := h.injector.RepoManager().OpenRepo("other-repo-"+name, t.TempDir(), ws.ID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}
	task, err := h.injector.TaskManager().CreateTask(repo.ID, "other", "other")
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	session, err := h.injector.SessionManager().CreateSession(name, "", "claude", repo.ID, task.ID, entity.SessionOptions{
		WorkspaceID: ws.ID,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return session
}

// TestSessionsAreLockedToTheirWorkspace verifies the workspace boundary: a
// session neither sees nor reaches sessions in another workspace, and the lock
// is not something the caller can widen with a workspaceId argument.
func TestSessionsAreLockedToTheirWorkspace(t *testing.T) {
	h := newHarness(t)

	repo, err := h.injector.RepoManager().OpenRepo("home-repo", t.TempDir(), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}
	task, err := h.injector.TaskManager().CreateTask(repo.ID, "home", "home")
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	mine, err := h.injector.SessionManager().CreateSession("mine", "", "claude", repo.ID, task.ID, entity.SessionOptions{
		WorkspaceID: h.wsID,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	foreign := otherWorkspaceSession(t, h, "foreign")
	client := newSessionClient(t, h, mine.ID)

	// list_sessions never shows a session from another workspace...
	rows := listSessionRows(t, client.callRaw("list_sessions", map[string]any{}, false))
	for _, row := range rows {
		if row["id"] == foreign.ID {
			t.Fatal("a session from another workspace was listed")
		}
	}

	// ...and asking for that workspace by id does not widen the view.
	rows = listSessionRows(t, client.callRaw("list_sessions", map[string]any{"workspaceId": foreign.WorkspaceID}, false))
	for _, row := range rows {
		if row["id"] == foreign.ID {
			t.Fatal("workspaceId let a session look into another workspace")
		}
	}

	// Every tool that reaches a session by id refuses across the boundary.
	for _, tc := range []struct {
		tool string
		args map[string]any
	}{
		{"send_message", map[string]any{"id": foreign.ID, "message": "hi"}},
		{"get_session", map[string]any{"id": foreign.ID}},
		{"get_session_output", map[string]any{"id": foreign.ID}},
		{"link_session", map[string]any{"sessionId": foreign.ID}},
		{"stop_session", map[string]any{"id": foreign.ID}},
		{"assign_session", map[string]any{"sessionId": foreign.ID}},
	} {
		errText := client.callRaw(tc.tool, tc.args, true)
		if !strings.Contains(errText, "another workspace") {
			t.Errorf("%s: expected a cross-workspace refusal, got: %s", tc.tool, errText)
		}
	}
}

// TestSessionIdAloneCannotImpersonate verifies that presenting another
// session's id without its token is refused — ids are public through
// list_sessions, so they are not proof of identity.
func TestSessionIdAloneCannotImpersonate(t *testing.T) {
	h := newHarness(t)

	repo, err := h.injector.RepoManager().OpenRepo("auth-repo", t.TempDir(), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}
	task, err := h.injector.TaskManager().CreateTask(repo.ID, "auth", "auth")
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	victim, err := h.injector.SessionManager().CreateSession("victim", "", "claude", repo.ID, task.ID, entity.SessionOptions{
		WorkspaceID: h.wsID,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if victim.McpToken == "" {
		t.Fatal("a new session should be given an mcp token")
	}

	// A client that claims the victim's id but holds no token is refused.
	ctx := context.Background()
	client, err := mcpclient.NewStreamableHttpClient(
		fmt.Sprintf("http://localhost:%d/mcp", h.server.Port()),
		transport.WithHTTPHeaders(map[string]string{"X-Quant-Session": victim.ID}),
	)
	if err != nil {
		t.Fatalf("NewStreamableHttpClient: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })
	if err := client.Start(ctx); err != nil {
		t.Fatalf("client.Start: %v", err)
	}
	initReq := mcp.InitializeRequest{}
	initReq.Params.ProtocolVersion = mcp.LATEST_PROTOCOL_VERSION
	initReq.Params.ClientInfo = mcp.Implementation{Name: "quant-e2e-impersonator", Version: "1.0.0"}
	if _, err := client.Initialize(ctx, initReq); err != nil {
		t.Fatalf("client.Initialize: %v", err)
	}

	req := mcp.CallToolRequest{}
	req.Params.Name = "link_session"
	req.Params.Arguments = map[string]any{"sessionId": victim.ID}
	res, err := client.CallTool(ctx, req)
	if err != nil {
		t.Fatalf("CallTool: %v", err)
	}
	if !res.IsError {
		t.Fatal("a request claiming a session id without its token should be refused")
	}
	text, _ := res.Content[0].(mcp.TextContent)
	if !strings.Contains(text.Text, "session token") {
		t.Errorf("expected an identity error, got: %s", text.Text)
	}
}
