import React from "react";
import { authenticate, labelFor, normalizeBaseURL, type SavedConnection } from "./connection";

interface Props {
  /** Prefills the URL field — the last-used tunnel URL on a reconnect. */
  initialURL?: string;
  /** True when we're re-prompting because a saved token was rejected/expired. */
  reconnect?: boolean;
  onConnected: (c: SavedConnection) => void;
}

/**
 * The connect / reconnect screen. The user pastes the current remote-access URL
 * (from the desktop app's Remote Access panel) and the passcode; on success we
 * persist { baseURL, token } and hand control to the client shell. Rotating the
 * tunnel is just pasting the new URL here — no reinstall.
 */
export function ConnectScreen({ initialURL = "", reconnect = false, onConnected }: Props) {
  const [url, setUrl] = React.useState(initialURL);
  const [passcode, setPasscode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const baseURL = normalizeBaseURL(url);
    if (!baseURL) {
      setError("Enter a valid https URL.");
      return;
    }
    if (!passcode.trim()) {
      setError("Enter the passcode.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await authenticate(baseURL, passcode.trim());
    setBusy(false);
    if (!res.ok || !res.token) {
      setError(res.error || "Could not connect.");
      return;
    }
    onConnected({ baseURL, token: res.token, label: labelFor(baseURL), savedAt: Date.now() });
  };

  return (
    <div style={S.wrap}>
      <form onSubmit={submit} style={S.card}>
        <div style={S.brand}>
          <span style={S.prompt}>&gt;_</span> quant
        </div>
        <p style={S.sub}>
          {reconnect
            ? "// this connection expired or moved. paste the current remote-access url to reconnect."
            : "// connect to a running quant desktop. paste its remote-access url + passcode."}
        </p>

        <label style={S.label} htmlFor="rc-url">remote access url</label>
        <input
          id="rc-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://something.trycloudflare.com"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          style={S.input}
        />

        <label style={S.label} htmlFor="rc-pass">passcode</label>
        <input
          id="rc-pass"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="xxxx-xxxx-xxxx-xxxx"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          style={S.input}
        />

        <button type="submit" disabled={busy} style={{ ...S.button, opacity: busy ? 0.6 : 1 }}>
          {busy ? "connecting…" : reconnect ? "reconnect" : "unlock"}
        </button>

        {error && <p style={S.err}>{error}</p>}
      </form>
      <p style={S.hint}>
        Enable Remote Access in the Quant desktop app (Settings → Remote Access) to get a URL and passcode.
      </p>
    </div>
  );
}

// Inline styles keep this screen self-contained (no dependency on the app's
// component library, which only loads once connected). Uses design tokens so it
// respects the active theme/accent.
const S: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: "max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))",
    background: "var(--bg)",
    color: "var(--fg)",
    fontFamily: "var(--sans)",
  },
  card: {
    width: "100%",
    maxWidth: 380,
    display: "flex",
    flexDirection: "column",
    padding: 26,
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r4)",
    boxShadow: "var(--shadow-panel)",
  },
  brand: { fontSize: 20, fontWeight: 600, color: "var(--accent)", letterSpacing: "0.3px", marginBottom: 6 },
  prompt: { fontFamily: "var(--mono)" },
  sub: { margin: "0 0 20px", fontSize: 12, lineHeight: 1.5, color: "var(--fg-3)", fontFamily: "var(--mono)" },
  label: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "1px",
    color: "var(--fg-3)",
    margin: "0 0 6px",
  },
  input: {
    width: "100%",
    padding: "12px 13px",
    marginBottom: 16,
    // 16px min stops iOS Safari from zooming the viewport on focus.
    fontSize: 16,
    fontFamily: "var(--mono)",
    background: "var(--panel-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r2)",
    color: "var(--fg)",
    outline: "none",
    boxSizing: "border-box",
  },
  button: {
    width: "100%",
    marginTop: 4,
    padding: 13,
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "var(--sans)",
    cursor: "pointer",
    background: "var(--accent)",
    color: "var(--on-accent)",
    border: "none",
    borderRadius: "var(--r2)",
  },
  err: { color: "var(--danger)", fontSize: 12, margin: "14px 0 0", lineHeight: 1.5 },
  hint: { maxWidth: 380, textAlign: "center", fontSize: 11, lineHeight: 1.5, color: "var(--fg-4)", margin: 0 },
};
