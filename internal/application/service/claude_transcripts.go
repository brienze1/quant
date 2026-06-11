package service

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/google/uuid"

	"quant/internal/domain/entity"
)

const (
	// transcriptScanLimit caps how many leading lines are scanned for metadata —
	// the cwd and first user message always appear near the top.
	transcriptScanLimit = 100

	// transcriptMaxLineSize is the scanner buffer cap. Transcript lines can be
	// huge (full tool outputs are inlined), far beyond bufio's 64KB default.
	transcriptMaxLineSize = 10 * 1024 * 1024

	// maxAdoptableSessions caps how many transcripts listForDir returns.
	maxAdoptableSessions = 50

	// firstMessageMaxRunes is the truncation length for the first-message preview.
	firstMessageMaxRunes = 140
)

// claudeTranscripts reads claude CLI transcript files stored under
// <baseDir>/<project-slug>/<session-uuid>.jsonl. baseDir is injectable for tests.
type claudeTranscripts struct {
	baseDir string
}

// newClaudeTranscripts returns a transcript store rooted at ~/.claude/projects.
func newClaudeTranscripts() claudeTranscripts {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return claudeTranscripts{}
	}
	return claudeTranscripts{baseDir: filepath.Join(homeDir, ".claude", "projects")}
}

// projectSlug converts an absolute directory path into the directory name the
// claude CLI uses under ~/.claude/projects: every rune that is not an ASCII
// letter or digit becomes '-'.
func projectSlug(dir string) string {
	var b strings.Builder
	b.Grow(len(dir))
	for _, r := range dir {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	return b.String()
}

// transcriptLine is the minimal shape of a transcript jsonl line.
type transcriptLine struct {
	Type    string          `json:"type"`
	Cwd     string          `json:"cwd"`
	Message json.RawMessage `json:"message"`
}

// messageText extracts the text of a transcript message: content is either a
// plain string or an array of blocks like {type:"text", text:"..."}.
func messageText(raw json.RawMessage) string {
	var msg struct {
		Content json.RawMessage `json:"content"`
	}
	if json.Unmarshal(raw, &msg) != nil || len(msg.Content) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(msg.Content, &s) == nil {
		return s
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(msg.Content, &blocks) == nil {
		for _, b := range blocks {
			if b.Type == "text" && b.Text != "" {
				return b.Text
			}
		}
	}
	return ""
}

// truncateRunes shortens s to at most n runes.
func truncateRunes(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n])
}

// scanTranscript reads the leading lines of a transcript and returns the first
// non-empty cwd and the first real user message text. Messages whose text
// starts with "<" are skipped — those are command/caveat wrapper entries, not
// what the user typed.
func (t claudeTranscripts) scanTranscript(path string) (cwd string, firstMessage string, err error) {
	f, err := os.Open(path)
	if err != nil {
		return "", "", fmt.Errorf("failed to open transcript: %w", err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), transcriptMaxLineSize)
	for i := 0; i < transcriptScanLimit && scanner.Scan(); i++ {
		var line transcriptLine
		if json.Unmarshal(scanner.Bytes(), &line) != nil {
			continue
		}
		if cwd == "" && line.Cwd != "" {
			cwd = line.Cwd
		}
		if firstMessage == "" && line.Type == "user" {
			text := strings.TrimSpace(messageText(line.Message))
			if text != "" && !strings.HasPrefix(text, "<") {
				firstMessage = text
			}
		}
		if cwd != "" && firstMessage != "" {
			break
		}
	}
	if scanErr := scanner.Err(); scanErr != nil && cwd == "" {
		return "", "", fmt.Errorf("failed to read transcript: %w", scanErr)
	}
	if cwd == "" {
		return "", "", fmt.Errorf("no cwd found in transcript %s", filepath.Base(path))
	}
	return cwd, firstMessage, nil
}

// transcriptCwd returns the working directory recorded in a transcript file.
func (t claudeTranscripts) transcriptCwd(path string) (string, error) {
	cwd, _, err := t.scanTranscript(path)
	return cwd, err
}

// findByID locates a transcript by claude session UUID across all project slugs
// and returns its path and recorded cwd.
func (t claudeTranscripts) findByID(id string) (path string, cwd string, err error) {
	matches, err := filepath.Glob(filepath.Join(t.baseDir, "*", id+".jsonl"))
	if err != nil {
		return "", "", fmt.Errorf("failed to search claude transcripts: %w", err)
	}
	if len(matches) == 0 {
		return "", "", fmt.Errorf("no claude session %s found on this machine", id)
	}
	cwd, err = t.transcriptCwd(matches[0])
	if err != nil {
		return "", "", err
	}
	return matches[0], cwd, nil
}

// listForDir returns the claude sessions recorded for a working directory,
// newest first, capped at maxAdoptableSessions. A missing slug directory means
// no sessions, not an error.
func (t claudeTranscripts) listForDir(dir string) ([]entity.ExternalClaudeSession, error) {
	slugDir := filepath.Join(t.baseDir, projectSlug(dir))
	entries, err := os.ReadDir(slugDir)
	if os.IsNotExist(err) {
		return []entity.ExternalClaudeSession{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read claude project directory: %w", err)
	}

	sessions := []entity.ExternalClaudeSession{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".jsonl")
		if _, parseErr := uuid.Parse(id); parseErr != nil {
			continue
		}
		cwd, firstMessage, scanErr := t.scanTranscript(filepath.Join(slugDir, e.Name()))
		// The slug is lossy, so only transcripts whose recorded cwd matches exactly count.
		if scanErr != nil || cwd != dir {
			continue
		}
		info, infoErr := e.Info()
		if infoErr != nil {
			continue
		}
		sessions = append(sessions, entity.ExternalClaudeSession{
			ID:           id,
			Cwd:          cwd,
			FirstMessage: truncateRunes(firstMessage, firstMessageMaxRunes),
			ModTime:      info.ModTime(),
			SizeBytes:    info.Size(),
		})
	}

	sort.Slice(sessions, func(i, j int) bool { return sessions[i].ModTime.After(sessions[j].ModTime) })
	if len(sessions) > maxAdoptableSessions {
		sessions = sessions[:maxAdoptableSessions]
	}
	return sessions, nil
}
