/**
 * Auth client — the browser half of the OAuth flow.
 *
 * AUTO-LOGIN MODE: POST /api/auth/auto-login with pass 123456
 * CANONICAL SHAPE (do not "fix" this to a GET/redirect):
 *   POST /api/auth/google/start   -> 200 {"url": "https://accounts.google.com/..."}
 *   POST /api/auth/auto-login    -> 200 {"ok": true, "user_id": "default-user"}
 *   GET  /api/auth/google/callback (Google hits this; it sets the cookie and redirects)
 *   POST /api/auth/logout         -> 200 {"ok": true}
 */

export interface StartLoginResult {
  ok: boolean;
  url?: string;
  error?: string;
}

export async function startGoogleLogin(): Promise<StartLoginResult> {
  let res: Response;
  try {
    res = await fetch("/api/auth/google/start", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return { ok: false, error: "Could not reach the server. Is the worker running?" };
  }
  if (!res.ok) {
    return { ok: false, error: `Sign-in could not start (HTTP ${res.status}).` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "Sign-in returned an unreadable response." };
  }
  const url = (body as { url?: unknown } | null)?.url;
  if (typeof url !== "string" || url.length === 0) {
    return { ok: false, error: "Sign-in did not return an authorization URL." };
  }
  return { ok: true, url };
}

export async function autoLogin(pass: string = "123456"): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/auth/auto-login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pass }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: txt };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "auto-login failed" };
  }
}

export async function logout(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}
