package e2e

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	mcpclient "github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"

	"quant/internal/infra/db"
	"quant/internal/infra/dependency"
	quantmcp "quant/internal/integration/mcp"
	"quant/internal/integration/voice"
)

// TestVoiceToolsRoundTrip drives the MCP voice tools end-to-end over the real
// streamable-HTTP server. It mirrors the session_submit harness pattern but
// uses a custom MCP server whose bridge emitter acts as the "frontend": on each
// emitted voice:request it immediately calls bridge.Resolve, simulating the
// webview audio pipeline reporting back. It then asserts:
//   - voice_listen returns the transcript the fake frontend produced
//   - voice_speak acks with "spoken" after playback completes
//   - voice_converse returns the user's transcript (speak-then-listen)
//   - the X-Quant-Session header is threaded through as the session scope
func TestVoiceToolsRoundTrip(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("QUANT_SKIP_MCP_INJECT", "1")
	t.Setenv("QUANT_SKIP_CLAUDE_CONFIG", "1")

	database, err := db.NewSQLiteConnection()
	if err != nil {
		t.Fatalf("NewSQLiteConnection: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	injector := dependency.NewInjector(database, nil)

	const wantTranscript = "forty two"
	var gotSession string

	// The bridge emitter plays the role of the frontend: as soon as a
	// voice:request is emitted, capture the session and resolve the request.
	// listen → return a transcript; speak → report playback done.
	var bridge *voice.Bridge
	bridge = voice.NewBridge(func(_ context.Context, event string, data interface{}) {
		if event != "voice:request" {
			return
		}
		ev, ok := data.(voice.VoiceRequestEvent)
		if !ok {
			t.Errorf("voice:request payload not VoiceRequestEvent: %T", data)
			return
		}
		gotSession = ev.SessionID
		// Resolve from a goroutine to mimic the async frontend without blocking
		// the emit call.
		go func() {
			reply := voice.VoiceReply{Done: true}
			if ev.Kind == "listen" {
				reply.Transcript = wantTranscript
			}
			bridge.Resolve(ev.RequestID, reply)
		}()
	})

	server := quantmcp.NewQuantMCPServer(
		injector.JobManager(),
		injector.AgentManager(),
		injector.SessionManager(),
		injector.WorkspaceManager(),
		injector.RepoManager(),
		injector.JobGroupManager(),
		injector.MindmapManager(),
		bridge,
	)
	if err := server.Start(); err != nil {
		t.Fatalf("server.Start: %v", err)
	}
	t.Cleanup(func() { _ = server.Stop() })

	ctx := context.Background()
	url := fmt.Sprintf("http://localhost:%d/mcp", server.Port())

	const sessionID = "voice-sess-1"
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
	initReq.Params.ClientInfo = mcp.Implementation{Name: "quant-voice-e2e", Version: "1.0.0"}
	if _, err := client.Initialize(ctx, initReq); err != nil {
		t.Fatalf("client.Initialize: %v", err)
	}

	callText := func(tool string, args map[string]any) string {
		req := mcp.CallToolRequest{}
		req.Params.Name = tool
		if args != nil {
			req.Params.Arguments = args
		}
		cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		res, err := client.CallTool(cctx, req)
		if err != nil {
			t.Fatalf("CallTool(%s): %v", tool, err)
		}
		txt := firstText(t, res)
		if res.IsError {
			t.Fatalf("tool %s returned error: %s", tool, txt)
		}
		return txt
	}

	t.Run("voice_listen returns the frontend transcript", func(t *testing.T) {
		// The result wraps the transcript with a standing "keep conversing"
		// reminder, so assert it CONTAINS the transcript rather than equals it.
		got := callText("voice_listen", nil)
		if !strings.Contains(got, wantTranscript) {
			t.Fatalf("voice_listen = %q, want it to contain %q", got, wantTranscript)
		}
		if !strings.Contains(got, "voice_converse") {
			t.Fatalf("voice_listen result %q missing the continue-conversation nudge", got)
		}
		if gotSession != sessionID {
			t.Fatalf("session scope = %q, want %q (X-Quant-Session not threaded)", gotSession, sessionID)
		}
	})

	t.Run("voice_speak acks", func(t *testing.T) {
		got := callText("voice_speak", map[string]any{"text": "hello there"})
		if got != "spoken" {
			t.Fatalf("voice_speak = %q, want %q", got, "spoken")
		}
	})

	t.Run("voice_converse returns the reply transcript", func(t *testing.T) {
		got := callText("voice_converse", map[string]any{"text": "what is six times seven"})
		if !strings.Contains(got, wantTranscript) {
			t.Fatalf("voice_converse = %q, want it to contain %q", got, wantTranscript)
		}
		if !strings.Contains(got, "voice_converse") {
			t.Fatalf("voice_converse result %q missing the continue-conversation nudge", got)
		}
	})
}
