// Package worktree contains the git worktree manager implementation.
package worktree

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"quant/internal/application/usecase"
	"quant/internal/integration/adapter"
)

// worktreeManager implements the adapter.WorktreeManager interface using git CLI commands.
type worktreeManager struct {
	baseDir string // ~/.quant/worktrees/
}

// NewWorktreeManager creates a new git worktree manager.
// Worktrees are stored in ~/.quant/worktrees/ to keep them hidden from the user's project directories.
func NewWorktreeManager() adapter.WorktreeManager {
	homeDir, _ := os.UserHomeDir()
	baseDir := filepath.Join(homeDir, ".quant", "worktrees")
	_ = os.MkdirAll(baseDir, 0755)

	return &worktreeManager{baseDir: baseDir}
}

// Create creates a new git worktree with the given branch name.
// The worktree is stored in ~/.quant/worktrees/<repo>/<sanitized-branch-name>.
// If a worktree for the branch already exists (created outside quant), it is reused.
func (m *worktreeManager) Create(repoDir string, branchName string) (usecase.WorktreeInfo, error) {
	// Check if a worktree for this branch already exists.
	existing, err := m.List(repoDir)
	if err == nil {
		for _, wt := range existing {
			if wt.Branch == branchName {
				return usecase.WorktreeInfo{
					Path:   wt.Path,
					Branch: wt.Branch,
				}, nil
			}
		}
	}

	// Sanitize branch name for use as directory name.
	repoName := filepath.Base(repoDir)
	dirName := strings.ReplaceAll(branchName, "/", "-")
	worktreePath := filepath.Join(m.baseDir, repoName, dirName)

	// Try creating with new branch first.
	cmd := exec.Command("git", "worktree", "add", "-b", branchName, worktreePath)
	cmd.Dir = repoDir

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Branch may already exist — try checking it out instead.
		cmd2 := exec.Command("git", "worktree", "add", worktreePath, branchName)
		cmd2.Dir = repoDir
		output2, err2 := cmd2.CombinedOutput()
		if err2 != nil {
			return usecase.WorktreeInfo{}, fmt.Errorf("failed to create worktree: %s: %w", string(output2), err2)
		}
		_ = output
	}

	return usecase.WorktreeInfo{
		Path:   worktreePath,
		Branch: branchName,
	}, nil
}

// Delete removes a git worktree and cleans up the branch.
func (m *worktreeManager) Delete(worktreePath string) error {
	// Force remove the worktree (handles dirty working trees).
	cmd := exec.Command("git", "worktree", "remove", "--force", worktreePath)

	output, err := cmd.CombinedOutput()
	if err != nil {
		// If worktree remove fails, try to just delete the directory.
		_ = os.RemoveAll(worktreePath)
	}
	_ = output

	// Prune stale worktree references.
	pruneCmd := exec.Command("git", "worktree", "prune")
	_ = pruneCmd.Run()

	return nil
}

// List returns all git worktrees for the given repository.
func (m *worktreeManager) List(repoDir string) ([]usecase.WorktreeInfo, error) {
	cmd := exec.Command("git", "worktree", "list", "--porcelain")
	cmd.Dir = repoDir

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list worktrees: %w", err)
	}

	var worktrees []usecase.WorktreeInfo
	scanner := bufio.NewScanner(strings.NewReader(string(output)))

	var current usecase.WorktreeInfo
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "worktree ") {
			if current.Path != "" {
				worktrees = append(worktrees, current)
			}
			current = usecase.WorktreeInfo{
				Path: strings.TrimPrefix(line, "worktree "),
			}
		} else if strings.HasPrefix(line, "branch ") {
			branch := strings.TrimPrefix(line, "branch ")
			branch = strings.TrimPrefix(branch, "refs/heads/")
			current.Branch = branch
		}
	}

	if current.Path != "" {
		worktrees = append(worktrees, current)
	}

	return worktrees, nil
}
