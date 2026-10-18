/**
 * authClient tests — written against the CANONICAL auth routes in
 * apps/worker/src/routes/auth.ts:
 *
 *   POST /api/auth/google/start -> 200 {"url": "<google authorize url>"}
 *   POST /api/auth/logout       -> 200 {"ok": true}
 *
 * These pin the shape that a pasted runbook got wrong twice: there is no
 * GET /api/auth/google/login and the start route does not 302 — it returns JSON.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { startGoogleLogin, logout } from "../src/lib/authClient";

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("startGoogleLogin", () => {
  it("POSTs to /api/auth/google/start with credentials (never a GET, never an Authorization header)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }));
    vi.stubGlobal("fetch", fetchMock);

    await startGoogleLogin();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe("/api/auth/google/start");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("returns the authorization URL from the JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" })));
    const result = await startGoogleLogin();
    expect(result.ok).toBe(true);
    expect(result.url).toContain("accounts.google.com");
  });

  it("fails cleanly when the server returns a non-200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, 500)));
    const result = await startGoogleLogin();
    expect(result.ok).toBe(false);
    expect(result.url).toBeUndefined();
    expect(result.error).toContain("500");
  });

  it("fails cleanly when the body carries no url (wrong build / renamed route)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })));
    const result = await startGoogleLogin();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("authorization URL");
  });

  it("fails cleanly when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const result = await startGoogleLogin();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("reach the server");
  });
});

describe("logout", () => {
  it("POSTs to /api/auth/logout with credentials", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await logout()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe("/api/auth/logout");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
  });

  it("reports failure when the request rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await logout()).toBe(false);
  });
});
