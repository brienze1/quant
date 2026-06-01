package remote

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"runtime"
	"sync"
)

// errCloudflaredMissing is returned by tunnelManager.start when the cloudflared
// binary cannot be located on the host.
var errCloudflaredMissing = errors.New("cloudflared not installed")

var trycloudflareRe = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

// cloudflaredBin is the executable name for the current OS.
func cloudflaredBin() string {
	if runtime.GOOS == "windows" {
		return "cloudflared.exe"
	}
	return "cloudflared"
}

// cloudflaredCandidates returns common install locations to probe in addition
// to a normal PATH lookup (covers brew/winget/scoop layouts).
func cloudflaredCandidates() []string {
	if runtime.GOOS == "windows" {
		return []string{
			`C:\Program Files\cloudflared\cloudflared.exe`,
			`C:\Program Files (x86)\cloudflared\cloudflared.exe`,
		}
	}
	return []string{
		"/opt/homebrew/bin/cloudflared",
		"/usr/local/bin/cloudflared",
		"/usr/bin/cloudflared",
	}
}

// findCloudflared resolves the cloudflared binary, returning its path and
// whether it was found. Cross-platform: PATH first, then common locations.
func findCloudflared() (string, bool) {
	if p, err := exec.LookPath(cloudflaredBin()); err == nil {
		return p, true
	}
	for _, c := range cloudflaredCandidates() {
		if p, err := exec.LookPath(c); err == nil {
			return p, true
		}
	}
	return "", false
}

// tunnelManager runs `cloudflared tunnel --url http://127.0.0.1:<port>` and
// scrapes the public *.trycloudflare.com URL from its output.
type tunnelManager struct {
	mu     sync.Mutex
	cmd    *exec.Cmd
	cancel context.CancelFunc
	url    string
	onURL  func(string)
}

func newTunnelManager() *tunnelManager { return &tunnelManager{} }

// start launches the tunnel for the given local port. onURL is invoked once the
// public URL is discovered. Returns errCloudflaredMissing if cloudflared is not
// installed.
func (t *tunnelManager) start(port int, onURL func(string)) error {
	bin, ok := findCloudflared()
	if !ok {
		return errCloudflaredMissing
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cmd != nil {
		return nil // already running
	}

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, bin,
		"tunnel", "--no-autoupdate",
		"--url", fmt.Sprintf("http://127.0.0.1:%d", port),
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return err
	}
	if err := cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("failed to start cloudflared: %w", err)
	}

	t.cmd = cmd
	t.cancel = cancel
	t.onURL = onURL

	// cloudflared prints the banner with the URL to stderr; scan both streams.
	go t.scan(stdout)
	go t.scan(stderr)
	go func() { _ = cmd.Wait() }()
	return nil
}

func (t *tunnelManager) scan(r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		if m := trycloudflareRe.FindString(sc.Text()); m != "" {
			t.mu.Lock()
			t.url = m
			cb := t.onURL
			t.mu.Unlock()
			if cb != nil {
				cb(m)
			}
		}
	}
}

// stop terminates the cloudflared child process.
func (t *tunnelManager) stop() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cancel != nil {
		t.cancel()
	}
	if t.cmd != nil && t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
	}
	t.cmd = nil
	t.cancel = nil
	t.url = ""
}
