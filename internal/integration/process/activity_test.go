package process

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestActivityTracker_BusyLatch(t *testing.T) {
	tracker := &activityTracker{}
	t0 := time.Now()

	// A small chunk does not latch busy.
	tracker.recordOutput([]byte("tick"), t0)
	if got := tracker.snapshot(t0); got.Busy {
		t.Fatalf("small chunk latched busy: %+v", got)
	}

	// A large chunk latches busy, and the latch holds while output is recent.
	tracker.recordOutput(bytes.Repeat([]byte("x"), activityBusyChunkBytes), t0.Add(time.Second))
	if got := tracker.snapshot(t0.Add(2 * time.Second)); !got.Busy {
		t.Fatalf("large chunk did not latch busy: %+v", got)
	}
	if got := tracker.snapshot(t0.Add(1*time.Second + activityBusyQuiet - time.Millisecond)); !got.Busy {
		t.Fatalf("busy released before the quiet period elapsed: %+v", got)
	}

	// After the quiet period the latch releases lazily and stamps busyClearedAt.
	releaseAt := t0.Add(1*time.Second + activityBusyQuiet)
	got := tracker.snapshot(releaseAt)
	if got.Busy {
		t.Fatalf("busy did not release after quiet period: %+v", got)
	}
	if !got.BusyClearedAt.Equal(releaseAt) {
		t.Fatalf("busyClearedAt = %v, want %v", got.BusyClearedAt, releaseAt)
	}

	// New large output re-latches.
	tracker.recordOutput(bytes.Repeat([]byte("y"), activityBusyChunkBytes+50), releaseAt.Add(time.Second))
	if got := tracker.snapshot(releaseAt.Add(time.Second)); !got.Busy {
		t.Fatalf("busy did not re-latch on new output: %+v", got)
	}
}

func TestActivityTracker_TailStrippedAndCapped(t *testing.T) {
	tracker := &activityTracker{}
	now := time.Now()

	// ANSI is stripped, including a CSI sequence split across two chunks.
	tracker.recordOutput([]byte("\x1b[3"), now)
	tracker.recordOutput([]byte("1mready\x1b[0m\n"), now)
	if got := tracker.snapshot(now); string(got.Tail) != "ready\n" {
		t.Fatalf("tail = %q, want %q", got.Tail, "ready\n")
	}

	// The tail is capped to the last activityTailCap bytes.
	tracker.recordOutput([]byte(strings.Repeat("a", activityTailCap)), now)
	tracker.recordOutput([]byte("THE-END"), now)
	got := tracker.snapshot(now)
	if len(got.Tail) != activityTailCap {
		t.Fatalf("tail length = %d, want %d", len(got.Tail), activityTailCap)
	}
	if !strings.HasSuffix(string(got.Tail), "THE-END") {
		t.Fatalf("tail does not end with the newest output: %q", got.Tail[len(got.Tail)-20:])
	}
}

func TestActivityTracker_UserInputAndOutputTimes(t *testing.T) {
	tracker := &activityTracker{}
	t0 := time.Now()

	tracker.recordOutput([]byte("out"), t0)
	tracker.recordUserInput(t0.Add(time.Second))

	got := tracker.snapshot(t0.Add(2 * time.Second))
	if !got.LastOutputAt.Equal(t0) {
		t.Fatalf("lastOutputAt = %v, want %v", got.LastOutputAt, t0)
	}
	if !got.LastUserInputAt.Equal(t0.Add(time.Second)) {
		t.Fatalf("lastUserInputAt = %v, want %v", got.LastUserInputAt, t0.Add(time.Second))
	}
}
