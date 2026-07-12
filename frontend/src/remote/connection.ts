/*
 * Connection manager for the standalone PWA client.
 *
 * Persists the { baseURL, token } the user configured so the app "stays saved
 * until it is no longer accessible": on launch we health-check the saved
 * endpoint and either boot straight in or fall to a Reconnect screen prefilled
 * with the last URL. A transient failure NEVER discards the saved connection —
 * only an explicit 401 clears the token (re-prompt passcode), and the URL is
 * only replaced when the user pastes a new one. Rotating the tunnel URL is just
 * "paste + reconnect" — no reinstall.
 */

const BASE = "/__quant_remote";
const STORAGE_KEY = "quant.remote.connection";

export interface SavedConnection {
  baseURL: string;
  token: string;
  label: string;
  savedAt: number;
}

/** Normalize a user-entered URL to a bare https origin with no trailing slash. */
export function normalizeBaseURL(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return u.origin;
  } catch {
    return "";
  }
}

export function loadConnection(): SavedConnection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as SavedConnection;
    if (c && typeof c.baseURL === "string" && typeof c.token === "string") return c;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveConnection(c: SavedConnection): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

/** Forget the token (re-prompt passcode) but keep the URL prefilled. */
export function clearToken(): void {
  const c = loadConnection();
  if (!c) return;
  saveConnection({ ...c, token: "" });
}

export function forgetConnection(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export type HealthResult =
  | { ok: true; authed: boolean }
  | { ok: false; reason: "unreachable" };

/**
 * health probes {baseURL}/__quant_remote/health with the saved token. Reachable
 * → distinguishes a live-but-expired token (authed=false) from a valid one;
 * unreachable → the tunnel is likely dead/rotated (keep the saved connection,
 * show Reconnect).
 */
export async function health(baseURL: string, token?: string): Promise<HealthResult> {
  const url = baseURL.replace(/\/$/, "") + BASE + "/health";
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: "Bearer " + token } : undefined,
      // Fail fast so a dead tunnel doesn't hang the launch screen.
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { ok: true, authed: false };
    const body = (await res.json()) as { ok?: boolean; authed?: boolean };
    return { ok: true, authed: !!body.authed };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

export interface AuthResult {
  ok: boolean;
  token?: string;
  error?: string;
}

/** Exchange a passcode for a bearer token via the JSON auth path. */
export async function authenticate(baseURL: string, passcode: string): Promise<AuthResult> {
  const url = baseURL.replace(/\/$/, "") + BASE + "/auth";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ passcode }),
    });
    if (res.ok) {
      const body = (await res.json()) as { token?: string };
      if (body.token) return { ok: true, token: body.token };
      return { ok: false, error: "No token returned." };
    }
    let msg = res.status === 401 ? "Invalid passcode." : `Server error (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* keep default */
    }
    return { ok: false, error: msg };
  } catch {
    return { ok: false, error: "Could not reach that URL. Check it and your network." };
  }
}

/** A readable default label derived from the tunnel host. */
export function labelFor(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}
