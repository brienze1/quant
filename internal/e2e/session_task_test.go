package e2e

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestCreateSessionTaskEnforcement verifies that repo-backed sessions must be
// filed under a task: a bare repoId is rejected, taskTag finds-or-creates a
// task and reuses it on a second create, and create_task shows up in list_tasks.
func TestCreateSessionTaskEnforcement(t *testing.T) {
	h := newHarness(t)

	repo, err := h.injector.RepoManager().OpenRepo("task-repo", t.TempDir(), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}

	// A repo-backed session with no task is rejected with a clear error.
	errText := h.callExpectError("create_session", map[string]any{
		"name": "no-task", "sessionType": "claude", "repoId": repo.ID,
	})
	if !strings.Contains(errText, "a task is required") {
		t.Fatalf("expected task-required error, got: %s", errText)
	}

	// taskTag files the session under a new task.
	s1 := h.call("create_session", map[string]any{
		"name": "a", "sessionType": "claude", "repoId": repo.ID, "taskTag": "feat-x",
	})
	task1, _ := s1["taskId"].(string)
	if task1 == "" {
		t.Fatalf("create_session with taskTag left the session loose: %v", s1)
	}

	// The same taskTag reuses the same task.
	s2 := h.call("create_session", map[string]any{
		"name": "b", "sessionType": "claude", "repoId": repo.ID, "taskTag": "feat-x",
	})
	if task2, _ := s2["taskId"].(string); task2 != task1 {
		t.Fatalf("same taskTag should reuse the task: got %q want %q", task2, task1)
	}

	// create_task lowercases tag+name and shows up in list_tasks.
	created := h.call("create_task", map[string]any{"repoId": repo.ID, "tag": "MANUAL", "name": "Manual Task"})
	createdID, _ := created["id"].(string)
	if createdID == "" || created["tag"] != "manual" || created["name"] != "manual task" {
		t.Fatalf("create_task returned unexpected task (tag/name should be lowercased): %v", created)
	}

	listText := h.callRaw("list_tasks", map[string]any{"repoId": repo.ID}, false)
	var tasks []map[string]any
	if err := json.Unmarshal([]byte(listText), &tasks); err != nil {
		t.Fatalf("list_tasks result is not a JSON array: %v\nraw: %s", err, listText)
	}
	byID := map[string]bool{}
	for _, task := range tasks {
		id, _ := task["id"].(string)
		byID[id] = true
	}
	if !byID[task1] || !byID[createdID] {
		t.Fatalf("list_tasks missing expected tasks (feat-x=%s, manual=%s): %s", task1, createdID, listText)
	}
}

// TestCrewDispatchFilesWorkerUnderTask verifies crew_dispatch files a newly
// created worker under a task: a supervisor with a task passes it to the worker;
// a loose (repoless) supervisor's worker falls back to the find-or-create
// "crew" task in the worker's repo.
func TestCrewDispatchFilesWorkerUnderTask(t *testing.T) {
	t.Setenv("SHELL", "/bin/bash")
	h := newHarness(t)
	h.injector.ProcessManager().UpdateCliBinaryConfig(writeFakeInteractiveClaude(t, t.TempDir()), nil)

	repo, err := h.injector.RepoManager().OpenRepo("crew-task-repo", t.TempDir(), h.wsID)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}

	// Supervisor WITH a task: the worker inherits the supervisor's task.
	boss := h.call("create_session", map[string]any{
		"name": "boss", "sessionType": "claude", "repoId": repo.ID, "taskTag": "boss-task",
	})
	bossID, _ := boss["id"].(string)
	bossTask, _ := boss["taskId"].(string)
	if bossID == "" || bossTask == "" {
		t.Fatalf("boss not created with a task: %v", boss)
	}

	bossClient := newSessionClient(t, h, bossID)
	res := bossClient.call("crew_dispatch", map[string]any{
		"prompt": "WORK", "name": "worker-1", "repoId": repo.ID,
	})
	workerID, _ := res["workerSessionId"].(string)
	if workerID == "" || res["created"] != true {
		t.Fatalf("unexpected dispatch result: %v", res)
	}
	worker := h.call("get_session", map[string]any{"id": workerID})
	if wt, _ := worker["taskId"].(string); wt != bossTask {
		t.Fatalf("worker should inherit supervisor task: got %q want %q", wt, bossTask)
	}

	// Loose (repoless) supervisor: the worker falls back to the "crew" task.
	loose := h.call("create_session", map[string]any{"name": "loose-boss", "sessionType": "claude"})
	looseID, _ := loose["id"].(string)
	if lt, _ := loose["taskId"].(string); lt != "" {
		t.Fatalf("repoless supervisor should be loose, got task %q", lt)
	}

	looseClient := newSessionClient(t, h, looseID)
	res2 := looseClient.call("crew_dispatch", map[string]any{
		"prompt": "WORK", "name": "worker-2", "repoId": repo.ID,
	})
	worker2ID, _ := res2["workerSessionId"].(string)
	if worker2ID == "" || res2["created"] != true {
		t.Fatalf("unexpected dispatch result: %v", res2)
	}
	worker2 := h.call("get_session", map[string]any{"id": worker2ID})
	crewTask, _ := worker2["taskId"].(string)
	if crewTask == "" {
		t.Fatalf("loose supervisor's worker should get a task, got loose worker: %v", worker2)
	}

	// The fallback is a task tagged "crew" in the worker's repo.
	listText := h.callRaw("list_tasks", map[string]any{"repoId": repo.ID}, false)
	var tasks []map[string]any
	if err := json.Unmarshal([]byte(listText), &tasks); err != nil {
		t.Fatalf("list_tasks result is not a JSON array: %v\nraw: %s", err, listText)
	}
	found := false
	for _, task := range tasks {
		if id, _ := task["id"].(string); id == crewTask {
			if task["tag"] != "crew" {
				t.Fatalf("crew fallback task should be tagged 'crew': %v", task)
			}
			found = true
		}
	}
	if !found {
		t.Fatalf("crew task %s not found in list_tasks: %s", crewTask, listText)
	}
}
