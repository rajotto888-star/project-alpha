/**
 * Auth flow tests (LOCKED R5 cookie-only + PKCE + one-time KV state + Secure flag).
 *
 * Nothing here was covered before: the OAuth start/callback routes, the session
 * sign/verify round trip, PKCE S256, and the env-aware cookie Secure flag.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import app from "../src/index";
import { signSession, verifySession, pkceChallenge } from "../src/lib/crypto";
import { cookieSecureFlag } from "../src/routes/auth";
import { SESSION_COOKIE_NAME, OAUTH_STATE_TTL_SECONDS } from "@project-alpha/shared";

/** In-memory KV stand-in that records TTLs and deletions. */
function fakeKv() {
  const store = new Map<string, string>();
  const ttls: Record<string, number | undefined> = {};
  const deleted: string[] = [];
  return {
    store,
    ttls,
    deleted,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      store.set(key, value);
      ttls[key] = opts?.expirationTtl;
    },
    async delete(key: string) {
      deleted.push(key);
      store.delete(key);
    },
  };
}

function fakeDb() {
  const inserts: unknown[][] = [];
  return {
    inserts,
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => ({
          first: async () =>
            sql.includes("FROM users")
              ? null // force the insert path so we can capture it
              : null,
          all: async () => ({ results: [] }),
          run: async () => {
            inserts.push(args);
            return {};
          },
        }),
      };
    },
  } as any;
}

const BASE_ENV = {
  APP_URL: "http://127.0.0.1:8787",
  APP_ORIGIN: "http://127.0.0.1:5173",
  COOKIE_SECURE: "false",
  SESSION_SECRET: "test-secret",
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
} as any;

/** cookieSecureFlag only reads COOKIE_SECURE and APP_URL; the rest is filler. */
function flagEnv(over: Partial<{ COOKIE_SECURE: string; APP_URL: string }>) {
  return { ...BASE_ENV, ...over } as any;
}

describe("cookieSecureFlag (env-aware, LOCKED)", () => {
  it("is true when COOKIE_SECURE is explicitly 'true', even on http", () => {
    expect(cookieSecureFlag(flagEnv({ COOKIE_SECURE: "true", APP_URL: "http://x" }))).toBe(true);
  });

  it("is true for any https APP_URL — https cannot be opted out of", () => {
    expect(cookieSecureFlag(flagEnv({ COOKIE_SECURE: "false", APP_URL: "https://x" }))).toBe(true);
    expect(cookieSecureFlag(flagEnv({ COOKIE_SECURE: "", APP_URL: "https://api.example.com" }))).toBe(true);
  });

  it("is false only for plain http without an explicit 'true'", () => {
    expect(cookieSecureFlag(flagEnv({ COOKIE_SECURE: "", APP_URL: "http://127.0.0.1:8787" }))).toBe(false);
    expect(cookieSecureFlag(flagEnv({ COOKIE_SECURE: "false", APP_URL: "http://127.0.0.1:8787" }))).toBe(false);
  });
});

