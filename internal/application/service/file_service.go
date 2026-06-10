// Package service contains application service implementations.
package service

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"quant/internal/application/adapter"
	"quant/internal/application/usecase"
	"quant/internal/domain/entity"
)

// maxFileReadBytes caps ReadFile at 2 MiB; larger files are reported as TooLarge.
const maxFileReadBytes = 2 << 20

// binarySniffBytes is how many leading bytes are scanned for a NUL byte to
// classify a file as binary (same heuristic git uses).
const binarySniffBytes = 8000

// fileManagerService implements the adapter.FileManager interface.
// All operations are sandboxed to the session's working directory via os.Root,
// which blocks ".." and symlink escapes at the kernel level.
type fileManagerService struct {
	findSession usecase.FindSession
	emitter     adapter.EventEmitter
}

// NewFileManagerService creates a new file manager service.
func NewFileManagerService(findSession usecase.FindSession, emitter adapter.EventEmitter) adapter.FileManager {
	return &fileManagerService{
		findSession: findSession,
		emitter:     emitter,
	}
}

// normalizeRelPath lexically validates a client-supplied relative path and
// returns it cleaned, using the native separator. Backslashes are treated as
// separators on every platform so Windows-style payloads (`..\..`, `C:\x`,
// UNC) are rejected on POSIX hosts too. The empty path normalizes to "."
// (the session root). This is a pre-check only; os.Root enforces the real
// sandbox at the kernel level.
func normalizeRelPath(relPath string) (string, error) {
	slashed := strings.ReplaceAll(relPath, `\`, "/")
	if strings.HasPrefix(slashed, "/") {
		return "", fmt.Errorf("absolute paths are not allowed: %q", relPath)
	}

	native := filepath.FromSlash(slashed)
	if filepath.IsAbs(native) || filepath.VolumeName(native) != "" || isWindowsDrivePath(slashed) {
		return "", fmt.Errorf("absolute paths are not allowed: %q", relPath)
	}

	cleaned := filepath.Clean(native)
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path escapes the session directory: %q", relPath)
	}

	return cleaned, nil
}

// isWindowsDrivePath reports whether a slash-normalized path starts with a
// Windows drive letter (e.g. "C:"), which filepath.VolumeName only detects on
// Windows hosts.
func isWindowsDrivePath(slashed string) bool {
	if len(slashed) < 2 || slashed[1] != ':' {
		return false
	}
	c := slashed[0]
	return ('a' <= c && c <= 'z') || ('A' <= c && c <= 'Z')
}

// sessionRoot resolves a session and opens its working directory as an os.Root.
// The caller must Close the returned root.
func (s *fileManagerService) sessionRoot(sessionID string) (*os.Root, error) {
	session, err := s.findSession.FindByID(sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to find session: %w", err)
	}
	if session == nil {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	root, err := os.OpenRoot(getWorkDir(session))
	if err != nil {
		return nil, fmt.Errorf("failed to open session directory: %w", err)
	}
	return root, nil
}

// parentDir returns the slash-separated parent directory of a normalized
// relative path, with "" for entries at the session root.
func parentDir(rel string) string {
	dir := path.Dir(filepath.ToSlash(rel))
	if dir == "." || dir == "/" {
		return ""
	}
	return dir
}

// emitChanged notifies the frontend that a directory's contents changed.
func (s *fileManagerService) emitChanged(sessionID, parentRel, op string) {
	if s.emitter == nil {
		return
	}

	s.emitter.Emit("files:changed", map[string]any{
		"sessionId": sessionID,
		"path":      parentRel,
		"op":        op,
	})
}

// ListDir returns the entries of a single directory level, directories first,
// then case-insensitive by name. Hidden files (including .git) are included.
func (s *fileManagerService) ListDir(sessionID, relPath string) ([]entity.FileEntry, error) {
	rel, err := normalizeRelPath(relPath)
	if err != nil {
		return nil, err
	}

	root, err := s.sessionRoot(sessionID)
	if err != nil {
		return nil, err
	}
	defer root.Close()

	dir, err := root.Open(rel)
	if err != nil {
		return nil, fmt.Errorf("failed to open directory %s: %w", relPath, err)
	}
	defer dir.Close()

	entries, err := dir.ReadDir(-1)
	if err != nil {
		return nil, fmt.Errorf("failed to list directory %s: %w", relPath, err)
	}

	result := make([]entity.FileEntry, 0, len(entries))
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			// Entry vanished between ReadDir and Info — skip it.
			continue
		}
		result = append(result, entity.FileEntry{
			Name:    e.Name(),
			Path:    filepath.ToSlash(filepath.Join(rel, e.Name())),
			IsDir:   e.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime(),
		})
	}

	sort.SliceStable(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})

	return result, nil
}

// ReadFile reads a file's content, capped at 2 MiB. Files larger than the cap
// are reported as TooLarge and files with a NUL in the first 8000 bytes as
// Binary; in both cases Content is empty.
func (s *fileManagerService) ReadFile(sessionID, relPath string) (entity.FileContent, error) {
	rel, err := normalizeRelPath(relPath)
	if err != nil {
		return entity.FileContent{}, err
	}

	root, err := s.sessionRoot(sessionID)
	if err != nil {
		return entity.FileContent{}, err
	}
	defer root.Close()

	info, err := root.Stat(rel)
	if err != nil {
		return entity.FileContent{}, fmt.Errorf("failed to stat file %s: %w", relPath, err)
	}
	if info.IsDir() {
		return entity.FileContent{}, fmt.Errorf("path is a directory: %s", relPath)
	}
	if info.Size() > maxFileReadBytes {
		return entity.FileContent{Size: info.Size(), TooLarge: true}, nil
	}

	data, err := root.ReadFile(rel)
	if err != nil {
		return entity.FileContent{}, fmt.Errorf("failed to read file %s: %w", relPath, err)
	}

	sniff := data
	if len(sniff) > binarySniffBytes {
		sniff = sniff[:binarySniffBytes]
	}
	if bytes.IndexByte(sniff, 0) >= 0 {
		return entity.FileContent{Size: int64(len(data)), Binary: true}, nil
	}

	return entity.FileContent{Content: string(data), Size: int64(len(data))}, nil
}

// WriteFile writes content to an existing or new file. The parent directory
// must already exist.
func (s *fileManagerService) WriteFile(sessionID, relPath, content string) error {
	rel, err := normalizeRelPath(relPath)
	if err != nil {
		return err
	}

	root, err := s.sessionRoot(sessionID)
	if err != nil {
		return err
	}
	defer root.Close()

	if err := root.WriteFile(rel, []byte(content), 0o644); err != nil {
		return fmt.Errorf("failed to write file %s: %w", relPath, err)
	}

	s.emitChanged(sessionID, parentDir(rel), "write")

	return nil
}

// CreateFile creates a new empty file, erroring if it already exists.
func (s *fileManagerService) CreateFile(sessionID, relPath string) error {
	rel, err := normalizeRelPath(relPath)
	if err != nil {
		return err
	}

	root, err := s.sessionRoot(sessionID)
	if err != nil {
		return err
	}
	defer root.Close()

	f, err := root.OpenFile(rel, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return fmt.Errorf("failed to create file %s: %w", relPath, err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("failed to create file %s: %w", relPath, err)
	}

	s.emitChanged(sessionID, parentDir(rel), "create")

	return nil
}

// CreateDir creates a directory, including any missing parents.
func (s *fileManagerService) CreateDir(sessionID, relPath string) error {
	rel, err := normalizeRelPath(relPath)
	if err != nil {
		return err
	}

	root, err := s.sessionRoot(sessionID)
	if err != nil {
		return err
	}
	defer root.Close()

	if err := root.MkdirAll(rel, 0o755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", relPath, err)
	}

	s.emitChanged(sessionID, parentDir(rel), "mkdir")

	return nil
}

// RenamePath renames or moves a file/directory within the session directory.
// It refuses to overwrite an existing destination (uniform behavior across
// POSIX and Windows) and refuses to rename the session root itself.
func (s *fileManagerService) RenamePath(sessionID, oldRelPath, newRelPath string) error {
	oldRel, err := normalizeRelPath(oldRelPath)
	if err != nil {
		return err
	}
	newRel, err := normalizeRelPath(newRelPath)
	if err != nil {
		return err
	}
	if oldRel == "." || newRel == "." {
		return errors.New("cannot rename the session root")
	}

	root, err := s.sessionRoot(sessionID)
	if err != nil {
		return err
	}
	defer root.Close()

	if _, err := root.Lstat(newRel); err == nil {
		return fmt.Errorf("destination already exists: %s", newRelPath)
	} else if !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("failed to stat destination %s: %w", newRelPath, err)
	}

	if err := root.Rename(oldRel, newRel); err != nil {
		return fmt.Errorf("failed to rename %s to %s: %w", oldRelPath, newRelPath, err)
	}

	s.emitChanged(sessionID, parentDir(oldRel), "rename")
	if newParent := parentDir(newRel); newParent != parentDir(oldRel) {
		s.emitChanged(sessionID, newParent, "rename")
	}

	return nil
}

// DeletePath permanently deletes a file or directory. Non-recursive deletes
// use Remove (fails on non-empty directories); recursive deletes use
// RemoveAll. The session root itself cannot be deleted.
func (s *fileManagerService) DeletePath(sessionID, relPath string, recursive bool) error {
	rel, err := normalizeRelPath(relPath)
	if err != nil {
		return err
	}
	if rel == "." {
		return errors.New("cannot delete the session root")
	}

	root, err := s.sessionRoot(sessionID)
	if err != nil {
		return err
	}
	defer root.Close()

	if recursive {
		if err := root.RemoveAll(rel); err != nil {
			return fmt.Errorf("failed to delete %s: %w", relPath, err)
		}
	} else {
		if err := root.Remove(rel); err != nil {
			return fmt.Errorf("failed to delete %s: %w", relPath, err)
		}
	}

	s.emitChanged(sessionID, parentDir(rel), "delete")

	return nil
}
