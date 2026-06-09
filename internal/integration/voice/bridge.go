package voice

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ErrVoiceEnded signals that the voice surface is gone — the request timed out
// with no client responding, or the voice pane was closed/unmounted mid-request.
// It means the agent should STOP calling voice tools gracefully: it is NOT a
// retryable failure and NOT a real audio error. Callers test for it with
// errors.Is(err, ErrVoiceEnded).
var ErrVoiceEnded = errors.New("voice session ended")

// Default timeouts for the two voice round-trip kinds. They are generous because
// a "listen" turn waits for a human to finish speaking, and a "speak" turn waits
// for TTS synthesis + playback to complete.
const (
	// ListenTimeout bounds how long a voice_listen tool call blocks waiting for
	// the frontend to capture + transcribe one utterance.
	ListenTimeout = 120 * time.Second
	// SpeakTimeout bounds how long a voice_speak tool call blocks waiting for the
	// frontend to synthesize + play the given text.
	SpeakTimeout = 60 * time.Second
)

// Emitter pushes an event to the frontend (Wails native bridge + remote browser
// clients). It mirrors remote.Emit's signature so application.go can wire the
// real emitter in without this package importing the remote package.
type Emitter func(ctx context.Context, event string, data interface{})

// VoiceReply is the result the frontend reports back for a single voice request.
// For a "listen" request Transcript carries the recognized text; for a "speak"
// request Done signals playback completed. Err is a non-empty error string when
// the frontend-side audio operation failed.
type VoiceReply struct {
	Transcript string
	Done       bool
	Err        string
	// Closed is set by the frontend when the voice pane closed/moved mid-request,
	// so the in-flight turn can end promptly (instead of waiting the full timeout)
	// and the agent leaves voice mode gracefully via ErrVoiceEnded.
	Closed bool
}

// VoiceRequestEvent is the payload emitted on the "voice:request" event. The
// frontend bridge for the matching SessionID performs the audio operation and
// then calls VoiceResult(RequestID, ...) to unblock the waiting tool handler.
type VoiceRequestEvent struct {
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId"`
	Kind      string `json:"kind"` // "listen" | "speak"
	Text      string `json:"text"` // text to speak (empty for listen)
}

// Bridge is the request→do-audio→reply registry that connects the Go-side MCP
// voice tools to the frontend audio pipeline. A tool handler calls Request,
// which emits a "voice:request" event and blocks on a per-request channel; the
// frontend eventually calls Resolve (via the VoiceResult controller method),
// unblocking the handler.
//
// Multi-client note (v1): whichever client has a registered bridge for the
// session responds. If several tabs/remote clients have the pane open they all
// receive the event; the first Resolve for a requestId wins and later ones are
// ignored safely. Targeting a single "active/primary" client is left for later.
type Bridge struct {
	mu      sync.Mutex
	pending map[string]*pendingRequest
	emit    Emitter
	// appCtx is the Wails app LIFECYCLE context captured in OnStartup. Wails
	// runtime.EventsEmit rejects any other context ("an invalid context was
	// passed"), so the voice:request event MUST be emitted with this context —
	// NOT the per-request MCP/HTTP context that flows into Request().
	appCtx context.Context
}

// pendingRequest tracks one in-flight voice request: the reply channel the
// blocked Request select waits on, plus a keepalive channel that resets the
// request's timeout (used by recording mode, where a listen can legitimately
// outlive ListenTimeout). Both channels are buffered (cap 1) so senders never
// block.
type pendingRequest struct {
	ch     chan VoiceReply
	extend chan struct{}
}

// SetContext stores the Wails app lifecycle context used for emitting events.
// Call from the controller's OnStartup. Until set, emits fall back to a nil
// context (remote hub only; the native webview won't receive the event).
func (b *Bridge) SetContext(ctx context.Context) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.appCtx = ctx
}

// NewBridge constructs a Bridge that emits requests through the given emitter.
// The emitter may be nil in tests that only exercise Request/Resolve directly,
// but production wiring should always supply remote.Emit.
func NewBridge(emit Emitter) *Bridge {
	return &Bridge{
		pending: make(map[string]*pendingRequest),
		emit:    emit,
	}
}

// SetEmitter sets (or replaces) the emit function. Useful when the emitter is
// only available after construction.
func (b *Bridge) SetEmitter(emit Emitter) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.emit = emit
}

