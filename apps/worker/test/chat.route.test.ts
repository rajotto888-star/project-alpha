/**
 * Chat route integration tests through the real Hono app (app.request), with a
 * genuinely signed session cookie and a fake D1.
 *
 * These cover the LOCKED ephemeral-key precedence at the HTTP boundary, not just inside
 * extractEphemeralKeys — i.e. what a client actually gets back as a status/error_code.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import app from "../src/index";
import { signSession } from "../src/lib/crypto";
import { SESSION_COOKIE_NAME, ERROR_CODES } from "@project-alpha/shared";
import { mockOpenAIStream } from "./utils/mockProvider";

const ENV = {
  APP_URL: "http://127.0.0.1:8787",
  APP_ORIGIN: "http://127.0.0.1:5173",
  COOKIE_SECURE: "false",
  SESSION_SECRET: "test-secret",
  DB: {
    prepare(sql: string) {
      const isUser = sql.includes("FROM users");
      return {
        bind: () => ({
          first: async () =>
            isUser
              ? { id: "u1", oauth_provider: "google", oauth_sub: "sub1", email: "a@b.c", created_at: 1 }
              : null,
          all: async () => ({ results: [] }),
          run: async () => ({}),
        }),
      };
    },
  },
} as any;

async function authedCookie(): Promise<string> {
  const token = await signSession({ uid: "u1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    messages: [{ role: "user", content: "What is the capital of France?" }],
    manual_providers: {
      ptm: { provider_id: "openai", model_id: "gpt-4o-mini" },
      vcm: { provider_id: "groq", model_id: "llama-3.3-70b-versatile" },
      fcm: null,
    },
    merge_style: "hybrid",
    enable_fast_draft: false,
    router_mode: "manual",
    ...overrides,
  });
}

function b64(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const BOTH_KEYS = { openai: "sk-test", groq: "gk-test" };

describe("POST /api/chat/stream — validation before the stream opens", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("malformed JSON -> 400 INVALID_REQUEST_BODY", async () => {
    const res = await app.request(
      "/api/chat/stream",
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: await authedCookie() }, body: "{not json" },
      ENV,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error_code).toBe(ERROR_CODES.INVALID_REQUEST_BODY);
  });

  it("router_mode 'auto' is rejected -> 400 (manual-only LOCK)", async () => {
    const res = await app.request(
      "/api/chat/stream",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: await authedCookie() },
        body: body({ router_mode: "auto" }),
      },
      ENV,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error_code).toBe(ERROR_CODES.INVALID_REQUEST_BODY);
  });

  it("unknown provider is rejected against the catalog -> 400", async () => {
    const res = await app.request(
      "/api/chat/stream",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: await authedCookie() },
        body: body({
          manual_providers: {
            ptm: { provider_id: "anthropic", model_id: "claude-3-5-sonnet" },
            vcm: { provider_id: "groq", model_id: "llama-3.3-70b-versatile" },
            fcm: null,
          },
        }),
      },
      ENV,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error_code).toBe(ERROR_CODES.INVALID_REQUEST_BODY);
  });

  it("no keys anywhere -> 400 MISSING_CREDENTIALS", async () => {
    const res = await app.request(
      "/api/chat/stream",
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: await authedCookie() }, body: body() },
      ENV,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error_code).toBe(ERROR_CODES.MISSING_CREDENTIALS);
  });

  it("LOCKED: invalid header is rejected and NEVER falls back to valid body keys", async () => {
    const res = await app.request(
      "/api/chat/stream",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: await authedCookie(),
          "X-EPHEMERAL-KEYS": "!!!not-base64-json!!!",
        },
        body: body({ ephemeral_keys: BOTH_KEYS }),
      },
      ENV,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error_code).toBe(ERROR_CODES.INVALID_EPHEMERAL_KEYS_HEADER);
  });

  it("LOCKED: key missing for a selected provider fails fast, before SSE opens", async () => {
    const res = await app.request(
      "/api/chat/stream",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: await authedCookie(),
          "X-EPHEMERAL-KEYS": b64({ openai: "sk-test" }), // groq (VCM) missing
        },
        body: body(),
      },
      ENV,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error_code).toBe(ERROR_CODES.MISSING_CREDENTIALS);
    expect(json.message).toContain("groq");
  });

  it("body fallback is used only when the header is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockOpenAIStream([{ delta: "Paris." }])));
    const res = await app.request(
      "/api/chat/stream",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: await authedCookie() },
        body: body({ ephemeral_keys: BOTH_KEYS }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("valid header opens an SSE stream (200, text/event-stream)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockOpenAIStream([{ delta: "Paris." }])));
    const res = await app.request(
      "/api/chat/stream",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: await authedCookie(),
          "X-EPHEMERAL-KEYS": b64(BOTH_KEYS),
        },
        body: body(),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("a bad session signature auto-refreshes in AUTO-LOGIN MODE", async () => {
    const forged = `${SESSION_COOKIE_NAME}=${b64({ uid: "u1", exp: Math.floor(Date.now() / 1000) + 3600 })}.deadbeef`;
    const res = await app.request(
      "/api/chat/stream",
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: forged }, body: body() },
      ENV,
    );
    // AUTO-LOGIN MODE: bad signature auto-refreshes, so should be 400 (validation) not 401
    expect(res.status).toBe(400);
  });
});
