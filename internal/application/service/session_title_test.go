package service

import (
	"sync"
	"testing"
	"time"

	"quant/internal/domain/entity"
	"quant/internal/domain/enums/sessiontype"
)

// recordingSpawn captures the messages typed into a session.
type recordingSpawn struct {
	mu   sync.Mutex
	sent []string
}

func (r *recordingSpawn) Spawn(string, string, string, string, string, bool, string, string, uint16, uint16, bool, string, string) (int, error) {
	return 0, nil
}
func (r *recordingSpawn) Stop(string) error                   { return nil }
func (r *recordingSpawn) Resize(string, uint16, uint16) error { return nil }
func (r *recordingSpawn) GetOutput(string) ([]byte, error)    { return nil, nil }

func (r *recordingSpawn) SendMessage(_ string, message string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sent = append(r.sent, message)
	return nil
}

func (r *recordingSpawn) messages() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.sent...)
}

// titleSessionFinder serves the one session under test.
type titleSessionFinder struct{ session entity.Session }

func (f titleSessionFinder) FindByID(string) (*entity.Session, error) {
	s := f.session
	return &s, nil
}
func (f titleSessionFinder) FindAll() ([]entity.Session, error)             { return nil, nil }
func (f titleSessionFinder) FindByRepoID(string) ([]entity.Session, error)  { return nil, nil }
func (f titleSessionFinder) FindByTaskID(string) ([]entity.Session, error)  { return nil, nil }
func (f titleSessionFinder) FindByMcpToken(string) (*entity.Session, error) { return nil, nil }

// titleRepoFinder serves the repo a session belongs to.
type titleRepoFinder struct{ repo *entity.Repo }

func (f titleRepoFinder) FindRepoByID(string) (*entity.Repo, error) { return f.repo, nil }
func (f titleRepoFinder) FindRepoByPathAndWorkspace(string, string) (*entity.Repo, error) {
	return nil, nil
}
func (f titleRepoFinder) FindAllRepos() ([]entity.Repo, error) { return nil, nil }
func (f titleRepoFinder) FindReposByWorkspace(string) ([]entity.Repo, error) {
	return nil, nil
}
func (f titleRepoFinder) FindClosedReposByWorkspace(string, int, int) ([]entity.Repo, error) {
	return nil, nil
}

// noopSessionUpdater satisfies the last-active bookkeeping SendMessage does.
type noopSessionUpdater struct{}

func (noopSessionUpdater) Update(entity.Session) error       { return nil }
func (noopSessionUpdater) UpdateStatus(string, string) error { return nil }

// readyActivity reports a CLI that rendered a while ago and is now quiet.
type readyActivity struct{ ready bool }

func (a readyActivity) Activity(string) (entity.ProcessActivity, bool) {
	if !a.ready {
		return entity.ProcessActivity{}, false
	}
	return entity.ProcessActivity{LastOutputAt: time.Now().Add(-10 * time.Second)}, true
}

func (a readyActivity) WriteInjected(string, string) error { return nil }

// waitForMessage polls until a message shows up, so the test does not depend on
// goroutine timing.
func waitForMessage(t *testing.T, spawn *recordingSpawn) []string {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if msgs := spawn.messages(); len(msgs) > 0 {
			// Give the submit keystroke a moment to land too.
			time.Sleep(submitKeyDelay * 2)
			return spawn.messages()
		}
		time.Sleep(10 * time.Millisecond)
	}
	return spawn.messages()
}

// TestSyncCliTitleRenamesTheCli verifies quant pushes its session name into the
// CLI once it is ready, so the title Remote Control shows on a phone matches
// the name the session has in quant.
func TestSyncCliTitleRenamesTheCli(t *testing.T) {
	session := entity.Session{ID: "s1", Name: "qa runner", SessionType: sessiontype.Claude, RepoID: "r1"}
	spawn := &recordingSpawn{}
	s := &sessionManagerService{
		spawnProcess:    spawn,
		sessionActivity: readyActivity{ready: true},
		findSession:     titleSessionFinder{session: session},
		findRepo:        titleRepoFinder{repo: &entity.Repo{ID: "r1", Name: "quant"}},
		updateSession:   noopSessionUpdater{},
	}

	s.syncCliTitle(session)

	msgs := waitForMessage(t, spawn)
	if len(msgs) == 0 || msgs[0] != "/rename quant-qa runner" {
		t.Fatalf("expected the CLI title to be repo-qualified, got %v", msgs)
	}
}

// TestCliTitleForQualifiesWithRepo covers the title itself: session names are
// only unique within a repo, so the repo has to be part of the title.
func TestCliTitleForQualifiesWithRepo(t *testing.T) {
	cases := []struct {
		name    string
		session entity.Session
		repo    *entity.Repo
		want    string
	}{
		{
			name:    "repo qualifies the name",
			session: entity.Session{Name: "qa", RepoID: "r1"},
			repo:    &entity.Repo{ID: "r1", Name: "quant"},
			want:    "quant-qa",
		},
		{
			name:    "another repo, same session name",
			session: entity.Session{Name: "qa", RepoID: "r2"},
			repo:    &entity.Repo{ID: "r2", Name: "poco-pace-api"},
			want:    "poco-pace-api-qa",
		},
		{
			name:    "no repo leaves the bare name",
			session: entity.Session{Name: "assistant"},
			want:    "assistant",
		},
		{
			name:    "unknown repo falls back to the bare name",
			session: entity.Session{Name: "qa", RepoID: "gone"},
			want:    "qa",
		},
		{
			name:    "blank name stays blank",
			session: entity.Session{Name: "  ", RepoID: "r1"},
			repo:    &entity.Repo{ID: "r1", Name: "quant"},
			want:    "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &sessionManagerService{findRepo: titleRepoFinder{repo: tc.repo}}
			if got := s.cliTitleFor(tc.session); got != tc.want {
				t.Errorf("cliTitleFor: got %q want %q", got, tc.want)
			}
		})
	}
}

// TestSyncCliTitleSkips covers the cases that must stay silent: terminal
// sessions have no CLI title, and a nameless session has nothing to push.
func TestSyncCliTitleSkips(t *testing.T) {
	cases := []struct {
		name    string
		session entity.Session
	}{
		{name: "terminal session", session: entity.Session{ID: "s1", Name: "shell", SessionType: sessiontype.Terminal}},
		{name: "blank name", session: entity.Session{ID: "s2", Name: "   ", SessionType: sessiontype.Claude}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			spawn := &recordingSpawn{}
			s := &sessionManagerService{
				spawnProcess:    spawn,
				sessionActivity: readyActivity{ready: true},
				findSession:     titleSessionFinder{session: tc.session},
				findRepo:        titleRepoFinder{},
				updateSession:   noopSessionUpdater{},
			}

			s.syncCliTitle(tc.session)

			time.Sleep(150 * time.Millisecond)
			if msgs := spawn.messages(); len(msgs) != 0 {
				t.Errorf("expected nothing to be typed, got %v", msgs)
			}
		})
	}
}
