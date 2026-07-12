package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"sync"
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

// fakeSessionController records terminal input and resizes routed over the
// WebSocket, matching the real sessionController's method signatures.
type fakeSessionController struct {
	mu      sync.Mutex
	inputs  []string
	resizes [][2]int
}

func (f *fakeSessionController) SendMessage(id string, message string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.inputs = append(f.inputs, message)
	return nil
}

func (f *fakeSessionController) ResizeTerminal(id string, rows int, cols int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resizes = append(f.resizes, [2]int{rows, cols})
	return nil
}

func (f *fakeSessionController) snapshotInputs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.inputs...)
}

func (f *fakeSessionController) snapshotResizes() [][2]int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([][2]int(nil), f.resizes...)
}

func newTestServer(t *testing.T) (*server, *fakeSessionController) {
	t.Helper()
	auth := newAuthenticator("TEST-PASS-CODE")
	hub := NewEventHub()
	sessionCtrl := &fakeSessionController{}
	controllers := map[string]interface{}{
		"fakeController":    &fakeController{},
		"sessionController": sessionCtrl,
	}
	srv, err := newServer(0, fstest.MapFS{}, controllers, hub, auth)
	if err != nil {
		t.Fatalf("newServer: %v", err)
	}
	srv.start()
	t.Cleanup(func() { _ = srv.stop() })
	// Give the listener a moment to begin serving.
	time.Sleep(50 * time.Millisecond)
	return srv, sessionCtrl
}

// dialAuthedWS authenticates with the passcode and dials the event WebSocket
// with the resulting session cookie.
func dialAuthedWS(t *testing.T, srv *server) *websocket.Conn {
	t.Helper()
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
	t.Cleanup(func() { _ = conn.Close() })
	return conn
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
	srv, _ := newTestServer(t)
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
	srv, _ := newTestServer(t)
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

// waitForClient blocks until the hub registers a connected client.
func waitForClient(t *testing.T, srv *server) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for srv.hub.ClientCount() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if srv.hub.ClientCount() == 0 {
		t.Fatal("ws client never registered with hub")
	}
}

func TestWebSocketEventFanout(t *testing.T) {
	srv, _ := newTestServer(t)
	conn := dialAuthedWS(t, srv)

	// Wait for the server to register the client, then publish.
	waitForClient(t, srv)
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
	srv, _ := newTestServer(t)
	wsURL := "ws://127.0.0.1:" + fmt.Sprint(srv.port) + wsPath
	if _, _, err := websocket.DefaultDialer.Dial(wsURL, nil); err == nil {
		t.Fatal("expected ws upgrade to be rejected without auth")
	}
}

func TestWebSocketInput(t *testing.T) {
	srv, sessionCtrl := newTestServer(t)
	conn := dialAuthedWS(t, srv)

	const n = 50
	want := make([]string, 0, n)
	for i := 0; i < n; i++ {
		data := fmt.Sprintf("k%d", i)
		want = append(want, data)
		frame, _ := json.Marshal(map[string]string{"type": "input", "sessionId": "s1", "data": data})
		if err := conn.WriteMessage(websocket.TextMessage, frame); err != nil {
			t.Fatalf("ws write %d: %v", i, err)
		}
	}

	deadline := time.Now().Add(5 * time.Second)
	for len(sessionCtrl.snapshotInputs()) < n && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	got := sessionCtrl.snapshotInputs()
	if len(got) != n {
		t.Fatalf("expected %d inputs, got %d", n, len(got))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("input order broken at %d: expected %q, got %q", i, want[i], got[i])
		}
	}
}

