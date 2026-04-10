package worktree

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// initTestRepo creates a temporary bare-bones git repo with one commit.
func initTestRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	for _, args := range [][]string{
		{"init"},
		{"commit", "--allow-empty", "-m", "init"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@test.com",
			"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@test.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %s: %s", args, err, out)
		}
	}
	return dir
}

func TestCreate_ReusesExistingWorktree(t *testing.T) {
	repoDir := initTestRepo(t)
	branchName := "test-reuse-branch"

	// Create a worktree outside of quant (simulating what the user does manually).
	externalPath := filepath.Join(t.TempDir(), "external-wt")
	cmd := exec.Command("git", "worktree", "add", "-b", branchName, externalPath)
	cmd.Dir = repoDir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to create external worktree: %s: %s", err, out)
	}

	// Now call Create via the manager — it should reuse the existing worktree
	// instead of failing with "already used by worktree".
	mgr := &worktreeManager{baseDir: t.TempDir()}
	info, err := mgr.Create(repoDir, branchName)
	if err != nil {
		t.Fatalf("Create should reuse existing worktree, got error: %v", err)
	}

	if info.Branch != branchName {
		t.Errorf("expected branch %q, got %q", branchName, info.Branch)
	}
	// Resolve symlinks for comparison (macOS /var -> /private/var).
	resolvedExpected, _ := filepath.EvalSymlinks(externalPath)
	resolvedActual, _ := filepath.EvalSymlinks(info.Path)
	if resolvedActual != resolvedExpected {
		t.Errorf("expected reused path %q, got %q", resolvedExpected, resolvedActual)
	}
}

func TestCreate_NewWorktree(t *testing.T) {
	repoDir := initTestRepo(t)
	branchName := "test-new-branch"
	baseDir := t.TempDir()

	mgr := &worktreeManager{baseDir: baseDir}
	info, err := mgr.Create(repoDir, branchName)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if info.Branch != branchName {
		t.Errorf("expected branch %q, got %q", branchName, info.Branch)
	}

	expectedPath := filepath.Join(baseDir, filepath.Base(repoDir), branchName)
	if info.Path != expectedPath {
		t.Errorf("expected path %q, got %q", expectedPath, info.Path)
	}

	// Verify the worktree actually exists on disk.
	if _, err := os.Stat(info.Path); os.IsNotExist(err) {
		t.Error("worktree directory was not created")
	}
}

func TestCreate_ExistingBranchNoWorktree(t *testing.T) {
	repoDir := initTestRepo(t)
	branchName := "existing-branch"

	// Create branch without a worktree.
	cmd := exec.Command("git", "branch", branchName)
	cmd.Dir = repoDir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to create branch: %s: %s", err, out)
	}

	mgr := &worktreeManager{baseDir: t.TempDir()}
	info, err := mgr.Create(repoDir, branchName)
	if err != nil {
		t.Fatalf("Create failed for existing branch: %v", err)
	}

	if info.Branch != branchName {
		t.Errorf("expected branch %q, got %q", branchName, info.Branch)
	}
}
