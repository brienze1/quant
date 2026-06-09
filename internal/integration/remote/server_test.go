package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gorilla/websocket"
)

// fakeController exercises the reflection dispatcher across the return shapes
// the real controllers use: (T, error), (T), and error.
type fakeController struct{}

func (f *fakeController) Echo(s string) (string, error) { return s, nil }
func (f *fakeController) Add(a, b int) int              { return a + b }
func (f *fakeController) Boom() error                   { return errors.New("boom") }

// WithCtx mimics a lifecycle hook (OnStartup/OnShutdown) — it must NOT be
// remotely callable, since a client could inject a nil context.
func (f *fakeController) WithCtx(_ context.Context) error { return nil }

func newTestServer(t *testing.T) *server {
	t.Helper()
	auth := newAuthenticator("TEST-PASS-CODE")
	hub := NewEventHub()
	srv, err := newServer(0, fstest.MapFS{}, map[string]interface{}{"fakeController": &fakeController{}}, hub, auth)
	if err != nil {
		t.Fatalf("newServer: %v", err)
	}
	srv.start()
	t.Cleanup(func() { _ = srv.stop() })
	// Give the listener a moment to begin serving.
	time.Sleep(50 * time.Millisecond)
	return srv
}

func baseURL(s *server) string { return fmt.Sprintf("http://127.0.0.1:%d", s.port) }

func postRPC(t *testing.T, client *http.Client, base string, req rpcRequest) (*http.Response, rpcResponse) {
	t.Helper()
	body, _ := json.Marshal(req)
	resp, err := client.Post(base+rpcPath, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("rpc post: %v", err)
	}
	var out rpcResponse
	if resp.StatusCode == http.StatusOK {
		_ = json.NewDecoder(resp.Body).Decode(&out)
	}
	_ = resp.Body.Close()
	return resp, out
}

func arg(t *testing.T, v interface{}) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal arg: %v", err)
	}
	return b
}

func TestAuthAndRPCDispatch(t *testing.T) {
	srv := newTestServer(t)
	base := baseURL(srv)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{
		Jar:           jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}

	// 1. Unauthenticated RPC is rejected.
	if resp, _ := postRPC(t, client, base, rpcRequest{Struct: "fakeController", Method: "Echo", Args: []json.RawMessage{arg(t, "hi")}}); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 before auth, got %d", resp.StatusCode)
	}

	// 2. Wrong passcode is rejected.
	if resp, err := client.PostForm(base+authPath, url.Values{"passcode": {"WRONG"}}); err != nil {
		t.Fatalf("auth post: %v", err)
	} else if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong passcode, got %d", resp.StatusCode)
	}

	// 3. Correct passcode issues a session cookie.
	resp, err := client.PostForm(base+authPath, url.Values{"passcode": {"TEST-PASS-CODE"}})
	if err != nil {
		t.Fatalf("auth post: %v", err)
	}
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("expected 303 after correct passcode, got %d", resp.StatusCode)
	}
	u, _ := url.Parse(base)
	if len(jar.Cookies(u)) == 0 {
		t.Fatal("expected a session cookie after auth")
	}

	// 4. Authenticated RPC across the three return shapes.
	if _, out := postRPC(t, client, base, rpcRequest{Struct: "fakeController", Method: "Echo", Args: []json.RawMessage{arg(t, "hello")}}); out.Result != "hello" || out.Error != "" {
		t.Fatalf("Echo: got result=%v err=%q", out.Result, out.Error)
	}
	if _, out := postRPC(t, client, base, rpcRequest{Struct: "fakeController", Method: "Add", Args: []json.RawMessage{arg(t, 2), arg(t, 3)}}); out.Result != float64(5) {
		t.Fatalf("Add: expected 5, got %v", out.Result)
	}
	if _, out := postRPC(t, client, base, rpcRequest{Struct: "fakeController", Method: "Boom"}); out.Error != "boom" {
		t.Fatalf("Boom: expected error 'boom', got %q", out.Error)
	}

	// 5. Unknown method is reported, not panicked.
	if _, out := postRPC(t, client, base, rpcRequest{Struct: "fakeController", Method: "Nope"}); out.Error == "" {
		t.Fatal("expected error for unknown method")
	}

	// 6. Methods taking a context.Context are not remotely callable (no nil-ctx
	// injection of lifecycle hooks).
	if _, out := postRPC(t, client, base, rpcRequest{Struct: "fakeController", Method: "WithCtx", Args: []json.RawMessage{json.RawMessage("null")}}); out.Error == "" {
		t.Fatal("expected context-taking method to be rejected")
	}
}

