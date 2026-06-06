package e2e

import (
	"strings"
	"testing"
	"time"
)

// TestSendMessageAutoSubmit verifies that send_message, by default, not only
// types text into a session's PTY but also delivers an Enter keystroke so the
// command actually runs. The negative case (submit=false) proves the text is
// typed but NOT executed.
//
// The test drives a real "terminal" session (a login shell in a PTY) and uses
// a command whose OUTPUT differs from its INPUT — `echo R$((6*7))Z` — so that
// finding "R42Z" in the session output can only mean the command was submitted
// and executed, not merely echoed back as typed characters.
func TestSendMessageAutoSubmit(t *testing.T) {
	// Use bash for a deterministic interactive shell regardless of the
	// developer's personal zsh profile.
	t.Setenv("SHELL", "/bin/bash")

	h := newHarness(t)

	startTerminal := func(name string) string {
		created := h.call("create_session", map[string]any{
			"name":        name,
			"sessionType": "terminal",
		})
		id, _ := created["id"].(string)
		if id == "" {
			t.Fatalf("create_session returned no id: %v", created)
		}
		h.callRaw("start_session", map[string]any{"id": id}, false)
		// Give the login shell time to come up and print its first prompt.
		time.Sleep(700 * time.Millisecond)
		return id
	}

	waitForOutput := func(id, want string, timeout time.Duration) (string, bool) {
		deadline := time.Now().Add(timeout)
		var last string
		for time.Now().Before(deadline) {
			last = h.callRaw("get_session_output", map[string]any{"id": id, "lines": float64(0)}, false)
			if strings.Contains(last, want) {
				return last, true
			}
			time.Sleep(100 * time.Millisecond)
		}
		return last, false
	}

	t.Run("submit true runs the command", func(t *testing.T) {
		id := startTerminal("orch-submit-true")
		h.callRaw("send_message", map[string]any{
			"id":      id,
			"message": "echo R$((6*7))Z",
			"submit":  true,
		}, false)
		out, ok := waitForOutput(id, "R42Z", 4*time.Second)
		if !ok {
			t.Fatalf("expected command to run and produce R42Z, but it did not.\noutput:\n%s", out)
		}
	})

	t.Run("submit defaults to true when omitted", func(t *testing.T) {
		id := startTerminal("orch-submit-default")
		h.callRaw("send_message", map[string]any{
			"id":      id,
			"message": "echo D$((6*7))Z",
		}, false)
		out, ok := waitForOutput(id, "D42Z", 4*time.Second)
		if !ok {
			t.Fatalf("expected default submit to run the command (D42Z), but it did not.\noutput:\n%s", out)
		}
	})

	t.Run("submit false types but does not run", func(t *testing.T) {
		id := startTerminal("orch-submit-false")
		h.callRaw("send_message", map[string]any{
			"id":      id,
			"message": "echo N$((6*7))Z",
			"submit":  false,
		}, false)
		// Give it the same window the positive case needed; the computed result
		// must still be absent because Enter was never sent.
		if out, ran := waitForOutput(id, "N42Z", 1500*time.Millisecond); ran {
			t.Fatalf("submit=false should not execute the command, but N42Z appeared.\noutput:\n%s", out)
		}
		// Now press Enter via a follow-up submit and confirm it runs, proving
		// the text really was sitting in the input buffer all along.
		h.callRaw("send_message", map[string]any{"id": id, "message": "", "submit": true}, false)
		if out, ran := waitForOutput(id, "N42Z", 4*time.Second); !ran {
			t.Fatalf("after a follow-up Enter the buffered command should run (N42Z).\noutput:\n%s", out)
		}
	})
}
