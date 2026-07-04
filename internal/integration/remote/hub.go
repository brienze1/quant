// Package remote exposes quant's UI to a browser over an authenticated HTTP +
// WebSocket transport, fronted by a Cloudflare quick tunnel. It mirrors the
// Wails native bridge (window.go / window.runtime) so the React app runs
// unmodified in a plain browser. Off by default; see Manager.
package remote

import (
	"context"
	"sync"
	"sync/atomic"

	"github.com/gorilla/websocket"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// eventMessage is the JSON envelope pushed to browser clients over the WebSocket.
type eventMessage struct {
	Event string      `json:"event"`
	Data  interface{} `json:"data"`
}

// wsClient is a single connected browser receiving mirrored events.
type wsClient struct {
	conn *websocket.Conn
	send chan eventMessage

	mu              sync.Mutex
	droppedSessions map[string]struct{} // sessions with output dropped by Publish, pending resync
}

// markDropped records that a session:output event for sessionID was dropped
// because this client's send buffer was full.
func (c *wsClient) markDropped(sessionID string) {
	c.mu.Lock()
	if c.droppedSessions == nil {
		c.droppedSessions = make(map[string]struct{})
	}
	c.droppedSessions[sessionID] = struct{}{}
	c.mu.Unlock()
}

// takeDropped returns the sessions with dropped output and clears the set,
// or nil when nothing was dropped.
func (c *wsClient) takeDropped() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.droppedSessions) == 0 {
		return nil
	}
	ids := make([]string, 0, len(c.droppedSessions))
	for id := range c.droppedSessions {
		ids = append(ids, id)
	}
	c.droppedSessions = nil
	return ids
}

// EventHub fans out backend events to every connected browser (remote) client,
// mirroring the Wails native event bus so a browser using the shim receives the
// same session:output / quanti:* events the desktop webview gets.
type EventHub struct {
	mu      sync.RWMutex
	clients map[*wsClient]struct{}
}

// NewEventHub creates an empty hub.
func NewEventHub() *EventHub {
	return &EventHub{clients: make(map[*wsClient]struct{})}
}

func (h *EventHub) add(c *wsClient) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *EventHub) remove(c *wsClient) {
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.send)
	}
	h.mu.Unlock()
}

// Publish fans payload out to every connected client. Clients whose send buffer
// is full are skipped rather than blocking the emitter (drop-slow-client).
func (h *EventHub) Publish(event string, data interface{}) {
	msg := eventMessage{Event: event, Data: data}
	h.mu.RLock()
	for c := range h.clients {
		select {
		case c.send <- msg:
		default:
			// Dropped terminal output corrupts the remote render, so remember
			// the session for a resync once the client drains. The payload is
			// always map[string]string{"sessionId","data"} — emitted in
			// internal/integration/process/manager.go.
			if event == "session:output" {
				if m, ok := data.(map[string]string); ok {
					c.markDropped(m["sessionId"])
				}
			}
		}
	}
	h.mu.RUnlock()
}

// ClientCount returns the number of connected browser clients.
func (h *EventHub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// closeAll closes every client connection, which unblocks the corresponding
// readPump goroutines so they deregister themselves. Used on server shutdown,
// since http.Server.Shutdown does not touch hijacked WebSocket connections.
func (h *EventHub) closeAll() {
	h.mu.RLock()
	for c := range h.clients {
		_ = c.conn.Close()
	}
	h.mu.RUnlock()
}

// defaultHub is the process-wide hub used by Emit/Publish so low-level emitters
// (process manager, session controller) need not thread a hub reference through
// every constructor. It is nil until the Manager is created, making Publish a
// no-op when remote access is not wired.
var defaultHub atomic.Pointer[EventHub]

// SetDefaultHub registers the process-wide hub. Called once by NewManager.
func SetDefaultHub(h *EventHub) { defaultHub.Store(h) }

// Publish sends an event to the process-wide hub, if any.
func Publish(event string, data interface{}) {
	if h := defaultHub.Load(); h != nil {
		h.Publish(event, data)
	}
}

// Emit delivers an event to BOTH the Wails native bridge (desktop webview, when
// ctx is non-nil) and the remote hub (browser clients). It is the single
// replacement for direct wailsRuntime.EventsEmit calls.
func Emit(ctx context.Context, event string, data interface{}) {
	if ctx != nil {
		wailsRuntime.EventsEmit(ctx, event, data)
	}
	Publish(event, data)
}
