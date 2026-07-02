package e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	mcpclient "github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"
)

// writeFakeInteractiveClaude writes a fake interactive `claude` CLI: it prints
// a ready banner and then echoes stdin lines forever. Configured as the CLI
// binary so claude-type sessions can spawn without the real CLI.
func writeFakeInteractiveClaude(t *testing.T, dir string) string {
	t.Helper()
	path := filepath.Join(dir, "fake-claude-interactive.sh")
	script := `#!/bin/bash
echo "FAKE-CLAUDE-READY"
while IFS= read -r line; do
  echo "got: $line"
done
`
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake interactive claude: %v", err)
	}
	return path
}

// sessionClient is an MCP client whose requests carry the X-Quant-Session
// header, so the server treats them as coming from inside that session.
type sessionClient struct {
	t      *testing.T
	ctx    context.Context
	client *mcpclient.Client
}

func newSessionClient(t *testing.T, h *harness, sessionID string) *sessionClient {
	t.Helper()

	ctx := context.Background()
	url := fmt.Sprintf("http://localhost:%d/mcp", h.server.Port())
	client, err := mcpclient.NewStreamableHttpClient(url,
		transport.WithHTTPHeaders(map[string]string{"X-Quant-Session": sessionID}),
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
	initReq.Params.ClientInfo = mcp.Implementation{Name: "quant-e2e-session", Version: "1.0.0"}
	if _, err := client.Initialize(ctx, initReq); err != nil {
		t.Fatalf("client.Initialize: %v", err)
	}

	return &sessionClient{t: t, ctx: ctx, client: client}
}

func (c *sessionClient) call(tool string, args map[string]any) map[string]any {
	c.t.Helper()
	text := c.callRaw(tool, args, false)
	var m map[string]any
	if err := json.Unmarshal([]byte(text), &m); err != nil {
		c.t.Fatalf("tool %s: result is not a JSON object: %v\nraw: %s", tool, err, text)
	}
	return m
}

func (c *sessionClient) callRaw(tool string, args map[string]any, wantError bool) string {
	c.t.Helper()
	req := mcp.CallToolRequest{}
	req.Params.Name = tool
	if args != nil {
		req.Params.Arguments = args
	}
	res, err := c.client.CallTool(c.ctx, req)
	if err != nil {
		c.t.Fatalf("CallTool(%s) transport error: %v", tool, err)
	}
	text := firstText(c.t, res)
	if wantError && !res.IsError {
		c.t.Fatalf("tool %s expected an error result, got success: %s", tool, text)
	}
	if !wantError && res.IsError {
		c.t.Fatalf("tool %s returned error result: %s", tool, text)
	}
	return text
}

// waitForSessionOutput polls get_session_output until it contains want or the
// timeout elapses. Returns the last output and whether want was found.
func waitForSessionOutput(h *harness, sessionID, want string, timeout time.Duration) (string, bool) {
	deadline := time.Now().Add(timeout)
	var last string
	for time.Now().Before(deadline) {
		last = h.callRaw("get_session_output", map[string]any{"id": sessionID, "lines": float64(0)}, false)
		if strings.Contains(last, want) {
			return last, true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return last, false
}

// TestCrewDispatch drives crew_dispatch end-to-end with a fake interactive
// claude CLI: a new worker is created in the repo, assigned under the calling
// supervisor, started, and receives the prompt plus the reporting contract in
// its terminal. A second dispatch with the same name adopts the same worker.
func TestCrewDispatch(t *testing.T) {
	t.Setenv("SHELL", "/bin/bash")
	h := newHarness(t)
	h.injector.ProcessManager().UpdateCliBinaryConfig(writeFakeInteractiveClaude(t, t.TempDir()), nil)

	repo, err := h.injector.RepoManager().OpenRepo("crew-repo", t.TempDir(), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}

	boss := h.call("create_session", map[string]any{
		"name":        "boss",
		"sessionType": "claude",
		"repoId":      repo.ID,
	})
	bossID, _ := boss["id"].(string)
	if bossID == "" {
		t.Fatalf("create_session returned no id: %v", boss)
	}

	// Headerless dispatch is rejected with a clear error.
	errText := h.callExpectError("crew_dispatch", map[string]any{"prompt": "x", "sessionId": bossID})
	if !strings.Contains(errText, "X-Quant-Session") {
		t.Fatalf("headerless dispatch error should mention the session header, got: %s", errText)
	}

	bossClient := newSessionClient(t, h, bossID)

	res := bossClient.call("crew_dispatch", map[string]any{
		"prompt":            "BUILD-THE-WIDGET",
		"name":              "worker-1",
		"repoId":            repo.ID,
		"expectedByMinutes": float64(5),
	})
	workerID, _ := res["workerSessionId"].(string)
	if workerID == "" || res["created"] != true || res["started"] != true {
		t.Fatalf("unexpected dispatch result: %v", res)
	}
	if res["promptDelivered"] != true || res["watchdogSet"] != true {
		t.Fatalf("prompt/watchdog not delivered: %v", res)
	}
	if res["workerName"] != "worker-1" {
		t.Fatalf("unexpected worker name: %v", res)
	}

	// The worker terminal received the prompt and the reporting contract.
	out, ok := waitForSessionOutput(h, workerID, "report_to_supervisor", 8*time.Second)
	if !ok {
		t.Fatalf("contract sentinel not found in worker output:\n%s", out)
	}
	if !strings.Contains(out, "BUILD-THE-WIDGET") {
		t.Fatalf("prompt not found in worker output:\n%s", out)
	}

	// The worker is assigned under the supervisor.
	crew := bossClient.call("list_crew", nil)
	workers, _ := crew["workers"].([]any)
	if len(workers) != 1 {
		t.Fatalf("expected 1 crew worker, got: %v", crew)
	}

	// Dispatching the same name again adopts the existing worker.
	res2 := bossClient.call("crew_dispatch", map[string]any{
		"prompt": "SECOND-TASK",
		"name":   "worker-1",
		"repoId": repo.ID,
	})
	if res2["created"] != false || res2["adoptedBy"] != "name" || res2["workerSessionId"] != workerID {
		t.Fatalf("second dispatch should adopt the same worker: %v", res2)
	}
	if res2["started"] != false {
		t.Fatalf("live worker should not be restarted: %v", res2)
	}

	// crew_set_watchdog works for a worker in the caller's crew and rejects others.
	wd := bossClient.call("crew_set_watchdog", map[string]any{"sessionId": workerID, "expectedByMinutes": float64(3)})
	if wd["watchdogSet"] != true {
		t.Fatalf("crew_set_watchdog failed: %v", wd)
	}
	errText = bossClient.callRaw("crew_set_watchdog", map[string]any{"sessionId": bossID, "expectedByMinutes": float64(3)}, true)
	if !strings.Contains(errText, "not in your crew") {
		t.Fatalf("watchdog on a non-worker should name the crew rule, got: %s", errText)
	}
}

// TestCrewSendMessageScoping exercises the crew scoping matrix for
// send_message: headerless callers are unrestricted; a supervisor with workers
// is blocked outside its crew unless outsideCrew:true; its own supervisor and
// workers stay reachable; a leaf worker without workers is unrestricted.
func TestCrewSendMessageScoping(t *testing.T) {
	t.Setenv("SHELL", "/bin/bash")
	h := newHarness(t)
	h.injector.ProcessManager().UpdateCliBinaryConfig(writeFakeInteractiveClaude(t, t.TempDir()), nil)

	mkClaude := func(name string) string {
		created := h.call("create_session", map[string]any{"name": name, "sessionType": "claude"})
		id, _ := created["id"].(string)
		if id == "" {
			t.Fatalf("create_session %s returned no id: %v", name, created)
		}
		return id
	}
	rootID := mkClaude("root")
	midID := mkClaude("mid")
	leafID := mkClaude("leaf")

	outsider := h.call("create_session", map[string]any{"name": "outsider", "sessionType": "terminal"})
	outsiderID, _ := outsider["id"].(string)

	for _, id := range []string{rootID, leafID, outsiderID} {
		h.callRaw("start_session", map[string]any{"id": id}, false)
	}
	time.Sleep(700 * time.Millisecond)

	// Crew tree: root supervises mid; mid supervises leaf.
	h.call("assign_session", map[string]any{"sessionId": midID, "supervisorSessionId": rootID})
	h.call("assign_session", map[string]any{"sessionId": leafID, "supervisorSessionId": midID})

	// Headerless callers are unrestricted.
	h.callRaw("send_message", map[string]any{"id": outsiderID, "message": "headerless ok", "submit": false}, false)

	midClient := newSessionClient(t, h, midID)

	// A caller with workers is blocked outside its crew, with the bypass named.
	errText := midClient.callRaw("send_message", map[string]any{"id": outsiderID, "message": "blocked"}, true)
	if !strings.Contains(errText, outsiderID) || !strings.Contains(errText, "outsideCrew") {
		t.Fatalf("scoping error should name the target and the bypass, got: %s", errText)
	}

	// outsideCrew:true bypasses the scoping.
	midClient.callRaw("send_message", map[string]any{"id": outsiderID, "message": "bypass ok", "submit": false, "outsideCrew": true}, false)

	// Its own supervisor and its own worker remain reachable.
	midClient.callRaw("send_message", map[string]any{"id": rootID, "message": "hello supervisor", "submit": false}, false)
	midClient.callRaw("send_message", map[string]any{"id": leafID, "message": "hello worker", "submit": false}, false)

	// A worker without workers of its own is unrestricted.
	leafClient := newSessionClient(t, h, leafID)
	leafClient.callRaw("send_message", map[string]any{"id": outsiderID, "message": "leaf ok", "submit": false}, false)
}
