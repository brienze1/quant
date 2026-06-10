package service

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"quant/internal/domain/entity"
)

// stubFindSession implements usecase.FindSession over a single fixed session
// rooted at dir.
type stubFindSession struct {
	dir string
}

func (s *stubFindSession) FindByID(id string) (*entity.Session, error) {
	if id == "missing" {
		return nil, nil
	}
	return &entity.Session{ID: id, Directory: s.dir}, nil
}

func (s *stubFindSession) FindAll() ([]entity.Session, error)            { return nil, nil }
func (s *stubFindSession) FindByRepoID(string) ([]entity.Session, error) { return nil, nil }
func (s *stubFindSession) FindByTaskID(string) ([]entity.Session, error) { return nil, nil }

// captureEmitter records emitted events for assertions.
type captureEmitter struct {
	names    []string
	payloads []any
}

func (e *captureEmitter) Emit(name string, payload any) {
	e.names = append(e.names, name)
	e.payloads = append(e.payloads, payload)
}

// newTestFileService creates a file service sandboxed to a fresh temp dir.
func newTestFileService(t *testing.T) (*fileManagerService, string, *captureEmitter) {
	t.Helper()
	dir := t.TempDir()
	emitter := &captureEmitter{}
	svc := NewFileManagerService(&stubFindSession{dir: dir}, emitter).(*fileManagerService)
	return svc, dir, emitter
}

