package e2e

import (
	"encoding/json"
	"strings"
	"testing"

	"quant/internal/domain/entity"
)

// listSessionRows runs list_sessions and decodes the array it returns.
func listSessionRows(t *testing.T, raw string) []map[string]any {
	t.Helper()
	var rows []map[string]any
	if err := json.Unmarshal([]byte(raw), &rows); err != nil {
		t.Fatalf("list_sessions result is not a JSON array: %v\nraw: %s", err, raw)
	}
	return rows
}

// TestListSessionsActiveWithRepoAndTask verifies list_sessions returns only the
// active sessions by default, each carrying the repo and task it sits in.
func TestListSessionsActiveWithRepoAndTask(t *testing.T) {
	h := newHarness(t)

	repo, err := h.injector.RepoManager().OpenRepo("msg-repo", t.TempDir(), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}
	task, err := h.injector.TaskManager().CreateTask(repo.ID, "qa", "quality")
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}

	sessions := h.injector.SessionManager()
	live, err := sessions.CreateSession("implementor", "", "claude", repo.ID, task.ID, entity.SessionOptions{})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	gone, err := sessions.CreateSession("old", "", "claude", repo.ID, task.ID, entity.SessionOptions{})
	if err != nil {
		t.Fatalf("CreateSession(old): %v", err)
	}
	if err := sessions.ArchiveSession(gone.ID); err != nil {
		t.Fatalf("ArchiveSession: %v", err)
	}

	rows := listSessionRows(t, h.callRaw("list_sessions", map[string]any{}, false))

	var found map[string]any
	for _, row := range rows {
		if row["id"] == gone.ID {
			t.Fatal("archived session listed by default")
		}
		if row["id"] == live.ID {
			found = row
		}
	}
	if found == nil {
		t.Fatalf("active session missing from list_sessions: %v", rows)
	}
	if found["repoName"] != "msg-repo" || found["taskTag"] != "qa" || found["taskName"] != "quality" {
		t.Errorf("repo/task context missing or wrong: %v", found)
	}
	if found["taskId"] != task.ID || found["repoId"] != repo.ID {
		t.Errorf("repo/task ids wrong: %v", found)
	}
	if found["acceptsMessages"] != true {
		t.Errorf("a fresh session should accept messages: %v", found)
	}

	// includeArchived brings the archived one back.
	rows = listSessionRows(t, h.callRaw("list_sessions", map[string]any{"includeArchived": true}, false))
	var sawArchived bool
	for _, row := range rows {
		if row["id"] == gone.ID {
			sawArchived = true
			if row["archived"] != true {
				t.Errorf("archived row not flagged: %v", row)
			}
		}
	}
	if !sawArchived {
		t.Error("includeArchived did not list the archived session")
	}
}

