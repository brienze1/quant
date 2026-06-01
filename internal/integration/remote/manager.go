package remote

import (
	"fmt"
	"io/fs"
	"sync"

	"quant/internal/domain/entity"
)

// ConfigStore is the minimal config persistence the Manager needs to read and
// persist the three remote-access fields.
type ConfigStore interface {
	LoadConfig() (*entity.Config, error)
	SaveConfig(cfg *entity.Config) error
}

// Status is the snapshot returned to the Settings UI.
type Status struct {
	Enabled              bool   `json:"enabled"`
	URL                  string `json:"url"`
	Passcode             string `json:"passcode"`
	Port                 int    `json:"port"`
	Clients              int    `json:"clients"`
	CloudflaredInstalled bool   `json:"cloudflaredInstalled"`
	Error                string `json:"error"`
}

// Manager owns the remote-access HTTP server + Cloudflare tunnel lifecycle and
// is the single control surface the RemoteController binds to.
type Manager struct {
	assets      fs.FS
	controllers map[string]interface{}
	store       ConfigStore
	hub         *EventHub

	mu      sync.Mutex
	srv     *server
	tunnel  *tunnelManager
	auth    *authenticator
	url     string
	running bool
	lastErr string
}

// NewManager wires the manager and registers the process-wide event hub so
// Emit/Publish reach browser clients.
func NewManager(assets fs.FS, controllers map[string]interface{}, store ConfigStore) *Manager {
	hub := NewEventHub()
	SetDefaultHub(hub)
	return &Manager{
		assets:      assets,
		controllers: controllers,
		store:       store,
		hub:         hub,
	}
}

// StartIfEnabled starts remote access at boot if the persisted config has it on.
func (m *Manager) StartIfEnabled() {
	cfg, err := m.store.LoadConfig()
	if err != nil || cfg == nil || !cfg.RemoteAccessEnabled {
		return
	}
	if _, err := m.Enable(); err != nil {
		fmt.Printf("[quant] remote access auto-start failed: %v\n", err)
	}
}

// Enable starts the localhost server and the Cloudflare tunnel, generating a
// passcode on first use. Fails (and stays off) when cloudflared is not
// installed, so the UI can surface the install guide.
func (m *Manager) Enable() (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		return m.statusLocked(), nil
	}

	if _, ok := findCloudflared(); !ok {
		m.lastErr = "cloudflared is not installed"
		return m.statusLocked(), errCloudflaredMissing
	}

	cfg, err := m.store.LoadConfig()
	if err != nil || cfg == nil {
		c := entity.NewDefaultConfig()
		cfg = &c
	}
	if cfg.RemoteAccessPasscode == "" {
		cfg.RemoteAccessPasscode = generatePasscode()
	}

	m.auth = newAuthenticator(cfg.RemoteAccessPasscode)
	srv, err := newServer(cfg.RemoteAccessPort, m.assets, m.controllers, m.hub, m.auth)
	if err != nil {
		m.lastErr = err.Error()
		return m.statusLocked(), fmt.Errorf("failed to start remote server: %w", err)
	}
	srv.start()
	m.srv = srv
	m.url = ""
	m.lastErr = ""

	m.tunnel = newTunnelManager()
	if err := m.tunnel.start(srv.port, func(u string) {
		m.mu.Lock()
		m.url = u
		m.mu.Unlock()
	}); err != nil {
		m.lastErr = err.Error()
	}

	m.running = true
	cfg.RemoteAccessEnabled = true
	// Persist the passcode + enabled flag, but leave RemoteAccessPort as the
	// user's preference (0 = auto-pick) rather than pinning the resolved
	// ephemeral port, which may be taken on the next launch.
	_ = m.store.SaveConfig(cfg)
	return m.statusLocked(), nil
}

// Disable stops the server + tunnel and persists the off state.
func (m *Manager) Disable() (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopLocked()
	if cfg, err := m.store.LoadConfig(); err == nil && cfg != nil {
		cfg.RemoteAccessEnabled = false
		_ = m.store.SaveConfig(cfg)
	}
	return m.statusLocked(), nil
}

// Stop tears down the server + tunnel without touching persisted config (used
// on app shutdown so it auto-resumes next launch).
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopLocked()
}

func (m *Manager) stopLocked() {
	if m.tunnel != nil {
		m.tunnel.stop()
		m.tunnel = nil
	}
	if m.srv != nil {
		_ = m.srv.stop()
		m.srv = nil
	}
	m.running = false
	m.url = ""
}

// RegeneratePasscode rotates the passcode (invalidating live sessions) and
// persists it.
func (m *Manager) RegeneratePasscode() (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	pass := generatePasscode()
	if cfg, err := m.store.LoadConfig(); err == nil && cfg != nil {
		cfg.RemoteAccessPasscode = pass
		_ = m.store.SaveConfig(cfg)
	}
	if m.auth != nil {
		m.auth.setPasscode(pass)
	}
	return m.statusLocked(), nil
}

// Status returns the current snapshot.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.statusLocked()
}

func (m *Manager) statusLocked() Status {
	_, installed := findCloudflared()
	st := Status{
		Enabled:              m.running,
		URL:                  m.url,
		Clients:              m.hub.ClientCount(),
		CloudflaredInstalled: installed,
		Error:                m.lastErr,
	}
	if cfg, err := m.store.LoadConfig(); err == nil && cfg != nil {
		st.Passcode = cfg.RemoteAccessPasscode
		st.Port = cfg.RemoteAccessPort
	}
	if m.srv != nil {
		st.Port = m.srv.port
	}
	return st
}
