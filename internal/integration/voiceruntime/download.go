package voiceruntime

import (
	"archive/tar"
	"bytes"
	"compress/bzip2"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// progressFn reports installer progress to the UI. total may be 0 when unknown.
type progressFn func(phase string, done, total int64)

// downloadTimeout bounds one model archive download; the whisper archive is
// ~600 MB, so slow links need headroom.
const downloadTimeout = 30 * time.Minute

// downloadAndExtract streams one model archive to disk, verifies its sha256,
// and extracts it into the models dir (~/.quant/voice/models/). The upstream
// sherpa-onnx archives contain a single top-level directory matching
// ModelArtifact.Dir. It reports byte progress during the download and coarse
// phase progress during verify/extract.
func downloadAndExtract(a ModelArtifact, onProgress progressFn) error {
	if err := os.MkdirAll(downloadsDir(), 0o755); err != nil {
		return fmt.Errorf("create downloads dir: %w", err)
	}
	archivePath := filepath.Join(downloadsDir(), filepath.Base(a.Dir)+".archive")
	defer func() { _ = os.Remove(archivePath) }()

	if err := fetchTo(a, archivePath, onProgress); err != nil {
		return err
	}

	onProgress("verify", 0, 0)
	if err := verifySHA256(archivePath, a.SHA256); err != nil {
		return err
	}

	onProgress("extract", 0, 0)
	if err := extractArchive(archivePath, modelsDir()); err != nil {
		return fmt.Errorf("extract %s: %w", a.Name, err)
	}
	return nil
}

// fetchTo copies the artifact (http(s):// or a local path) to dst while
// reporting byte progress. total comes from Content-Length or the manifest Size.
func fetchTo(a ModelArtifact, dst string, onProgress progressFn) error {
	var (
		src   io.ReadCloser
		total = a.Size
	)
	if isHTTP(a.URL) {
		client := &http.Client{Timeout: downloadTimeout}
		resp, err := client.Get(a.URL)
		if err != nil {
			return fmt.Errorf("download %s: %w", a.Name, err)
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			_ = resp.Body.Close()
			return fmt.Errorf("download %s: unexpected HTTP %d", a.Name, resp.StatusCode)
		}
		if resp.ContentLength > 0 {
			total = resp.ContentLength
		}
		src = resp.Body
	} else {
		f, err := os.Open(a.URL)
		if err != nil {
			return fmt.Errorf("open model archive %q: %w", a.URL, err)
		}
		if fi, statErr := f.Stat(); statErr == nil && fi.Size() > 0 {
			total = fi.Size()
		}
		src = f
	}
	defer func() { _ = src.Close() }()

	out, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("create %q: %w", dst, err)
	}
	defer func() { _ = out.Close() }()

	pr := &progressReader{r: src, total: total, onProgress: onProgress}
	if _, err := io.Copy(out, pr); err != nil {
		return fmt.Errorf("write model archive: %w", err)
	}
	// Final 100% tick so the UI settles even if the throttle skipped the last read.
	onProgress("download", pr.done, total)
	return nil
}

// progressReader wraps a reader and emits throttled byte-progress (~every
// 250ms) as data flows through io.Copy.
type progressReader struct {
	r          io.Reader
	total      int64
	done       int64
	last       time.Time
	onProgress progressFn
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.done += int64(n)
	if p.onProgress != nil && time.Since(p.last) >= 250*time.Millisecond {
		p.last = time.Now()
		p.onProgress("download", p.done, p.total)
	}
	return n, err
}

// verifySHA256 compares the file's digest to want (lowercase hex). An empty
// want skips verification — used only by hand-rolled local test manifests;
// hosted artifacts always carry a checksum.
func verifySHA256(path, want string) error {
	if strings.TrimSpace(want) == "" {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	got := hex.EncodeToString(h.Sum(nil))
	if !strings.EqualFold(got, strings.TrimSpace(want)) {
		return fmt.Errorf("model archive checksum mismatch: got %s, want %s", got, want)
	}
	return nil
}

// extractArchive unpacks a tar archive compressed with bzip2 (the upstream
// sherpa-onnx model releases) or gzip (test fixtures / future hosting), into
// dest, rejecting path-traversal entries. Compression is sniffed from the
// file's magic bytes, so the archive name does not matter.
func extractArchive(archivePath, dest string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()

	magic := make([]byte, 3)
	if _, err := io.ReadFull(f, magic); err != nil {
		return fmt.Errorf("read archive header: %w", err)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}

	var decompressed io.Reader
	switch {
	case bytes.HasPrefix(magic, []byte{0x1f, 0x8b}): // gzip
		gz, gerr := gzip.NewReader(f)
		if gerr != nil {
			return gerr
		}
		defer func() { _ = gz.Close() }()
		decompressed = gz
	case bytes.HasPrefix(magic, []byte("BZh")): // bzip2
		decompressed = bzip2.NewReader(f)
	default:
		return fmt.Errorf("unsupported archive format (magic %x): want .tar.gz or .tar.bz2", magic)
	}

	tr := tar.NewReader(decompressed)
	cleanDest := filepath.Clean(dest)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		target, err := safeJoin(cleanDest, hdr.Name)
		if err != nil {
			return err
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			mode := os.FileMode(0o644)
			if hdr.FileInfo().Mode()&0o111 != 0 {
				mode = 0o755
			}
			if err := writeFile(target, tr, mode); err != nil {
				return err
			}
		case tar.TypeSymlink:
			// Model archives should be self-contained; skip symlinks rather than
			// risk escaping the install dir.
			continue
		}
	}
	return nil
}

func writeFile(target string, r io.Reader, mode os.FileMode) error {
	out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer func() { _ = out.Close() }()
	if _, err := io.Copy(out, r); err != nil {
		return err
	}
	return os.Chmod(target, mode)
}

// safeJoin joins dest and a tar entry name, refusing entries that escape dest.
func safeJoin(dest, name string) (string, error) {
	target := filepath.Join(dest, name)
	if target != dest && !strings.HasPrefix(target, dest+string(os.PathSeparator)) {
		return "", fmt.Errorf("unsafe path in archive: %q", name)
	}
	return target, nil
}