// newRequestID returns a short random hex id for correlating a request with its
// reply.
func newRequestID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		// Fall back to a time-based id; collisions are astronomically unlikely
		// and would only affect concurrent in-flight requests.
		return fmt.Sprintf("vr-%d", time.Now().UnixNano())
	}
	return "vr-" + hex.EncodeToString(buf[:])
}

// Request emits a voice request to the frontend and blocks until the frontend
// resolves it, the timeout elapses, or ctx is cancelled.
//
//   - kind "listen": text is ignored; the returned VoiceReply.Transcript holds
//     the recognized speech.
//   - kind "speak":  text is the phrase to synthesize; the reply's Done is true
//     once playback finishes.
//
// On timeout or cancellation it cleans up the pending entry and returns a clear,
// recoverable error so the calling agent can retry.
func (b *Bridge) Request(ctx context.Context, sessionID, kind, text string, timeout time.Duration) (VoiceReply, error) {
	requestID := newRequestID()
	p := &pendingRequest{
		ch:     make(chan VoiceReply, 1),
		extend: make(chan struct{}, 1),
	}

	b.mu.Lock()
	b.pending[requestID] = p
	emit := b.emit
	emitCtx := b.appCtx // Wails lifecycle ctx — NOT the request ctx
	b.mu.Unlock()

	if emit != nil {
		emit(emitCtx, "voice:request", VoiceRequestEvent{
			SessionID: sessionID,
			RequestID: requestID,
			Kind:      kind,
			Text:      text,
		})
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case reply := <-p.ch:
			// The channel is buffered and only written once, but delete the entry so
			// the map does not grow unbounded.
			b.remove(requestID)
			if reply.Err != "" {
				return reply, fmt.Errorf("voice %s failed: %s", kind, reply.Err)
			}
			if reply.Closed {
				// The pane closed/moved mid-request: end voice mode gracefully rather
				// than treating it as an error or waiting out the timeout.
				return reply, fmt.Errorf("voice %s ended (pane closed): %w", kind, ErrVoiceEnded)
			}
			return reply, nil
		case <-p.extend:
			// Keepalive from the frontend (recording mode): push the deadline out
			// by the full timeout again. Reset without draining is safe on Go 1.23+
			// timer semantics (go.mod pins well above that).
			timer.Reset(timeout)
		case <-timer.C:
			b.remove(requestID)
			// No client responded within the timeout: the voice surface is gone. Wrap
			// as ErrVoiceEnded so the agent stops calling voice tools instead of looping.
			return VoiceReply{}, fmt.Errorf("voice %s ended (timed out after %s waiting for the pane): %w", kind, timeout, ErrVoiceEnded)
		case <-ctx.Done():
			b.remove(requestID)
			return VoiceReply{}, fmt.Errorf("voice %s cancelled: %w", kind, ctx.Err())
		}
	}
}

// Extend resets the timeout of the in-flight request with the given requestId
// (keepalive). The frontend pings this every ~30s while the user is in recording
// mode so a long-form listen doesn't hit ListenTimeout mid-recording. Unknown or
// already-settled requestIds are ignored; the send is non-blocking (buffered,
// and a pending-but-unconsumed extend is equivalent).
func (b *Bridge) Extend(requestID string) {
	b.mu.Lock()
	p, ok := b.pending[requestID]
	b.mu.Unlock()
	if !ok {
		return
	}
	select {
	case p.extend <- struct{}{}:
	default:
	}
}

// Resolve delivers a reply for the given requestId, unblocking the waiting
// Request. Unknown or duplicate requestIds (already resolved / timed out) are
// ignored without error or panic. The send is non-blocking thanks to the
// buffered channel, and the entry is removed so a duplicate Resolve is a no-op.
func (b *Bridge) Resolve(requestID string, reply VoiceReply) {
	b.mu.Lock()
	p, ok := b.pending[requestID]
	if ok {
		delete(b.pending, requestID)
	}
	b.mu.Unlock()

	if !ok {
		return
	}
	// Non-blocking send: the channel is buffered (cap 1) and unique to this
	// request, so this never blocks. The select's default guards against the
	// impossible double-send.
	select {
	case p.ch <- reply:
	default:
	}
}

// remove deletes a pending entry under the lock.
func (b *Bridge) remove(requestID string) {
	b.mu.Lock()
	delete(b.pending, requestID)
	b.mu.Unlock()
}
