package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeTranscript(t *testing.T, baseDir string, dir string, name string, lines []string) string {
	t.Helper()
	slugDir := filepath.Join(baseDir, projectSlug(dir))
	if err := os.MkdirAll(slugDir, 0755); err != nil {
		t.Fatalf("failed to create slug dir: %v", err)
	}
	path := filepath.Join(slugDir, name)
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0644); err != nil {
		t.Fatalf("failed to write transcript: %v", err)
	}
	return path
}

func TestProjectSlug(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"/Users/gabriel.herter/Documents/Projects/quant", "-Users-gabriel-herter-Documents-Projects-quant"},
		{"/tmp/my_project (v2)", "-tmp-my-project--v2-"},
		{"/home/dev/café", "-home-dev-caf-"},
		{"C:\\Users\\dev\\repo", "C--Users-dev-repo"},
	}
	for _, c := range cases {
		if got := projectSlug(c.in); got != c.want {
			t.Errorf("projectSlug(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestTranscriptCwd(t *testing.T) {
	baseDir := t.TempDir()
	dir := "/tmp/proj"

	// cwd appears on a later line, not line 1.
	path := writeTranscript(t, baseDir, dir, "a.jsonl", []string{
		`{"type":"last-prompt","value":"something"}`,
		`{"type":"user","cwd":"/tmp/proj","message":{"content":"hello there"}}`,
	})

	ts := claudeTranscripts{baseDir: baseDir}
	cwd, err := ts.transcriptCwd(path)
	if err != nil {
		t.Fatalf("transcriptCwd failed: %v", err)
	}
	if cwd != dir {
		t.Errorf("transcriptCwd = %q, want %q", cwd, dir)
	}

	// No cwd at all → error.
	noCwd := writeTranscript(t, baseDir, dir, "b.jsonl", []string{
		`{"type":"last-prompt","value":"x"}`,
	})
	if _, err := ts.transcriptCwd(noCwd); err == nil {
		t.Error("expected error for transcript without cwd")
	}
}

func TestFindByID(t *testing.T) {
	baseDir := t.TempDir()
	dir := "/tmp/proj"
	id := "5b1e9c1a-1234-4abc-9def-0123456789ab"

	writeTranscript(t, baseDir, dir, id+".jsonl", []string{
		`{"type":"user","cwd":"/tmp/proj","message":{"content":"hi"}}`,
	})

	ts := claudeTranscripts{baseDir: baseDir}
	path, cwd, err := ts.findByID(id)
	if err != nil {
		t.Fatalf("findByID failed: %v", err)
	}
	if cwd != dir {
		t.Errorf("findByID cwd = %q, want %q", cwd, dir)
	}
	if filepath.Base(path) != id+".jsonl" {
		t.Errorf("findByID path = %q, want file %s.jsonl", path, id)
	}

	_, _, err = ts.findByID("99999999-9999-4999-9999-999999999999")
	if err == nil {
		t.Fatal("expected error for missing transcript")
	}
	if !strings.Contains(err.Error(), "no claude session") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestListForDir(t *testing.T) {
	baseDir := t.TempDir()
	dir := "/tmp/proj"

	// String content, plus a leading "<command>"-style user message that must be skipped.
	oldest := writeTranscript(t, baseDir, dir, "11111111-1111-4111-8111-111111111111.jsonl", []string{
		`{"type":"user","cwd":"/tmp/proj","message":{"content":"<command-name>/clear</command-name>"}}`,
		`{"type":"user","cwd":"/tmp/proj","message":{"content":"fix the login bug"}}`,
	})

	// Blocks-array content.
	newest := writeTranscript(t, baseDir, dir, "22222222-2222-4222-8222-222222222222.jsonl", []string{
		`{"type":"last-prompt","value":"x"}`,
		`{"type":"user","cwd":"/tmp/proj","message":{"content":[{"type":"text","text":"add dark mode"}]}}`,
	})

	// cwd mismatch (slug collision) — must be skipped.
	writeTranscript(t, baseDir, dir, "33333333-3333-4333-8333-333333333333.jsonl", []string{
		`{"type":"user","cwd":"/tmp/proj2","message":{"content":"wrong dir"}}`,
	})

	// Non-UUID filename — must be skipped.
	writeTranscript(t, baseDir, dir, "notes.jsonl", []string{
		`{"type":"user","cwd":"/tmp/proj","message":{"content":"not a session"}}`,
	})

	// Pin mtimes so the ordering assertion is deterministic.
	now := time.Now()
	if err := os.Chtimes(oldest, now.Add(-time.Hour), now.Add(-time.Hour)); err != nil {
		t.Fatalf("failed to set mtime: %v", err)
	}
	if err := os.Chtimes(newest, now, now); err != nil {
		t.Fatalf("failed to set mtime: %v", err)
	}

	ts := claudeTranscripts{baseDir: baseDir}
	sessions, err := ts.listForDir(dir)
	if err != nil {
		t.Fatalf("listForDir failed: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("listForDir returned %d sessions, want 2", len(sessions))
	}
	if sessions[0].ID != "22222222-2222-4222-8222-222222222222" {
		t.Errorf("expected newest session first, got %s", sessions[0].ID)
	}
	if sessions[0].FirstMessage != "add dark mode" {
		t.Errorf("blocks-array first message = %q, want %q", sessions[0].FirstMessage, "add dark mode")
	}
	if sessions[1].FirstMessage != "fix the login bug" {
		t.Errorf("string first message = %q, want %q", sessions[1].FirstMessage, "fix the login bug")
	}
	for _, sess := range sessions {
		if sess.Cwd != dir {
			t.Errorf("session %s cwd = %q, want %q", sess.ID, sess.Cwd, dir)
		}
		if sess.SizeBytes <= 0 {
			t.Errorf("session %s has no size", sess.ID)
		}
	}

	// Missing slug dir → empty list, not an error.
	empty, err := ts.listForDir("/nowhere/else")
	if err != nil {
		t.Fatalf("listForDir for missing dir failed: %v", err)
	}
	if len(empty) != 0 {
		t.Errorf("expected empty list for missing slug dir, got %d", len(empty))
	}
}

func TestTruncateRunes(t *testing.T) {
	long := strings.Repeat("é", 200)
	got := truncateRunes(long, firstMessageMaxRunes)
	if len([]rune(got)) != firstMessageMaxRunes {
		t.Errorf("truncateRunes length = %d runes, want %d", len([]rune(got)), firstMessageMaxRunes)
	}
	if truncateRunes("short", firstMessageMaxRunes) != "short" {
		t.Error("truncateRunes should not change short strings")
	}
}
