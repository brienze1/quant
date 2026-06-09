package infra

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

// runAttachedWindow runs a DETACHED workspace window as a thin client of a
// primary Quant process. It starts NO backend (no DB, MCP, injector, scheduler):
// its Wails asset server is a reverse proxy to the primary's loopback attach
// server (http://127.0.0.1:<port>), so the React app, its RPC calls
// (/__quant_remote/rpc) and its event stream (/__quant_remote/ws) all resolve to
// the primary's shared backend. The window is pinned to workspaceID via the ?ws=
// query the primary's serveIndex turns into window.__quantPinnedWorkspace.
//
// Entered from Run() when QUANT_ATTACH_PORT is set (see OpenWorkspaceWindow).
func runAttachedWindow(port, token, workspaceID string) error {
	target, err := url.Parse("http://127.0.0.1:" + port)
	if err != nil {
		return fmt.Errorf("invalid attach target: %w", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	baseDirector := proxy.Director
	proxy.Director = func(r *http.Request) {
		baseDirector(r)
		// Authenticate every proxied request (incl. the WebSocket upgrade) to the
		// loopback server. Header name mirrors remote.attachTokenHeader.
		r.Header.Set("X-Quant-Attach-Token", token)
		r.Host = target.Host
		// Pin the workspace. serveIndex only reads ?ws= when serving index.html, so
		// adding it to every request is harmless.
		if workspaceID != "" {
			q := r.URL.Query()
			if q.Get("ws") == "" {
				q.Set("ws", workspaceID)
				r.URL.RawQuery = q.Encode()
			}
		}
	}

	return wails.Run(&options.App{
		Title:  ">_ quant",
		Width:  1440,
		Height: 900,
		AssetServer: &assetserver.Options{
			// No embedded Assets: everything (UI, shim, RPC, WS) is proxied to the
			// primary so this window is a pure thin client of its backend.
			Handler: proxy,
		},
		BackgroundColour: &options.RGBA{R: 10, G: 10, B: 10, A: 1},
	})
}