func TestWebSocketResize(t *testing.T) {
	srv, sessionCtrl := newTestServer(t)
	conn := dialAuthedWS(t, srv)

	frame, _ := json.Marshal(map[string]interface{}{"type": "resize", "sessionId": "s1", "rows": 40, "cols": 120})
	if err := conn.WriteMessage(websocket.TextMessage, frame); err != nil {
		t.Fatalf("ws write: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	for len(sessionCtrl.snapshotResizes()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	got := sessionCtrl.snapshotResizes()
	if len(got) != 1 || got[0] != [2]int{40, 120} {
		t.Fatalf("expected one resize to 40x120, got %v", got)
	}
}

func TestWebSocketBadFrames(t *testing.T) {
	srv, sessionCtrl := newTestServer(t)
	conn := dialAuthedWS(t, srv)

	// Garbage JSON and unknown frame types are ignored without killing the
	// connection — a valid frame sent afterwards still lands.
	if err := conn.WriteMessage(websocket.TextMessage, []byte("{not json")); err != nil {
		t.Fatalf("ws write garbage: %v", err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"unknown","sessionId":"s1"}`)); err != nil {
		t.Fatalf("ws write unknown: %v", err)
	}
	frame, _ := json.Marshal(map[string]string{"type": "input", "sessionId": "s1", "data": "still-alive"})
	if err := conn.WriteMessage(websocket.TextMessage, frame); err != nil {
		t.Fatalf("ws write valid: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for len(sessionCtrl.snapshotInputs()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := sessionCtrl.snapshotInputs(); len(got) != 1 || got[0] != "still-alive" {
		t.Fatalf("expected [still-alive] after bad frames, got %v", got)
	}

	// A frame exceeding wsReadLimit closes the connection.
	huge, _ := json.Marshal(map[string]string{"type": "input", "sessionId": "s1", "data": strings.Repeat("x", wsReadLimit+1)})
	_ = conn.WriteMessage(websocket.TextMessage, huge)
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return // connection closed as expected
		}
	}
}

func TestHubMarksDroppedOnOverflow(t *testing.T) {
	hub := NewEventHub()
	c := &wsClient{send: make(chan eventMessage, 1)}
	hub.add(c)

	payload := map[string]string{"sessionId": "s1", "data": "chunk"}
	hub.Publish("session:output", payload) // fills the buffer
	hub.Publish("session:output", payload) // dropped -> marked

	if ids := c.takeDropped(); len(ids) != 1 || ids[0] != "s1" {
		t.Fatalf("expected dropped [s1], got %v", ids)
	}
	if ids := c.takeDropped(); ids != nil {
		t.Fatalf("expected nil after take, got %v", ids)
	}
}

func TestResyncEmittedAfterDrain(t *testing.T) {
	srv, _ := newTestServer(t)
	conn := dialAuthedWS(t, srv)
	waitForClient(t, srv)

	srv.hub.mu.RLock()
	var c *wsClient
	for cl := range srv.hub.clients {
		c = cl
	}
	srv.hub.mu.RUnlock()

	c.markDropped("s1")
	// Any published event drains through writePump, which then sees the marked
	// drop and follows up with the resync frame.
	srv.hub.Publish("session:state", map[string]string{"sessionId": "s1"})

	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("ws read (no resync seen): %v", err)
		}
		var msg eventMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			t.Fatalf("ws unmarshal: %v", err)
		}
		if msg.Event != "session:resync" {
			continue
		}
		data, ok := msg.Data.(map[string]interface{})
		if !ok {
			t.Fatalf("unexpected resync payload: %v", msg.Data)
		}
		ids, _ := data["sessionIds"].([]interface{})
		for _, id := range ids {
			if id == "s1" {
				return
			}
		}
		t.Fatalf("resync missing s1: %v", msg.Data)
	}
}

// jsonAuthToken performs the standalone-client auth flow (JSON body → JSON
// token) and returns the bearer token.
func jsonAuthToken(t *testing.T, base, passcode string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"passcode": passcode})
	req, _ := http.NewRequest(http.MethodPost, base+authPath, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Origin", "https://owner.github.io")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("json auth: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for json auth, got %d", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "https://owner.github.io" {
		t.Fatalf("expected reflected CORS origin, got %q", got)
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode token: %v", err)
	}
	if out.Token == "" {
		t.Fatal("expected a non-empty token")
	}
	return out.Token
}

func TestCrossOriginBearerFlow(t *testing.T) {
	srv, _ := newTestServer(t)
	base := baseURL(srv)

	// Wrong passcode over JSON → 401 JSON error, no token.
	badBody, _ := json.Marshal(map[string]string{"passcode": "WRONG"})
	badReq, _ := http.NewRequest(http.MethodPost, base+authPath, bytes.NewReader(badBody))
	badReq.Header.Set("Content-Type", "application/json")
	badResp, err := http.DefaultClient.Do(badReq)
	if err != nil {
		t.Fatalf("bad auth: %v", err)
	}
	badResp.Body.Close()
	if badResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong passcode, got %d", badResp.StatusCode)
	}

	token := jsonAuthToken(t, base, "TEST-PASS-CODE")

	// RPC with the bearer token (no cookie) succeeds.
	rpcBody, _ := json.Marshal(rpcRequest{Struct: "fakeController", Method: "Echo", Args: []json.RawMessage{arg(t, "yo")}})
	rpcReq, _ := http.NewRequest(http.MethodPost, base+rpcPath, bytes.NewReader(rpcBody))
	rpcReq.Header.Set("Content-Type", "application/json")
	rpcReq.Header.Set("Authorization", "Bearer "+token)
	rpcResp, err := http.DefaultClient.Do(rpcReq)
	if err != nil {
		t.Fatalf("bearer rpc: %v", err)
	}
	var out rpcResponse
	_ = json.NewDecoder(rpcResp.Body).Decode(&out)
	rpcResp.Body.Close()
	if out.Result != "yo" || out.Error != "" {
		t.Fatalf("bearer rpc: got result=%v err=%q", out.Result, out.Error)
	}

	// RPC without any credential is still rejected.
	noAuthReq, _ := http.NewRequest(http.MethodPost, base+rpcPath, bytes.NewReader(rpcBody))
	noAuthReq.Header.Set("Content-Type", "application/json")
	noAuthResp, _ := http.DefaultClient.Do(noAuthReq)
	if noAuthResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 without bearer, got %d", noAuthResp.StatusCode)
	}
	noAuthResp.Body.Close()

	// WS with ?token= (no cookie) upgrades successfully.
	wsURL := "ws://127.0.0.1:" + fmt.Sprint(srv.port) + wsPath + "?token=" + url.QueryEscape(token)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("ws dial with ?token=: %v", err)
	}
	_ = conn.Close()
}

func TestPreflightAndHealth(t *testing.T) {
	srv, _ := newTestServer(t)
	base := baseURL(srv)

	// OPTIONS preflight on /rpc returns 204 with CORS headers and no auth.
	preReq, _ := http.NewRequest(http.MethodOptions, base+rpcPath, nil)
	preReq.Header.Set("Origin", "https://owner.github.io")
	preResp, err := http.DefaultClient.Do(preReq)
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	preResp.Body.Close()
	if preResp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 for preflight, got %d", preResp.StatusCode)
	}
	if !strings.Contains(preResp.Header.Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Fatal("preflight missing Authorization in Allow-Headers")
	}

	// Health is reachable without auth and reports authed=false.
	hResp, err := http.Get(base + healthPath)
	if err != nil {
		t.Fatalf("health: %v", err)
	}
	var h struct {
		OK     bool `json:"ok"`
		Authed bool `json:"authed"`
	}
	_ = json.NewDecoder(hResp.Body).Decode(&h)
	hResp.Body.Close()
	if !h.OK || h.Authed {
		t.Fatalf("expected ok=true authed=false, got ok=%v authed=%v", h.OK, h.Authed)
	}

	// With a valid bearer, health reports authed=true.
	token := jsonAuthToken(t, base, "TEST-PASS-CODE")
	hReq, _ := http.NewRequest(http.MethodGet, base+healthPath, nil)
	hReq.Header.Set("Authorization", "Bearer "+token)
	hResp2, _ := http.DefaultClient.Do(hReq)
	var h2 struct {
		Authed bool `json:"authed"`
	}
	_ = json.NewDecoder(hResp2.Body).Decode(&h2)
	hResp2.Body.Close()
	if !h2.Authed {
		t.Fatal("expected authed=true with valid bearer")
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