func TestNormalizeRelPath(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "empty is root", input: "", want: "."},
		{name: "dot is root", input: ".", want: "."},
		{name: "simple", input: "a/b.txt", want: "a/b.txt"},
		{name: "cleans dot segments", input: "a/./b", want: "a/b"},
		{name: "cleans internal dotdot", input: "a/b/../c", want: "a/c"},
		{name: "windows separators", input: `a\b.txt`, want: "a/b.txt"},
		{name: "trailing slash", input: "a/b/", want: "a/b"},
		{name: "parent escape", input: "../x", wantErr: true},
		{name: "nested escape", input: "a/../../x", wantErr: true},
		{name: "bare dotdot", input: "..", wantErr: true},
		{name: "windows parent escape", input: `..\x`, wantErr: true},
		{name: "absolute", input: "/etc/passwd", wantErr: true},
		{name: "windows drive", input: `C:\x`, wantErr: true},
		{name: "windows drive forward slash", input: "C:/x", wantErr: true},
		{name: "unc path", input: `\\server\share\x`, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeRelPath(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("normalizeRelPath(%q) = %q, want error", tt.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeRelPath(%q) returned error: %v", tt.input, err)
			}
			if filepath.ToSlash(got) != tt.want {
				t.Fatalf("normalizeRelPath(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestFileServiceCRUDRoundTrip(t *testing.T) {
	svc, dir, emitter := newTestFileService(t)

	if err := svc.CreateDir("s1", "a/b"); err != nil {
		t.Fatalf("CreateDir: %v", err)
	}
	if err := svc.CreateFile("s1", "a/b/file.txt"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}
	if err := svc.CreateFile("s1", "a/b/file.txt"); err == nil {
		t.Fatal("CreateFile on existing file should error")
	}
	if err := svc.WriteFile("s1", "a/b/file.txt", "hello"); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	content, err := svc.ReadFile("s1", "a/b/file.txt")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if content.Content != "hello" || content.Size != 5 || content.Binary || content.TooLarge {
		t.Fatalf("ReadFile = %+v, want content 'hello'", content)
	}

	if err := svc.RenamePath("s1", "a/b/file.txt", "a/renamed.txt"); err != nil {
		t.Fatalf("RenamePath: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "a", "renamed.txt")); err != nil {
		t.Fatalf("renamed file missing on disk: %v", err)
	}

	if err := svc.DeletePath("s1", "a/renamed.txt", false); err != nil {
		t.Fatalf("DeletePath: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "a", "renamed.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("deleted file still exists, stat err: %v", err)
	}

	// Every successful mutation must emit a files:changed event. The rename
	// crosses parent directories, so it emits once per affected parent.
	wantEvents := 6 // mkdir, create, write, rename (old + new parent), delete
	if len(emitter.names) != wantEvents {
		t.Fatalf("emitted %d events, want %d: %v", len(emitter.names), wantEvents, emitter.names)
	}
	for _, name := range emitter.names {
		if name != "files:changed" {
			t.Fatalf("unexpected event name: %s", name)
		}
	}
}

func TestFileServiceListDir(t *testing.T) {
	svc, dir, _ := newTestFileService(t)

	if err := os.MkdirAll(filepath.Join(dir, "Zeta"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"beta.txt", "Alpha.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	entries, err := svc.ListDir("s1", "")
	if err != nil {
		t.Fatalf("ListDir: %v", err)
	}

	var got []string
	for _, e := range entries {
		got = append(got, e.Name)
	}
	want := []string{"Zeta", "Alpha.txt", "beta.txt"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("ListDir order = %v, want %v (dirs first, case-insensitive)", got, want)
	}
	for _, e := range entries {
		if strings.Contains(e.Path, "\\") {
			t.Fatalf("entry path %q must be slash-separated", e.Path)
		}
	}

	// Empty directory returns an empty slice, never nil.
	empty, err := svc.ListDir("s1", "Zeta")
	if err != nil {
		t.Fatalf("ListDir empty: %v", err)
	}
	if empty == nil {
		t.Fatal("ListDir of empty dir returned nil, want empty slice")
	}
	if len(empty) != 0 {
		t.Fatalf("ListDir of empty dir = %v, want empty", empty)
	}
}

func TestFileServiceEscapesRejected(t *testing.T) {
	svc, _, _ := newTestFileService(t)

	if _, err := svc.ListDir("s1", "../"); err == nil {
		t.Fatal("ListDir escape should error")
	}
	if _, err := svc.ReadFile("s1", "../../etc/passwd"); err == nil {
		t.Fatal("ReadFile escape should error")
	}
	if err := svc.WriteFile("s1", "../x", "boom"); err == nil {
		t.Fatal("WriteFile escape should error")
	}
}

func TestFileServiceSymlinkEscapeRejected(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation requires elevated privileges on Windows")
	}

	svc, dir, _ := newTestFileService(t)

	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.ReadFile("s1", "link/secret.txt"); err == nil {
		t.Fatal("ReadFile through escaping symlink should error")
	}
	if _, err := svc.ListDir("s1", "link"); err == nil {
		t.Fatal("ListDir through escaping symlink should error")
	}
}

func TestFileServiceReadFileTooLarge(t *testing.T) {
	svc, dir, _ := newTestFileService(t)

	big := make([]byte, maxFileReadBytes+1)
	if err := os.WriteFile(filepath.Join(dir, "big.bin"), big, 0o644); err != nil {
		t.Fatal(err)
	}

	content, err := svc.ReadFile("s1", "big.bin")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !content.TooLarge {
		t.Fatal("ReadFile of >2MiB file should report TooLarge")
	}
	if content.Content != "" {
		t.Fatal("TooLarge content should be empty")
	}
	if content.Size != int64(len(big)) {
		t.Fatalf("TooLarge size = %d, want %d", content.Size, len(big))
	}
}

func TestFileServiceReadFileBinary(t *testing.T) {
	svc, dir, _ := newTestFileService(t)

	if err := os.WriteFile(filepath.Join(dir, "data.bin"), []byte("abc\x00def"), 0o644); err != nil {
		t.Fatal(err)
	}

	content, err := svc.ReadFile("s1", "data.bin")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !content.Binary {
		t.Fatal("ReadFile of NUL-containing file should report Binary")
	}
	if content.Content != "" {
		t.Fatal("binary content should be empty")
	}
}

func TestFileServiceDeleteRootRejected(t *testing.T) {
	svc, _, _ := newTestFileService(t)

	if err := svc.DeletePath("s1", ".", true); err == nil {
		t.Fatal("DeletePath of '.' should error")
	}
	if err := svc.DeletePath("s1", "", true); err == nil {
		t.Fatal("DeletePath of empty path should error")
	}
}

func TestFileServiceNonRecursiveDeleteOfNonEmptyDirFails(t *testing.T) {
	svc, _, _ := newTestFileService(t)

	if err := svc.CreateDir("s1", "full"); err != nil {
		t.Fatal(err)
	}
	if err := svc.CreateFile("s1", "full/keep.txt"); err != nil {
		t.Fatal(err)
	}

	if err := svc.DeletePath("s1", "full", false); err == nil {
		t.Fatal("non-recursive delete of non-empty dir should error")
	}
	if err := svc.DeletePath("s1", "full", true); err != nil {
		t.Fatalf("recursive delete should succeed: %v", err)
	}
}

func TestFileServiceRenameRejections(t *testing.T) {
	svc, _, _ := newTestFileService(t)

	if err := svc.CreateFile("s1", "a.txt"); err != nil {
		t.Fatal(err)
	}
	if err := svc.CreateFile("s1", "b.txt"); err != nil {
		t.Fatal(err)
	}

	if err := svc.RenamePath("s1", "a.txt", "b.txt"); err == nil {
		t.Fatal("RenamePath onto existing destination should error")
	}
	if err := svc.RenamePath("s1", ".", "c"); err == nil {
		t.Fatal("RenamePath of '.' should error")
	}
	if err := svc.RenamePath("s1", "a.txt", "."); err == nil {
		t.Fatal("RenamePath to '.' should error")
	}
}

func TestFileServiceSessionNotFound(t *testing.T) {
	svc, _, _ := newTestFileService(t)

	if _, err := svc.ListDir("missing", ""); err == nil {
		t.Fatal("ListDir for unknown session should error")
	}
}
