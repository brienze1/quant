// Package entity contains domain entities representing core business objects.
package entity

import (
	"time"
)

// FileEntry represents a single entry in a directory listing of a session's
// working directory. Path is relative to the session root, slash-separated.
type FileEntry struct {
	Name    string
	Path    string
	IsDir   bool
	Size    int64
	ModTime time.Time
}

// FileContent represents the result of reading a file from a session's
// working directory. When TooLarge or Binary is set, Content is empty.
type FileContent struct {
	Content  string
	Size     int64
	TooLarge bool
	Binary   bool
}
