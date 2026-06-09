package voice

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// TestBridgeRequestResolves verifies the happy path: Request blocks until a
// Resolve with the matching requestId arrives, and returns the transcript.
func TestBridgeRequestResolves(t *testing.T) {
	var capturedReqID string
	var mu sync.Mutex
	b := NewBridge(func(_ context.Context, event string, data interface{}) {
		if event != "voice:request" {
			t.Errorf("unexpected event %q", event)
		}
		ev, ok := data.(VoiceRequestEvent)
		if !ok {
			t.Errorf("payload is not VoiceRequestEvent: %T", data)
			return
		}
		mu.Lock()
		capturedReqID = ev.RequestID
		mu.Unlock()
	})

	type result struct {
		reply VoiceReply
		err   error
	}
	done := make(chan result, 1)
	go func() {
		reply, err := b.Request(context.Background(), "sess-1", "listen", "", time.Second)
		done <- result{reply, err}
	}()

	// Wait for the emit to have captured the requestId, then resolve it.
	reqID := waitForReqID(t, &mu, &capturedReqID)
	b.Resolve(reqID, VoiceReply{Transcript: "forty two", Done: true})

	select {
	case r := <-done:
		if r.err != nil {
			t.Fatalf("Request returned error: %v", r.err)
		}
		if r.reply.Transcript != "forty two" {
			t.Fatalf("transcript = %q, want %q", r.reply.Transcript, "forty two")
		}
	case <-time.After(time.Second):
		t.Fatal("Request did not unblock after Resolve")
	}
}

// TestBridgeTimeout verifies that Request returns an ErrVoiceEnded error when no
// Resolve arrives within the timeout, so the agent ends voice mode gracefully
// instead of treating it as a retryable failure or looping.
func TestBridgeTimeout(t *testing.T) {
	b := NewBridge(func(_ context.Context, _ string, _ interface{}) {})

	start := time.Now()
	_, err := b.Request(context.Background(), "sess-1", "listen", "", 50*time.Millisecond)
	if err == nil {
		t.Fatal("expected a timeout error, got nil")
	}
	if !errors.Is(err, ErrVoiceEnded) {
		t.Fatalf("timeout error should satisfy errors.Is(err, ErrVoiceEnded), got %v", err)
	}
	if elapsed := time.Since(start); elapsed < 40*time.Millisecond {
		t.Fatalf("returned too early (%v) — did not wait for the timeout", elapsed)
	}
	// The pending entry must be cleaned up.
	b.mu.Lock()
	n := len(b.pending)
	b.mu.Unlock()
	if n != 0 {
		t.Fatalf("pending map not cleaned up after timeout: %d entries", n)
	}
}

// TestBridgeClosedResolve verifies that a Resolve with Closed:true ends the
// request with an ErrVoiceEnded error (the pane closed mid-request), promptly,
// without waiting for the timeout.
func TestBridgeClosedResolve(t *testing.T) {
	var capturedReqID string
	var mu sync.Mutex
	b := NewBridge(func(_ context.Context, _ string, data interface{}) {
		ev := data.(VoiceRequestEvent)
		mu.Lock()
		capturedReqID = ev.RequestID
		mu.Unlock()
	})

	type result struct {
		reply VoiceReply
		err   error
	}
	done := make(chan result, 1)
	go func() {
		// A generous timeout: the Closed resolve must end the request well before it.
		reply, err := b.Request(context.Background(), "sess-1", "listen", "", time.Minute)
		done <- result{reply, err}
	}()

	reqID := waitForReqID(t, &mu, &capturedReqID)
	b.Resolve(reqID, VoiceReply{Closed: true})

	select {
	case r := <-done:
		if r.err == nil {
			t.Fatal("expected an error when the pane closed (Closed:true), got nil")
		}
		if !errors.Is(r.err, ErrVoiceEnded) {
			t.Fatalf("closed error should satisfy errors.Is(err, ErrVoiceEnded), got %v", r.err)
		}
		if !r.reply.Closed {
			t.Errorf("returned reply should carry Closed=true, got %+v", r.reply)
		}
	case <-time.After(time.Second):
		t.Fatal("Request did not unblock promptly after a Closed resolve")
	}
}

// TestBridgeExtendResetsTimeout verifies the recording-mode keepalive: Extend
// pushes the request's deadline out by the full timeout again, so repeated
// extends keep a request alive well past its original timeout, and the request
// still resolves normally afterwards.
func TestBridgeExtendResetsTimeout(t *testing.T) {
	var capturedReqID string
	var mu sync.Mutex
	b := NewBridge(func(_ context.Context, _ string, data interface{}) {
		ev := data.(VoiceRequestEvent)
		mu.Lock()
		capturedReqID = ev.RequestID
		mu.Unlock()
	})

	type result struct {
		reply VoiceReply
		err   error
	}
	done := make(chan result, 1)
	go func() {
		reply, err := b.Request(context.Background(), "sess-1", "listen", "", 150*time.Millisecond)
		done <- result{reply, err}
	}()

	reqID := waitForReqID(t, &mu, &capturedReqID)
	// Extend every 80ms — total wait (4×80ms = 320ms) far exceeds the original
	// 150ms timeout, so the request only survives if Extend resets the timer.
	for i := 0; i < 4; i++ {
		b.Extend(reqID)
		time.Sleep(80 * time.Millisecond)
		select {
		case r := <-done:
			t.Fatalf("request ended early despite extends (iteration %d): reply=%+v err=%v", i, r.reply, r.err)
		default:
		}
	}

	b.Resolve(reqID, VoiceReply{Transcript: "a long recorded speech"})
	select {
	case r := <-done:
		if r.err != nil {
			t.Fatalf("Request returned error after extends: %v", r.err)
		}
		if r.reply.Transcript != "a long recorded speech" {
			t.Fatalf("transcript = %q, want %q", r.reply.Transcript, "a long recorded speech")
		}
	case <-time.After(time.Second):
		t.Fatal("Request did not unblock after Resolve")
	}

	// Extending an unknown/settled requestId must be a safe no-op.
	b.Extend("does-not-exist")
	b.Extend(reqID)
}

