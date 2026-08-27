package e2e

import (
	"testing"

	"quant/internal/application/adapter"
	"quant/internal/domain/entity"
)

// TestReorderRepos verifies the workspace repo ladder: newly opened repos land
// on top, ReorderRepos persists an explicit top-to-bottom order that survives a
// re-read, and a repo from another workspace is rejected.
func TestReorderRepos(t *testing.T) {
	h := newHarness(t)
	repos := h.injector.RepoManager()

	var ids []string
	for _, name := range []string{"alpha", "beta", "gamma"} {
		repo, err := repos.OpenRepo(name, t.TempDir(), h.wsID)
		if err != nil {
			t.Fatalf("OpenRepo(%s): %v", name, err)
		}
		ids = append(ids, repo.ID)
	}

	// Newest first, as before manual ordering existed.
	assertRepoOrder(t, repos, h.wsID, []string{ids[2], ids[1], ids[0]})

	// Drag "alpha" to the top.
	if err := repos.ReorderRepos(h.wsID, []string{ids[0], ids[2], ids[1]}); err != nil {
		t.Fatalf("ReorderRepos: %v", err)
	}
	assertRepoOrder(t, repos, h.wsID, []string{ids[0], ids[2], ids[1]})

	// A repo opened afterwards still lands on top of the reordered ladder.
	fourth, err := repos.OpenRepo("delta", t.TempDir(), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo(delta): %v", err)
	}
	assertRepoOrder(t, repos, h.wsID, []string{fourth.ID, ids[0], ids[2], ids[1]})

	// A repo from another workspace cannot be dropped into this ladder.
	otherWS, err := h.injector.WorkspaceManager().CreateWorkspace(entity.Workspace{Name: "other"})
	if err != nil {
		t.Fatalf("CreateWorkspace: %v", err)
	}
	foreign, err := repos.OpenRepo("foreign", t.TempDir(), otherWS.ID)
	if err != nil {
		t.Fatalf("OpenRepo(foreign): %v", err)
	}
	if err := repos.ReorderRepos(h.wsID, []string{foreign.ID}); err == nil {
		t.Fatal("ReorderRepos accepted a repo from another workspace")
	}
	assertRepoOrder(t, repos, h.wsID, []string{fourth.ID, ids[0], ids[2], ids[1]})
}

// TestReorderSessions verifies that sessions can be ordered inside their task,
// that the order is persisted, and that a session from another task is rejected.
func TestReorderSessions(t *testing.T) {
	h := newHarness(t)
	sessions := h.injector.SessionManager()

	repo, err := h.injector.RepoManager().OpenRepo("session-order", t.TempDir(), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}
	task, err := h.injector.TaskManager().CreateTask(repo.ID, "ordering", "ordering")
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}

	var ids []string
	for _, name := range []string{"a", "b", "c"} {
		session, err := sessions.CreateSession(name, "", "claude", repo.ID, task.ID, entity.SessionOptions{})
		if err != nil {
			t.Fatalf("CreateSession(%s): %v", name, err)
		}
		ids = append(ids, session.ID)
		// Fresh sessions are unplaced, so the sidebar keeps showing them
		// alphabetically until they are dragged.
		if session.SortOrder != 0 {
			t.Fatalf("new session %s got sortOrder %d, want 0", name, session.SortOrder)
		}
	}

	// Place them c, a, b.
	want := []string{ids[2], ids[0], ids[1]}
	if err := sessions.ReorderSessions(task.ID, want); err != nil {
		t.Fatalf("ReorderSessions: %v", err)
	}

	got, err := sessions.ListSessionsByTask(task.ID)
	if err != nil {
		t.Fatalf("ListSessionsByTask: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("session count: got %d want %d", len(got), len(want))
	}
	for i, session := range got {
		if session.ID != want[i] {
			t.Fatalf("session %d: got %s want %s", i, session.ID, want[i])
		}
		// Positions start at 1 so a session created later keeps 0 and stays on top.
		if session.SortOrder != i+1 {
			t.Fatalf("session %d: got sortOrder %d want %d", i, session.SortOrder, i+1)
		}
	}

	// A session belonging to another task is rejected.
	otherTask, err := h.injector.TaskManager().CreateTask(repo.ID, "other", "other")
	if err != nil {
		t.Fatalf("CreateTask(other): %v", err)
	}
	foreign, err := sessions.CreateSession("d", "", "claude", repo.ID, otherTask.ID, entity.SessionOptions{})
	if err != nil {
		t.Fatalf("CreateSession(d): %v", err)
	}
	if err := sessions.ReorderSessions(task.ID, []string{foreign.ID}); err == nil {
		t.Fatal("ReorderSessions accepted a session from another task")
	}
}

func assertRepoOrder(t *testing.T, manager adapter.RepoManager, workspaceID string, want []string) {
	t.Helper()
	got, err := manager.ListReposByWorkspace(workspaceID)
	if err != nil {
		t.Fatalf("ListReposByWorkspace: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("repo count: got %d want %d", len(got), len(want))
	}
	for i, repo := range got {
		if repo.ID != want[i] {
			ids := make([]string, len(got))
			for j, g := range got {
				ids[j] = g.ID
			}
			t.Fatalf("repo order: got %v want %v", ids, want)
		}
	}
}
