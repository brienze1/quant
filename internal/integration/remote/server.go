package remote

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

//go:embed assets/shim.js
var shimFS embed.FS

const (
	basePath = "/__quant_remote"
	shimPath = basePath + "/shim.js"
	authPath = basePath + "/auth"
	rpcPath  = basePath + "/rpc"
	wsPath   = basePath + "/ws"
	shimTag  = `<script src="` + shimPath + `"></script>`
)

// server is the localhost HTTP/WebSocket server that serves the embedded UI
// (with the bridge shim injected) and proxies RPC + events. It is bound to
// 127.0.0.1 only — the Cloudflare tunnel is the sole external path in.
type server struct {
	assets     fs.FS // root of frontend/dist
	fileServer http.Handler
	dispatcher *dispatcher
	auth       *authenticator
	hub        *EventHub
	httpServer *http.Server
	listener   net.Listener
	port       int
	upgrader   websocket.Upgrader
}

func newServer(port int, assets fs.FS, controllers map[string]interface{}, hub *EventHub, auth *authenticator) (*server, error) {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return nil, err
	}
	s := &server{
		assets:     assets,
		fileServer: http.FileServer(http.FS(assets)),
		dispatcher: newDispatcher(controllers),
		auth:       auth,
		hub:        hub,
		listener:   ln,
		port:       ln.Addr().(*net.TCPAddr).Port,
		upgrader: websocket.Upgrader{
			// The auth gate is the passcode-derived session cookie, not the
			// browser origin (which is the trycloudflare host, not localhost).
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
	s.httpServer = &http.Server{Handler: s.routes()}
	return s, nil
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(shimPath, s.handleShim)
	mux.HandleFunc(authPath, s.handleAuth)
	mux.HandleFunc(rpcPath, s.requireAuth(s.handleRPC))
	mux.HandleFunc(wsPath, s.handleWS)
	mux.HandleFunc("/", s.handleAssets)
	return mux
}

func (s *server) start() { go s.httpServer.Serve(s.listener) }
func (s *server) stop() error {
	// http.Server.Shutdown does not close hijacked WebSocket connections, so
	// close them explicitly — otherwise readPump/writePump goroutines (and the
	// hub entries) leak across Disable/Enable cycles.
	s.hub.closeAll()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return s.httpServer.Shutdown(ctx)
}

func (s *server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.auth.authedRequest(r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// handleAssets serves the SPA: the login page when unauthenticated, otherwise
// index.html (with the shim injected) for "/" and unknown routes, and real
// static files for everything else.
func (s *server) handleAssets(w http.ResponseWriter, r *http.Request) {
	if !s.auth.authedRequest(r) {
		s.serveLogin(w, "", http.StatusOK)
		return
	}
	upath := strings.TrimPrefix(r.URL.Path, "/")
	if upath == "" || upath == "index.html" {
		s.serveIndex(w, r)
		return
	}
	if st, err := fs.Stat(s.assets, upath); err == nil && !st.IsDir() {
		s.fileServer.ServeHTTP(w, r)
		return
	}
	s.serveIndex(w, r) // SPA fallback
}

// serveIndex serves index.html with the bridge shim injected as the first
// script in <head> so window.go / window.runtime exist before the app's
// deferred module scripts run. When the request carries a `ws` query param (set
// by a detached/attached window's reverse proxy), a tiny script pinning the
// window to that workspace is injected alongside the shim.
func (s *server) serveIndex(w http.ResponseWriter, r *http.Request) {
	data, err := fs.ReadFile(s.assets, "index.html")
	if err != nil {
		http.Error(w, "index.html not found", http.StatusInternalServerError)
		return
	}
	head := shimTag
	if ws := r.URL.Query().Get("ws"); ws != "" {
		// JSON-encode so an arbitrary workspace id can't break out of the string
		// literal. The app reads window.__quantPinnedWorkspace on boot to lock the
		// window to this workspace and hide the workspace switcher.
		if b, mErr := json.Marshal(ws); mErr == nil {
			head = `<script>window.__quantPinnedWorkspace=` + string(b) + `;</script>` + head
		}
	}
	html := string(data)
	if i := strings.Index(html, "<head>"); i >= 0 {
		html = html[:i+len("<head>")] + head + html[i+len("<head>"):]
	} else {
		html = head + html
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(html))
}

func (s *server) handleShim(w http.ResponseWriter, r *http.Request) {
	data, err := shimFS.ReadFile("assets/shim.js")
	if err != nil {
		http.Error(w, "shim not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	_, _ = w.Write(data)
}

func (s *server) handleAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_ = r.ParseForm()
	ok, msg := s.auth.checkPasscode(r, r.FormValue("passcode"))
	if !ok {
		s.serveLogin(w, msg, http.StatusUnauthorized)
		return
	}
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(w, s.auth.issueCookie(secure))
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *server) handleRPC(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req rpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, rpcResponse{Error: "bad request: " + err.Error()})
		return
	}
	writeJSON(w, s.safeDispatch(req))
}

// safeDispatch recovers from panics in controller methods so a single bad call
// can't take down the remote server.
func (s *server) safeDispatch(req rpcRequest) (resp rpcResponse) {
	defer func() {
		if rec := recover(); rec != nil {
			resp = rpcResponse{Error: fmt.Sprintf("panic: %v", rec)}
		}
	}()
	return s.dispatcher.dispatch(req)
}

func (s *server) handleWS(w http.ResponseWriter, r *http.Request) {
	if !s.auth.authedRequest(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &wsClient{conn: conn, send: make(chan eventMessage, 256)}
	s.hub.add(c)
	go s.writePump(c)
	s.readPump(c)
}

func (s *server) readPump(c *wsClient) {
	defer func() {
		s.hub.remove(c)
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(512)
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (s *server) writePump(c *wsClient) {
	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteJSON(msg); err != nil {
				// Close so readPump unblocks and deregisters this client.
				_ = c.conn.Close()
				return
			}
		case <-ping.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				_ = c.conn.Close()
				return
			}
		}
	}
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (s *server) serveLogin(w http.ResponseWriter, errMsg string, status int) {
	errBlock := ""
	if errMsg != "" {
		errBlock = `<p class="err">` + htmlEscape(errMsg) + `</p>`
	}
	html := strings.NewReplacer("{{ACTION}}", authPath, "{{ERROR}}", errBlock).Replace(loginHTML)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(html))
}

func htmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
	return r.Replace(s)
}

// loginHTML matches the QUANT_DARK theme tokens (bg #0A0A0A, input #0F0F0F,
// border #2a2a2a, fg #FAFAFA, secondary #6B7280, accent #10B981, error #EF4444)
// and the JetBrains Mono / lowercase terminal aesthetic of the app.
const loginHTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>quant — remote access</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0A0A0A; color:#FAFAFA;
         font-family:"JetBrains Mono",ui-monospace,Menlo,monospace; }
  form { width:340px; padding:28px; border:1px solid #2a2a2a; background:#0D0D0D; }
  h1 { margin:0 0 6px; font-size:18px; font-weight:600; color:#10B981; letter-spacing:0.5px; }
  p.sub { margin:0 0 22px; font-size:11px; line-height:1.5; color:#6B7280; }
  label { display:block; font-size:10px; text-transform:uppercase; letter-spacing:1px;
          color:#6B7280; margin:0 0 6px; }
  input { width:100%; padding:11px 12px; font:inherit; font-size:13px; letter-spacing:2px;
          background:#0F0F0F; border:1px solid #2a2a2a; color:#FAFAFA; }
  input::placeholder { color:#4B5563; letter-spacing:1px; }
  input:focus { outline:none; border-color:#10B981; }
  button { width:100%; margin-top:16px; padding:11px; font:inherit; font-size:12px; font-weight:600;
           cursor:pointer; background:#10B981; color:#0A0A0A; border:none; }
  button:hover { background:#059669; }
  p.err { color:#F87171; font-size:11px; margin:14px 0 0; }
</style></head>
<body>
  <form method="post" action="{{ACTION}}">
    <h1>&gt;_ quant</h1>
    <p class="sub">// enter the passcode to access this quant remotely</p>
    <label for="passcode">passcode</label>
    <input id="passcode" name="passcode" type="password" autocomplete="off" autofocus placeholder="xxxx-xxxx-xxxx-xxxx" />
    <button type="submit">unlock</button>
    {{ERROR}}
  </form>
</body></html>`