// TestBridgeExtendDoesNotOutliveResolveTimeout verifies a request that stops
// being extended still times out (the keepalive doesn't make it immortal).
func TestBridgeExtendDoesNotOutliveResolveTimeout(t *testing.T) {
	var capturedReqID string
	var mu sync.Mutex
	b := NewBridge(func(_ context.Context, _ string, data interface{}) {
		ev := data.(VoiceRequestEvent)
		mu.Lock()
		capturedReqID = ev.RequestID
		mu.Unlock()
	})

	done := make(chan error, 1)
	go func() {
		_, err := b.Request(context.Background(), "sess-1", "listen", "", 60*time.Millisecond)
		done <- err
	}()

	reqID := waitForReqID(t, &mu, &capturedReqID)
	b.Extend(reqID)

	select {
	case err := <-done:
		if !errors.Is(err, ErrVoiceEnded) {
			t.Fatalf("expected ErrVoiceEnded after extends stop, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Request never timed out after extends stopped")
	}
	b.mu.Lock()
	n := len(b.pending)
	b.mu.Unlock()
	if n != 0 {
		t.Fatalf("pending map not cleaned up after timeout: %d entries", n)
	}
}

// TestBridgeCtxCancel verifies cancellation returns an error and cleans up.
func TestBridgeCtxCancel(t *testing.T) {
	b := NewBridge(func(_ context.Context, _ string, _ interface{}) {})
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan error, 1)
	go func() {
		_, err := b.Request(ctx, "sess-1", "speak", "hi", time.Minute)
		done <- err
	}()

	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected cancellation error, got nil")
		}
	case <-time.After(time.Second):
		t.Fatal("Request did not unblock after ctx cancel")
	}
}

// TestBridgeUnknownAndDuplicateResolve verifies that resolving an unknown or
// an already-resolved requestId is a safe no-op (no panic, no error).
func TestBridgeUnknownAndDuplicateResolve(t *testing.T) {
	var capturedReqID string
	var mu sync.Mutex
	b := NewBridge(func(_ context.Context, _ string, data interface{}) {
		ev := data.(VoiceRequestEvent)
		mu.Lock()
		capturedReqID = ev.RequestID
		mu.Unlock()
	})

	// Unknown requestId before any request — must not panic.
	b.Resolve("does-not-exist", VoiceReply{Transcript: "ignored"})

	done := make(chan VoiceReply, 1)
	go func() {
		reply, _ := b.Request(context.Background(), "sess-1", "listen", "", time.Second)
		done <- reply
	}()

	reqID := waitForReqID(t, &mu, &capturedReqID)
	b.Resolve(reqID, VoiceReply{Transcript: "first"})
	// Duplicate resolve of the same id — must be ignored (no panic, no second
	// value leaking anywhere).
	b.Resolve(reqID, VoiceReply{Transcript: "second"})

	select {
	case reply := <-done:
		if reply.Transcript != "first" {
			t.Fatalf("got %q, want the first resolve %q", reply.Transcript, "first")
		}
	case <-time.After(time.Second):
		t.Fatal("Request did not unblock")
	}
}

// TestBridgeConcurrentNoCrossWires verifies two concurrent requests get their
// own replies even when resolved in reverse order.
func TestBridgeConcurrentNoCrossWires(t *testing.T) {
	var mu sync.Mutex
	reqIDs := map[string]string{} // sessionId -> requestId
	b := NewBridge(func(_ context.Context, _ string, data interface{}) {
		ev := data.(VoiceRequestEvent)
		mu.Lock()
		reqIDs[ev.SessionID] = ev.RequestID
		mu.Unlock()
	})

	res := make(map[string]string)
	var resMu sync.Mutex
	var wg sync.WaitGroup
	for _, sid := range []string{"A", "B"} {
		sid := sid
		wg.Add(1)
		go func() {
			defer wg.Done()
			reply, err := b.Request(context.Background(), sid, "listen", "", 2*time.Second)
			if err != nil {
				t.Errorf("session %s: %v", sid, err)
				return
			}
			resMu.Lock()
			res[sid] = reply.Transcript
			resMu.Unlock()
		}()
	}

	// Wait until both requests have registered their requestIds.
	deadline := time.Now().Add(time.Second)
	for {
		mu.Lock()
		n := len(reqIDs)
		idA, idB := reqIDs["A"], reqIDs["B"]
		mu.Unlock()
		if n == 2 {
			// Resolve in REVERSE order: B first, then A. Each must get its own
			// transcript.
			b.Resolve(idB, VoiceReply{Transcript: "reply-B"})
			b.Resolve(idA, VoiceReply{Transcript: "reply-A"})
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("requests did not both register in time")
		}
		time.Sleep(2 * time.Millisecond)
	}

	wg.Wait()
	resMu.Lock()
	defer resMu.Unlock()
	if res["A"] != "reply-A" {
		t.Fatalf("session A got %q, want reply-A (cross-wired?)", res["A"])
	}
	if res["B"] != "reply-B" {
		t.Fatalf("session B got %q, want reply-B (cross-wired?)", res["B"])
	}
}

// waitForReqID spins until the emitter has captured a non-empty requestId.
func waitForReqID(t *testing.T, mu *sync.Mutex, id *string) string {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		v := *id
		mu.Unlock()
		if v != "" {
			return v
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("emitter never captured a requestId")
	return ""
}
