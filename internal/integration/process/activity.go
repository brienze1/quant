package process

import (
	"sync"
	"time"

	"quant/internal/domain/entity"
)

// activityBusyChunkBytes marks the process busy when a single output chunk is
// at least this large (a working CLI streams big re-renders; an idle prompt
// only trickles small cursor updates).
const activityBusyChunkBytes = 100

// activityBusyQuiet is the quiet period after which the busy latch releases.
// The release is computed lazily at query time, not by a timer.
const activityBusyQuiet = 5 * time.Second

// activityTailCap caps the ANSI-stripped output tail kept for marker scanning.
const activityTailCap = 4 * 1024

// activityTracker records per-spawn PTY activity for idle detection. It lives
// on claudeProcess, so a respawn starts with a fresh tracker for free. The read
// loop writes and the crew drainer queries concurrently — hence the mutex.
type activityTracker struct {
	mu              sync.Mutex
	lastOutputAt    time.Time
	busy            bool
	busyClearedAt   time.Time
	lastUserInputAt time.Time
	tail            []byte
	ansi            ansiState
}

// recordOutput registers an output chunk: it stamps lastOutputAt, appends the
// ANSI-stripped bytes to the capped tail, and latches busy for large chunks.
func (t *activityTracker) recordOutput(chunk []byte, now time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.lastOutputAt = now
	if len(chunk) >= activityBusyChunkBytes {
		t.busy = true
	}

	stripped, next := stripANSI(chunk, t.ansi)
	t.ansi = next
	t.tail = append(t.tail, stripped...)
	if len(t.tail) > activityTailCap {
		t.tail = t.tail[len(t.tail)-activityTailCap:]
	}
}

// recordUserInput stamps lastUserInputAt.
func (t *activityTracker) recordUserInput(now time.Time) {
	t.mu.Lock()
	t.lastUserInputAt = now
	t.mu.Unlock()
}

// snapshot returns the current activity, releasing the busy latch lazily when
// the process has been quiet long enough.
func (t *activityTracker) snapshot(now time.Time) entity.ProcessActivity {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.busy && now.Sub(t.lastOutputAt) >= activityBusyQuiet {
		t.busy = false
		t.busyClearedAt = now
	}

	tail := make([]byte, len(t.tail))
	copy(tail, t.tail)

	return entity.ProcessActivity{
		LastOutputAt:    t.lastOutputAt,
		Busy:            t.busy,
		BusyClearedAt:   t.busyClearedAt,
		LastUserInputAt: t.lastUserInputAt,
		Tail:            tail,
	}
}
