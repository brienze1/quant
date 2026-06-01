package remote

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	sessionCookieName = "quant_remote_session"
	sessionTTL        = 12 * time.Hour
	maxAuthFailures   = 5
	authLockout       = 15 * time.Minute
)

// authenticator validates the passcode, issues/verifies HMAC-signed session
// cookies, and rate-limits failed attempts per client IP. The signing key is
// per-process and rotates on passcode change, so cookies die on restart.
type authenticator struct {
	mu       sync.Mutex
	passcode []byte
	key      []byte
	failures map[string]*failureState
}

type failureState struct {
	count       int
	lockedUntil time.Time
}

func newAuthenticator(passcode string) *authenticator {
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	return &authenticator{
		passcode: []byte(passcode),
		key:      key,
		failures: make(map[string]*failureState),
	}
}

// setPasscode rotates the passcode and invalidates all existing sessions by
// rotating the signing key and clearing rate-limit state.
func (a *authenticator) setPasscode(passcode string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.passcode = []byte(passcode)
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	a.key = key
	a.failures = make(map[string]*failureState)
}

// clientIP returns the real client IP for rate-limiting. Because every request
// reaches us via the local cloudflared process, r.RemoteAddr is always loopback
// — keying the limiter on it would let one attacker lock out everyone. cloudflared
// sets CF-Connecting-IP (which a client cannot spoof, since cloudflared overwrites
// it), so prefer that, then X-Forwarded-For, then RemoteAddr for direct/local hits.
func clientIP(r *http.Request) string {
	if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); ip != "" {
		return ip
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// checkPasscode performs a rate-limited, constant-time passcode comparison.
// Returns (ok, userMessage).
func (a *authenticator) checkPasscode(r *http.Request, candidate string) (bool, string) {
	ip := clientIP(r)
	a.mu.Lock()
	defer a.mu.Unlock()

	now := time.Now()
	if st := a.failures[ip]; st != nil && now.Before(st.lockedUntil) {
		return false, "Too many attempts. Try again later."
	}

	if len(a.passcode) > 0 && subtle.ConstantTimeCompare([]byte(candidate), a.passcode) == 1 {
		delete(a.failures, ip)
		return true, ""
	}

	st := a.failures[ip]
	if st == nil {
		st = &failureState{}
		a.failures[ip] = st
	}
	st.count++
	if st.count >= maxAuthFailures {
		st.lockedUntil = now.Add(authLockout)
		st.count = 0
	}
	return false, "Invalid passcode."
}

// issueCookie returns a signed, expiring session cookie. secure marks it
// Secure (set when the request reached the tunnel over https) so it is only
// sent over TLS in production, while still working for direct local http.
func (a *authenticator) issueCookie(secure bool) *http.Cookie {
	a.mu.Lock()
	key := a.key
	a.mu.Unlock()

	exp := time.Now().Add(sessionTTL).Unix()
	return &http.Cookie{
		Name:     sessionCookieName,
		Value:    signToken(key, exp),
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(sessionTTL),
	}
}

func signToken(key []byte, exp int64) string {
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, uint64(exp))
	mac := hmac.New(sha256.New, key)
	mac.Write(buf)
	return base64.RawURLEncoding.EncodeToString(buf) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (a *authenticator) validToken(token string) bool {
	a.mu.Lock()
	key := a.key
	a.mu.Unlock()

	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return false
	}
	buf, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || len(buf) != 8 {
		return false
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, key)
	mac.Write(buf)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return false
	}
	return time.Now().Unix() < int64(binary.BigEndian.Uint64(buf))
}

// authedRequest reports whether the request carries a valid session cookie.
func (a *authenticator) authedRequest(r *http.Request) bool {
	c, err := r.Cookie(sessionCookieName)
	if err != nil {
		return false
	}
	return a.validToken(c.Value)
}

// generatePasscode returns a strong, human-readable passcode: 4 groups of 4
// characters from a 32-symbol unambiguous alphabet (~80 bits). 256 % 32 == 0,
// so the modulo mapping is unbiased.
func generatePasscode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // excludes I, O, 0, 1
	const groups, perGroup = 4, 4
	b := make([]byte, groups*perGroup)
	_, _ = rand.Read(b)
	var sb strings.Builder
	for i, v := range b {
		if i > 0 && i%perGroup == 0 {
			sb.WriteByte('-')
		}
		sb.WriteByte(alphabet[int(v)%len(alphabet)])
	}
	return sb.String()
}
