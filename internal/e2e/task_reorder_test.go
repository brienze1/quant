package e2e

import (
	"testing"

	"quant/internal/application/adapter"
)

// TestReorderTasks verifies the manual task ladder: new tasks land on top,
// ReorderTasks persists an explicit top-to-bottom order, and a task belonging
// to another repo is rejected so drag-reordering stays locked to one repo.
func TestReorderTasks(t *testing.T) {
	h := newHarness(t)
	tasks := h.injector.TaskManager()

	repo, err := h.injector.RepoManager().OpenRepo("ladder-repo", t.TempDir(), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}

	var ids []string
	for _, tag := range []string{"first", "second", "third"} {
		task, err := tasks.CreateTask(repo.ID, tag, tag)
		if err != nil {
			t.Fatalf("CreateTask(%s): %v", tag, err)
		}
		ids = append(ids, task.ID)
	}

	// Newest first, as before manual ordering existed.
	assertTaskOrder(t, tasks, repo.ID, []string{ids[2], ids[1], ids[0]})

	// Drag "first" to the top.
	if err := tasks.ReorderTasks(repo.ID, []string{ids[0], ids[2], ids[1]}); err != nil {
		t.Fatalf("ReorderTasks: %v", err)
	}
	assertTaskOrder(t, tasks, repo.ID, []string{ids[0], ids[2], ids[1]})

	// A task created afterwards still lands on top of the reordered ladder.
	fourth, err := tasks.CreateTask(repo.ID, "fourth", "fourth")
	if err != nil {
		t.Fatalf("CreateTask(fourth): %v", err)
	}
	assertTaskOrder(t, tasks, repo.ID, []string{fourth.ID, ids[0], ids[2], ids[1]})

	// A task from another repo cannot be dropped into this repo's ladder.
	otherRepo, err := h.injector.RepoManager().OpenRepo("other-repo", t.TempDir(), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo(other): %v", err)
	}
	foreign, err := tasks.CreateTask(otherRepo.ID, "foreign", "foreign")
	if err != nil {
		t.Fatalf("CreateTask(foreign): %v", err)
	}
	if err := tasks.ReorderTasks(repo.ID, []string{foreign.ID}); err == nil {
		t.Fatal("ReorderTasks accepted a task from another repo")
	}
	// The rejected reorder left the ladder untouched.
	assertTaskOrder(t, tasks, repo.ID, []string{fourth.ID, ids[0], ids[2], ids[1]})
}

func assertTaskOrder(t *testing.T, manager adapter.TaskManager, repoID string, want []string) {
	t.Helper()
	got, err := manager.ListTasksByRepo(repoID)
	if err != nil {
		t.Fatalf("ListTasksByRepo: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("task count: got %d want %d", len(got), len(want))
	}
	for i, task := range got {
		if task.ID != want[i] {
			ids := make([]string, len(got))
			for j, g := range got {
				ids[j] = g.ID
			}
			t.Fatalf("task order: got %v want %v", ids, want)
		}
	}
}