// TestSessionMessagingPolicy verifies the per-session policy: the sender's
// links restrict who it may message, and a send-only session refuses incoming
// messages. It also covers link_session / unlink_session from the MCP.
func TestSessionMessagingPolicy(t *testing.T) {
	h := newHarness(t)

	repo, err := h.injector.RepoManager().OpenRepo("policy-repo", t.TempDir(), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}
	task, err := h.injector.TaskManager().CreateTask(repo.ID, "pair", "pair")
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}

	sessions := h.injector.SessionManager()
	qa, err := sessions.CreateSession("qa", "", "claude", repo.ID, task.ID, entity.SessionOptions{})
	if err != nil {
		t.Fatalf("CreateSession(qa): %v", err)
	}
	impl, err := sessions.CreateSession("implementor", "", "claude", repo.ID, task.ID, entity.SessionOptions{})
	if err != nil {
		t.Fatalf("CreateSession(impl): %v", err)
	}
	other, err := sessions.CreateSession("unrelated", "", "claude", repo.ID, task.ID, entity.SessionOptions{})
	if err != nil {
		t.Fatalf("CreateSession(other): %v", err)
	}

	qaClient := newSessionClient(t, h, qa.ID)

	// With nothing linked, every session is allowed — the message only fails
	// because the target has no running process, not because of the policy.
	if errText := qaClient.callRaw("send_message", map[string]any{"id": impl.ID, "message": "hi"}, true); strings.Contains(errText, "not linked") {
		t.Fatalf("an unlinked session should be able to message anyone: %s", errText)
	}

	// Linking narrows the allowlist to the linked session.
	qaClient.callRaw("link_session", map[string]any{"sessionId": impl.ID}, false)

	errText := qaClient.callRaw("send_message", map[string]any{"id": other.ID, "message": "hi"}, true)
	if !strings.Contains(errText, "not linked") {
		t.Fatalf("expected a not-linked error for an unlinked target, got: %s", errText)
	}
	if errText := qaClient.callRaw("send_message", map[string]any{"id": impl.ID, "message": "hi"}, true); strings.Contains(errText, "not linked") {
		t.Fatalf("the linked session should still be allowed: %s", errText)
	}

	// list_sessions reports the link back to the caller.
	rows := listSessionRows(t, qaClient.callRaw("list_sessions", map[string]any{}, false))
	for _, row := range rows {
		switch row["id"] {
		case impl.ID:
			if row["linked"] != true {
				t.Errorf("linked session not flagged: %v", row)
			}
		case other.ID:
			if row["linked"] != false {
				t.Errorf("unlinked session flagged as linked: %v", row)
			}
		case qa.ID:
			if row["isSelf"] != true {
				t.Errorf("caller row not flagged isSelf: %v", row)
			}
		}
	}

	// Unlinking the last peer restores "may message anyone".
	qaClient.callRaw("unlink_session", map[string]any{"sessionId": impl.ID}, false)
	if errText := qaClient.callRaw("send_message", map[string]any{"id": other.ID, "message": "hi"}, true); strings.Contains(errText, "not linked") {
		t.Fatalf("clearing the links should allow any session again: %s", errText)
	}

	// A send-only session refuses incoming messages.
	if err := sessions.SetSessionMessaging(other.ID, entity.MessagingOut, nil); err != nil {
		t.Fatalf("SetSessionMessaging: %v", err)
	}
	errText = qaClient.callRaw("send_message", map[string]any{"id": other.ID, "message": "hi"}, true)
	if !strings.Contains(errText, "send-only") {
		t.Fatalf("expected a send-only refusal, got: %s", errText)
	}
}

// TestSessionMessagingCanBeTurnedOff verifies the settings switch stops one
// session from typing into another.
func TestSessionMessagingCanBeTurnedOff(t *testing.T) {
	h := newHarness(t)

	repo, err := h.injector.RepoManager().OpenRepo("off-repo", t.TempDir(), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}
	task, err := h.injector.TaskManager().CreateTask(repo.ID, "pair", "pair")
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}

	sessions := h.injector.SessionManager()
	from, err := sessions.CreateSession("a", "", "claude", repo.ID, task.ID, entity.SessionOptions{})
	if err != nil {
		t.Fatalf("CreateSession(a): %v", err)
	}
	to, err := sessions.CreateSession("b", "", "claude", repo.ID, task.ID, entity.SessionOptions{})
	if err != nil {
		t.Fatalf("CreateSession(b): %v", err)
	}

	cfg, err := h.injector.ConfigManager().GetConfig()
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if !cfg.SessionMessaging {
		t.Fatal("session messaging should default to on")
	}
	cfg.SessionMessaging = false
	if err := h.injector.ConfigManager().SaveConfig(cfg); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	client := newSessionClient(t, h, from.ID)
	errText := client.callRaw("send_message", map[string]any{"id": to.ID, "message": "hi"}, true)
	if !strings.Contains(errText, "turned off") {
		t.Fatalf("expected a switched-off refusal, got: %s", errText)
	}
}