func TestRateLimitLockout(t *testing.T) {
	srv := newTestServer(t)
	base := baseURL(srv)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	// Exhaust the failure budget, then confirm even the correct passcode is
	// locked out for the same client IP.
	for i := 0; i < maxAuthFailures; i++ {
		_, _ = client.PostForm(base+authPath, url.Values{"passcode": {"WRONG"}})
	}
	resp, err := client.PostForm(base+authPath, url.Values{"passcode": {"TEST-PASS-CODE"}})
	if err != nil {
		t.Fatalf("auth post: %v", err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected lockout (401) after %d failures, got %d", maxAuthFailures, resp.StatusCode)
	}
}

func TestWebSocketEventFanout(t *testing.T) {
	srv := newTestServer(t)
	base := baseURL(srv)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{
		Jar:           jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	if _, err := client.PostForm(base+authPath, url.Values{"passcode": {"TEST-PASS-CODE"}}); err != nil {
		t.Fatalf("auth: %v", err)
	}
	u, _ := url.Parse(base)
	var cookieParts []string
	for _, c := range jar.Cookies(u) {
		cookieParts = append(cookieParts, c.Name+"="+c.Value)
	}

	hdr := http.Header{"Cookie": {strings.Join(cookieParts, "; ")}}
	wsURL := "ws://127.0.0.1:" + fmt.Sprint(srv.port) + wsPath
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, hdr)
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	defer conn.Close()

	// Wait for the server to register the client, then publish.
	deadline := time.Now().Add(2 * time.Second)
	for srv.hub.ClientCount() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	srv.hub.Publish("session:output", map[string]string{"sessionId": "s1", "data": "hi"})

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("ws read: %v", err)
	}
	var msg eventMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("ws unmarshal: %v", err)
	}
	if msg.Event != "session:output" {
		t.Fatalf("expected session:output, got %q", msg.Event)
	}
}

func TestUnauthenticatedWebSocketRejected(t *testing.T) {
	srv := newTestServer(t)
	wsURL := "ws://127.0.0.1:" + fmt.Sprint(srv.port) + wsPath
	if _, _, err := websocket.DefaultDialer.Dial(wsURL, nil); err == nil {
		t.Fatal("expected ws upgrade to be rejected without auth")
	}
}

// TestAttachTokenAndPinnedWorkspace covers the loopback attach server used by
// detached windows: the X-Quant-Attach-Token header authenticates without the
// passcode, and the ?ws= query is injected as window.__quantPinnedWorkspace.
func TestAttachTokenAndPinnedWorkspace(t *testing.T) {
	const token = "test-attach-token-123"
	auth := newAttachAuthenticator(token)
	hub := NewEventHub()
	assets := fstest.MapFS{"index.html": {Data: []byte("<html><head></head><body></body></html>")}}
	srv, err := newServer(0, assets, map[string]interface{}{"fakeController": &fakeController{}}, hub, auth)
	if err != nil {
		t.Fatalf("newServer: %v", err)
	}
	srv.start()
	t.Cleanup(func() { _ = srv.stop() })
	time.Sleep(50 * time.Millisecond)
	base := baseURL(srv)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	// 1. Without the token, the index request is gated (serves the login page,
	// not the app index — so no shim/app leaks to an unauthenticated local hit).
	resp, err := client.Get(base + "/")
	if err != nil {
		t.Fatalf("get without token: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if strings.Contains(string(body), shimPath) {
		t.Fatal("unauthenticated index must not serve the app shim")
	}

	// 2. With the token + ?ws=, the app index is served with the shim AND the
	// pinned-workspace global injected.
	req, _ := http.NewRequest(http.MethodGet, base+"/?ws=team-frontend", nil)
	req.Header.Set(attachTokenHeader, token)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("get with token: %v", err)
	}
	body, _ = io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	html := string(body)
	if !strings.Contains(html, shimPath) {
		t.Fatal("authed index should contain the bridge shim")
	}
	if !strings.Contains(html, `window.__quantPinnedWorkspace="team-frontend"`) {
		t.Fatalf("authed index should pin the workspace, got: %s", html)
	}

	// 3. The token also authenticates RPC (no passcode cookie needed).
	bodyJSON, _ := json.Marshal(rpcRequest{Struct: "fakeController", Method: "Echo", Args: []json.RawMessage{arg(t, "hi")}})
	rpcReq, _ := http.NewRequest(http.MethodPost, base+rpcPath, bytes.NewReader(bodyJSON))
	rpcReq.Header.Set("Content-Type", "application/json")
	rpcReq.Header.Set(attachTokenHeader, token)
	rpcResp, err := client.Do(rpcReq)
	if err != nil {
		t.Fatalf("rpc with token: %v", err)
	}
	if rpcResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for token-authed rpc, got %d", rpcResp.StatusCode)
	}
	var out rpcResponse
	_ = json.NewDecoder(rpcResp.Body).Decode(&out)
	_ = rpcResp.Body.Close()
	if out.Result != "hi" || out.Error != "" {
		t.Fatalf("Echo via attach token: got result=%v err=%q", out.Result, out.Error)
	}

	// 4. A bogus token is still rejected.
	badReq, _ := http.NewRequest(http.MethodPost, base+rpcPath, bytes.NewReader(bodyJSON))
	badReq.Header.Set("Content-Type", "application/json")
	badReq.Header.Set(attachTokenHeader, "not-the-token")
	badResp, err := client.Do(badReq)
	if err != nil {
		t.Fatalf("rpc with bad token: %v", err)
	}
	_ = badResp.Body.Close()
	if badResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for bogus attach token, got %d", badResp.StatusCode)
	}
}

func TestGeneratePasscodeFormat(t *testing.T) {
	p := generatePasscode()
	if len(p) != 19 { // 16 chars + 3 dashes
		t.Fatalf("unexpected passcode length %d: %q", len(p), p)
	}
	if strings.Count(p, "-") != 3 {
		t.Fatalf("expected 3 group separators: %q", p)
	}
	if p == generatePasscode() {
		t.Fatal("passcodes should be random")
	}
}
