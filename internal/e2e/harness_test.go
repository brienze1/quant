// Package e2e contains end-to-end tests that boot the full Quant stack
// in-process and drive it through the real MCP streamable-HTTP server using
// the mark3labs/mcp-go client.
//
// SAFETY: every test isolates HOME to a t.TempDir() BEFORE the SQLite
// connection is opened, so the real ~/.quant DB, ~/.mcp.json and ~/.claude are
// never touched. Claude jobs use a fake `claude` script (never the real CLI).
package e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	mcpclient "github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/mcp"

	"quant/internal/infra/db"
	"quant/internal/infra/dependency"
	quantmcp "quant/internal/integration/mcp"
)

// harness wires the full stack and exposes an MCP client pointed at the real
// /mcp endpoint.
type harness struct {
	t         *testing.T
	home      string
	server    *quantmcp.QuantMCPServer
	client    *mcpclient.Client
	wsID      string
	ctx       context.Context
}

// newHarness boots the in-process stack with an isolated HOME and returns a
// ready-to-use MCP client. It registers cleanup to stop the server and client.
func newHarness(t *testing.T) *harness {
	t.Helper()

	// SAFETY RULE 1: isolate HOME before the DB connection derives its path.
	home := t.TempDir()
	t.Setenv("HOME", home)
	// SAFETY RULE 2: belt-and-suspenders (infra.Run is never called here).
	t.Setenv("QUANT_SKIP_MCP_INJECT", "1")
	t.Setenv("QUANT_SKIP_CLAUDE_CONFIG", "1")

	database, err := db.NewSQLiteConnection()
	if err != nil {
		t.Fatalf("NewSQLiteConnection: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	// Verify the DB really landed under the temp HOME, not the real home.
	dbPath := filepath.Join(home, ".quant", "quant.db")
	if _, statErr := os.Stat(dbPath); statErr != nil {
		t.Fatalf("expected DB at isolated HOME %s, but it is missing: %v", dbPath, statErr)
	}

	injector := dependency.NewInjector(database, nil)
	server := quantmcp.NewQuantMCPServer(
		injector.JobManager(),
		injector.AgentManager(),
		injector.SessionManager(),
		injector.WorkspaceManager(),
		injector.RepoManager(),
		injector.JobGroupManager(),
		injector.MindmapManager(),
		nil, // voice bridge — voice tools aren't exercised by these tests
	)
	if err := server.Start(); err != nil {
		t.Fatalf("server.Start: %v", err)
	}
	t.Cleanup(func() { _ = server.Stop() })

	ctx := context.Background()
	url := fmt.Sprintf("http://localhost:%d/mcp", server.Port())
	client, err := mcpclient.NewStreamableHttpClient(url)
	if err != nil {
		t.Fatalf("NewStreamableHttpClient: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	if err := client.Start(ctx); err != nil {
		t.Fatalf("client.Start: %v", err)
	}

	initReq := mcp.InitializeRequest{}
	initReq.Params.ProtocolVersion = mcp.LATEST_PROTOCOL_VERSION
	initReq.Params.ClientInfo = mcp.Implementation{Name: "quant-e2e", Version: "1.0.0"}
	if _, err := client.Initialize(ctx, initReq); err != nil {
		t.Fatalf("client.Initialize: %v", err)
	}

	h := &harness{t: t, home: home, server: server, client: client, ctx: ctx}

	// Every test runs against the always-present Default workspace.
	ws := h.call("get_current_workspace", nil)
	id, _ := ws["id"].(string)
	if id == "" {
		t.Fatalf("could not resolve current workspace id from %v", ws)
	}
	h.wsID = id

	return h
}

// call invokes an MCP tool and unmarshals the returned text content into a
// map[string]any. It fails the test if the tool returned an error result.
func (h *harness) call(tool string, args map[string]any) map[string]any {
	h.t.Helper()
	text := h.callRaw(tool, args, false)
	var m map[string]any
	if err := json.Unmarshal([]byte(text), &m); err != nil {
		h.t.Fatalf("tool %s: result is not a JSON object: %v\nraw: %s", tool, err, text)
	}
	return m
}

// callExpectError invokes a tool that is expected to fail and returns the error
// text. Fails the test if the tool unexpectedly succeeded.
func (h *harness) callExpectError(tool string, args map[string]any) string {
	h.t.Helper()
	return h.callRaw(tool, args, true)
}

// callRaw performs the actual CallTool and returns the first text content.
// When wantError is true it asserts IsError; otherwise it asserts no error.
func (h *harness) callRaw(tool string, args map[string]any, wantError bool) string {
	h.t.Helper()
	req := mcp.CallToolRequest{}
	req.Params.Name = tool
	if args != nil {
		req.Params.Arguments = args
	}
	res, err := h.client.CallTool(h.ctx, req)
	if err != nil {
		h.t.Fatalf("CallTool(%s) transport error: %v", tool, err)
	}
	text := firstText(h.t, res)
	if wantError && !res.IsError {
		h.t.Fatalf("tool %s expected an error result, got success: %s", tool, text)
	}
	if !wantError && res.IsError {
		h.t.Fatalf("tool %s returned error result: %s", tool, text)
	}
	return text
}

func firstText(t *testing.T, res *mcp.CallToolResult) string {
	t.Helper()
	if len(res.Content) == 0 {
		t.Fatalf("tool result had no content")
	}
	tc, ok := mcp.AsTextContent(res.Content[0])
	if !ok {
		t.Fatalf("tool result content[0] is not text: %T", res.Content[0])
	}
	return tc.Text
}

// pollRunTerminal polls get_run until the run reaches a terminal status or the
// timeout elapses. Returns the final run map.
func (h *harness) pollRunTerminal(runID string, timeout time.Duration) map[string]any {
	h.t.Helper()
	deadline := time.Now().Add(timeout)
	var last map[string]any
	for time.Now().Before(deadline) {
		last = h.call("get_run", map[string]any{"runId": runID})
		if isTerminal(last["status"]) {
			return last
		}
		time.Sleep(100 * time.Millisecond)
	}
	h.t.Fatalf("run %s did not reach terminal status within %v (last status: %v)", runID, timeout, last["status"])
	return nil
}

// pollCorrelationJob polls list_runs_by_correlation until a run for jobID
// reaches a terminal status, then returns its summary map. Useful for waiting
// on downstream cascade jobs whose run IDs are not known up front.
func (h *harness) pollCorrelationJob(correlationID, jobID string, timeout time.Duration) map[string]any {
	h.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		res := h.call("list_runs_by_correlation", map[string]any{"correlationId": correlationID})
		runs, _ := res["runs"].([]any)
		for _, r := range runs {
			rm, _ := r.(map[string]any)
			if rm == nil {
				continue
			}
			if rm["jobId"] == jobID && isTerminal(rm["status"]) {
				return rm
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	h.t.Fatalf("no terminal run for job %s under correlation %s within %v", jobID, correlationID, timeout)
	return nil
}

func isTerminal(status any) bool {
	switch status {
	case "success", "failed", "waiting", "cancelled", "timed_out":
		return true
	}
	return false
}

// writeFakeClaude writes an executable fake `claude` script into dir and
// returns its absolute path. The script handles both invocation modes:
//
//   - TASK mode (args contain "stream-json"): increments a per-job counter
//     file, appends the prompt (stdin) to attempt-<n>.prompt, then emits
//     stream-json. The emitted <quant-output> block depends on `mode`:
//       "selfcorrect" -> attempt 1 violates the contract (missing prUrl),
//                        attempt 2 satisfies it.
//       "alwaysbad"   -> every attempt violates the contract.
//   - EVAL mode (no "stream-json"): prints {"result":"success","metadata":{}}.
//
// stateDir is where the counter + prompt files live (pass a unique dir per job
// via the job's workingDirectory so parallel/sequential jobs don't collide).
func writeFakeClaude(t *testing.T, dir, mode, validValue string) string {
	t.Helper()
	path := filepath.Join(dir, "fake-claude.sh")
	script := fmt.Sprintf(`#!/bin/bash
set -e
STATE_DIR="${QUANT_FAKE_STATE_DIR:-$PWD}"
mkdir -p "$STATE_DIR"

is_task=0
for a in "$@"; do
  if [ "$a" = "stream-json" ]; then is_task=1; fi
done

if [ "$is_task" = "0" ]; then
  # EVAL mode: plain -p call, raw JSON object reply.
  printf '%%s\n' '{"result":"success","metadata":{}}'
  exit 0
fi

# TASK mode: count invocations and capture the prompt per attempt.
COUNT_FILE="$STATE_DIR/task_count"
n=0
if [ -f "$COUNT_FILE" ]; then n=$(cat "$COUNT_FILE"); fi
n=$((n+1))
printf '%%s' "$n" > "$COUNT_FILE"
cat > "$STATE_DIR/attempt-$n.prompt"

MODE=%q
VALID=%q

emit() {
  # $1 = the <quant-output> JSON body (with raw double quotes).
  # Build the assistant 'text' value, then escape it exactly ONCE so the
  # whole stream-json line is valid JSON while the extracted text still
  # contains a clean <quant-output>{...}</quant-output> block.
  local text="working...
<quant-output>$1</quant-output>"
  local t=${text//\\/\\\\}
  t=${t//\"/\\\"}
  t=${t//$'\n'/\\n}
  printf '%%s\n' "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"${t}\"}]}}"
  printf '%%s\n' "{\"type\":\"result\",\"usage\":{\"input_tokens\":10,\"output_tokens\":5},\"session_id\":\"fake-sess\",\"model\":\"fake-model\",\"result\":\"done\"}"
}

case "$MODE" in
  selfcorrect)
    if [ "$n" = "1" ]; then
      # Contract violation: omit the required produced key prUrl.
      emit "{\"somethingElse\":\"nope\"}"
    else
      emit "{\"prUrl\":\"$VALID\"}"
    fi
    ;;
  alwaysbad)
    # Always violate: prUrl present but wrong type (number, not string).
    emit "{\"prUrl\":123}"
    ;;
  *)
    emit "{\"prUrl\":\"$VALID\"}"
    ;;
esac
exit 0
`, mode, validValue)

	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake claude: %v", err)
	}
	return path
}

// specJSON marshals input/output specs to the JSON string the MCP tools expect.
func specJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal spec: %v", err)
	}
	return string(b)
}

// jsonStr marshals an arbitrary value to a JSON string (for the inputs arg).
func jsonStr(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}