describe("Session token signing (HMAC-SHA256)", () => {
  it("round-trips a valid payload", async () => {
    const token = await signSession({ uid: "u1", exp: Math.floor(Date.now() / 1000) + 60 }, "s3cret");
    const payload = await verifySession(token, "s3cret");
    expect(payload?.uid).toBe("u1");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession({ uid: "u1", exp: Math.floor(Date.now() / 1000) + 60 }, "s3cret");
    expect(await verifySession(token, "other-secret")).toBeNull();
  });

  it("rejects a tampered payload body", async () => {
    const token = await signSession({ uid: "u1", exp: Math.floor(Date.now() / 1000) + 60 }, "s3cret");
    const [body, sig] = token.split(".");
    const forgedBody = btoa(JSON.stringify({ uid: "admin", exp: Math.floor(Date.now() / 1000) + 60 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifySession(`${forgedBody}.${sig}`, "s3cret")).toBeNull();
    expect(body).toBeTruthy();
  });

  it("rejects an expired token", async () => {
    const token = await signSession({ uid: "u1", exp: Math.floor(Date.now() / 1000) - 10 }, "s3cret");
    expect(await verifySession(token, "s3cret")).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    expect(await verifySession("nonsense", "s3cret")).toBeNull();
    expect(await verifySession("a.b.c", "s3cret")).toBeNull();
    expect(await verifySession("", "s3cret")).toBeNull();
  });
});

describe("PKCE S256", () => {
  it("challenge is the base64url SHA-256 of the verifier", async () => {
    const { verifier, challenge } = await pkceChallenge();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    let bin = "";
    const bytes = new Uint8Array(digest);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const expected = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });

  it("produces base64url output with no padding and a fresh verifier each call", async () => {
    const a = await pkceChallenge();
    const b = await pkceChallenge();
    expect(a.verifier).not.toBe(b.verifier);
    for (const { verifier, challenge } of [a, b]) {
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("POST /api/auth/google/start", () => {
  it("returns an authorization URL carrying state + S256 challenge, and stores state in KV with a 300s TTL", async () => {
    const kv = fakeKv();
    const res = await app.request(
      "/api/auth/google/start",
      { method: "POST", headers: { "Content-Type": "application/json" } },
      { ...BASE_ENV, OAUTH_KV: kv } as any,
    );
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://accounts.google.com");
    expect(parsed.searchParams.get("client_id")).toBe("client-id");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8787/api/auth/google/callback");

    const state = parsed.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(parsed.searchParams.get("code_challenge")).toBeTruthy();

    // KV holds the verifier under oauth:<state> with the locked TTL
    expect(kv.store.has(`oauth:${state}`)).toBe(true);
    expect(kv.ttls[`oauth:${state}`]).toBe(OAUTH_STATE_TTL_SECONDS);
    expect(JSON.parse(kv.store.get(`oauth:${state}`)!)).toHaveProperty("verifier");
    // the verifier itself is never returned to the client
    expect(url).not.toContain(JSON.parse(kv.store.get(`oauth:${state}`)!).verifier);
  });
});

describe("GET /api/auth/google/callback", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubGoogle() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(typeof input === "string" ? input : input.url);
        if (url.includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "at", id_token: "idt" }), { status: 200 });
        }
        if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
          return new Response(JSON.stringify({ sub: "google-sub-1", email: "user@example.com" }), { status: 200 });
        }
        throw new Error("unexpected fetch: " + url);
      }),
    );
  }

  it("rejects a missing code or state without touching Google", async () => {
    const kv = fakeKv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = { ...BASE_ENV, OAUTH_KV: kv } as any;

    const noCode = await app.request("/api/auth/google/callback?state=abc", { method: "GET" }, env);
    const noState = await app.request("/api/auth/google/callback?code=xyz", { method: "GET" }, env);

    // canonical auth.ts answers these with 400 JSON, not a browser redirect
    expect(noCode.status).toBe(400);
    expect(noState.status).toBe(400);
    expect(((await noCode.json()) as any).error_code).toBe("INVALID_REQUEST_BODY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown state (replay / forgery)", async () => {
    const kv = fakeKv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.request(
      "/api/auth/google/callback?code=xyz&state=never-issued",
      { method: "GET" },
      { ...BASE_ENV, OAUTH_KV: kv } as any,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error_code).toBe("INVALID_REQUEST_BODY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("LOCKED: consumes the state exactly once (deleted from KV before exchange)", async () => {
    stubGoogle();
    const kv = fakeKv();
    const db = fakeDb();
    const env = { ...BASE_ENV, OAUTH_KV: kv, DB: db } as any;

    const start = await app.request(
      "/api/auth/google/start",
      { method: "POST", headers: { "Content-Type": "application/json" } },
      env,
    );
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;

    const res = await app.request(`/api/auth/google/callback?code=auth-code&state=${state}`, { method: "GET" }, env);

    expect(kv.deleted).toContain(`oauth:${state}`);
    expect(kv.store.has(`oauth:${state}`)).toBe(false);

    // a second callback with the same state must now fail
    const replay = await app.request(`/api/auth/google/callback?code=auth-code&state=${state}`, { method: "GET" }, env);
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as any).error_code).toBe("INVALID_REQUEST_BODY");
    void res;
  });

  it("on success upserts the user and sets an HttpOnly SameSite=Lax session cookie", async () => {
    stubGoogle();
    const kv = fakeKv();
    const db = fakeDb();
    const env = { ...BASE_ENV, OAUTH_KV: kv, DB: db } as any;

    const start = await app.request(
      "/api/auth/google/start",
      { method: "POST", headers: { "Content-Type": "application/json" } },
      env,
    );
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;

    const res = await app.request(`/api/auth/google/callback?code=auth-code&state=${state}`, { method: "GET" }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://127.0.0.1:5173");

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    // dev env: COOKIE_SECURE=false
    expect(setCookie.toLowerCase()).not.toContain("secure");

    // the google user was inserted (oauth_provider, oauth_sub, email)
    const userInsert = db.inserts.find((args: any[]) => args[1] === "google" && args[2] === "google-sub-1");
    expect(userInsert).toBeDefined();
    expect(userInsert![3]).toBe("user@example.com");

    // and the cookie actually verifies against SESSION_SECRET
    const token = setCookie.split(`${SESSION_COOKIE_NAME}=`)[1].split(";")[0];
    const payload = await verifySession(token, BASE_ENV.SESSION_SECRET);
    expect(payload?.uid).toBe(userInsert![0]);
  });

  it("marks the cookie Secure when COOKIE_SECURE=true", async () => {
    stubGoogle();
    const kv = fakeKv();
    const db = fakeDb();
    const env = { ...BASE_ENV, COOKIE_SECURE: "true", OAUTH_KV: kv, DB: db } as any;

    const start = await app.request(
      "/api/auth/google/start",
      { method: "POST", headers: { "Content-Type": "application/json" } },
      env,
    );
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;

    const res = await app.request(`/api/auth/google/callback?code=auth-code&state=${state}`, { method: "GET" }, env);
    expect((res.headers.get("Set-Cookie") ?? "").toLowerCase()).toContain("secure");
  });

  it("fails closed when Google rejects the token exchange", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    const kv = fakeKv();
    const db = fakeDb();
    const env = { ...BASE_ENV, OAUTH_KV: kv, DB: db } as any;

    const start = await app.request(
      "/api/auth/google/start",
      { method: "POST", headers: { "Content-Type": "application/json" } },
      env,
    );
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;

    const res = await app.request(`/api/auth/google/callback?code=bad&state=${state}`, { method: "GET" }, env);
    // canonical auth.ts does not catch exchangeGoogleCode(), so the throw reaches
    // app.onError and the browser gets a 500 JSON body rather than a redirect.
    // It still fails CLOSED: no session cookie is ever issued.
    expect(res.status).toBe(500);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    // state was still consumed, so it cannot be retried
    expect(kv.store.has(`oauth:${state}`)).toBe(false);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session cookie", async () => {
    const res = await app.request("/api/auth/logout", { method: "POST" }, BASE_ENV);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });
});
