/**
 * OAuth configuration guard — pins the failure that produced ERR-07 in the field.
 *
 * MEASURED before this guard existed (live `wrangler dev`, `.dev.vars` containing SESSION_SECRET
 * only):
 *
 *   POST /api/auth/google/start
 *   -> 200 {"url":"https://accounts.google.com/o/oauth2/v2/auth?client_id=undefined&..."}
 *
 * HTTP 200 is a lie in that situation: the browser leaves the origin, Google answers
 * "Access blocked: Missing required parameter: client_id", and the operator goes hunting in the
 * Google Console instead of their own bindings. The contract now:
 *
 *   - missing/blank/`undefined`/`null` binding => 500 INTERNAL_ERROR naming the binding, NO url,
 *     and nothing that looks like a Google authorize link in the body;
 *   - configured => 200 {"url": ...} with the real client_id, PKCE S256 challenge, and
 *     `<APP_URL>/api/auth/google/callback` as the redirect URI.
 *
 * Redirect URI is derived from APP_URL, so Google Console must register exactly
 * `http://127.0.0.1:8787/api/auth/google/callback` for dev.
 */
import { describe, it, expect } from "vitest";
import app from "../src/index";
import { OAUTH_STATE_TTL_SECONDS } from "@project-alpha/shared";

function fakeKv() {
  const store = new Map<string, string>();
  const ttls: Record<string, number | undefined> = {};
  return {
    store,
    ttls,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      store.set(key, value);
      ttls[key] = opts?.expirationTtl;
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function envWith(overrides: Record<string, unknown> = {}) {
  return {
    APP_URL: "http://127.0.0.1:8787",
    APP_ORIGIN: "http://127.0.0.1:5173",
    COOKIE_SECURE: "false",
    SESSION_SECRET: "test-secret",
    GOOGLE_OAUTH_CLIENT_ID: "client-id.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
    OAUTH_KV: fakeKv(),
    ...overrides,
  } as any;
}

async function start(env: Record<string, unknown>) {
  const res = await app.request("/api/auth/google/start", { method: "POST" }, env);
  const text = await res.text();
  return { res, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

describe("POST /api/auth/google/start — happy path", () => {
  it("returns 200 with a real authorization URL, PKCE S256, and the APP_URL redirect", async () => {
    const env = envWith();
    const { res, json } = await start(env);

    expect(res.status).toBe(200);
    expect(typeof json.url).toBe("string");
    expect(json.url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);

    const params = new URL(json.url).searchParams;
    expect(params.get("client_id")).toBe("client-id.apps.googleusercontent.com");
    expect(params.get("redirect_uri")).toBe("http://127.0.0.1:8787/api/auth/google/callback");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("state")).toBeTruthy();
    expect(json.url).not.toContain("undefined");
  });

  it("writes the PKCE verifier to KV under the state key with a 300s TTL", async () => {
    const env = envWith();
    const { json } = await start(env);

    const state = new URL(json.url).searchParams.get("state") as string;
    const stored = env.OAUTH_KV.store.get(`oauth:${state}`);
    expect(stored).toBeTruthy();
    expect(typeof JSON.parse(stored as string).verifier).toBe("string");
    expect(env.OAUTH_KV.ttls[`oauth:${state}`]).toBe(OAUTH_STATE_TTL_SECONDS);
    expect(OAUTH_STATE_TTL_SECONDS).toBe(300);
  });
});

describe("POST /api/auth/google/start — config guard (ERR-07)", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["binding absent", { GOOGLE_OAUTH_CLIENT_ID: undefined }],
    ["binding blank", { GOOGLE_OAUTH_CLIENT_ID: "" }],
    ["binding whitespace", { GOOGLE_OAUTH_CLIENT_ID: "   " }],
    ["binding literally 'undefined'", { GOOGLE_OAUTH_CLIENT_ID: "undefined" }],
    ["binding literally 'null'", { GOOGLE_OAUTH_CLIENT_ID: "null" }],
    // A handoff template ships `.dev.vars` with `<REDACTED>` placeholders; pasting it verbatim is
    // an easy mistake and would otherwise reach Google as an invalid client id.
    ["binding left as '<REDACTED>' placeholder", { GOOGLE_OAUTH_CLIENT_ID: "<REDACTED>" }],
    ["binding left as '<YOUR_CLIENT_ID>' placeholder", { GOOGLE_OAUTH_CLIENT_ID: "<YOUR_CLIENT_ID>" }],
    ["binding left as 'YOUR_CLIENT_ID' placeholder", { GOOGLE_OAUTH_CLIENT_ID: "YOUR_CLIENT_ID" }],
  ];

  for (const [label, overrides] of cases) {
    it(`${label} -> 500 INTERNAL_ERROR naming the binding, never a Google URL`, async () => {
      const { res, text, json } = await start(envWith(overrides));

      expect(res.status).toBe(500);
      expect(json.error_code).toBe("INTERNAL_ERROR");
      expect(json.message).toContain("GOOGLE_OAUTH_CLIENT_ID");
      // the whole point: no silent success, and no half-built Google link
      expect(text).not.toContain("accounts.google.com");
      expect(text).not.toContain("client_id=undefined");
    });
  }

  it("APP_URL absent is also caught (the redirect URI would otherwise be 'undefined/...')", async () => {
    const { res, json, text } = await start(envWith({ APP_URL: undefined }));
    expect(res.status).toBe(500);
    expect(json.message).toContain("APP_URL");
    expect(text).not.toContain("accounts.google.com");
  });

  it("a missing CLIENT_SECRET does not block /start (it is only needed at the callback)", async () => {
    const { res, json } = await start(envWith({ GOOGLE_OAUTH_CLIENT_SECRET: undefined }));
    expect(res.status).toBe(200);
    expect(typeof json.url).toBe("string");
  });
});
