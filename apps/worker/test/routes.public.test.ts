/**
 * Route-level regression tests using Hono's built-in app.request() — no server needed.
 *
 * Origin of these tests: a local `wrangler dev` smoke run showed
 * GET /api/providers/catalog returning 401, because providerPrefs mounted a blanket
 * use("*", sessionMiddleware) on the same /api/providers prefix and shadowed the public
 * catalog route. These tests pin the contract so that cannot regress.
 */
import { describe, it, expect } from "vitest";
import app from "../src/index";
import { ERROR_CODES } from "@project-alpha/shared";

const ENV = {
  APP_URL: "http://127.0.0.1:8787",
  APP_ORIGIN: "http://127.0.0.1:5173",
  COOKIE_SECURE: "false",
  SESSION_SECRET: "test-secret",
} as any;

const CHAT_BODY = JSON.stringify({
  messages: [{ role: "user", content: "hi" }],
  manual_providers: {
    ptm: { provider_id: "openai", model_id: "gpt-4o-mini" },
    vcm: { provider_id: "groq", model_id: "llama-3.3-70b-versatile" },
    fcm: null,
  },
  merge_style: "hybrid",
  enable_fast_draft: false,
  router_mode: "manual",
});

describe("Public vs protected routes (regression)", () => {
  it("GET /api/providers/catalog is PUBLIC and lists only catalog-safe fields", async () => {
    const res = await app.request("/api/providers/catalog", { method: "GET" }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.providers)).toBe(true);

    const ids = body.providers.map((p: any) => p.id);
    expect(ids).toContain("openai");
    expect(ids).toContain("groq");

    const selectable = body.providers.filter((p: any) => p.selectable);
    expect(selectable.map((p: any) => p.id).sort()).toEqual(["groq", "openai", "openrouter", "private-llama", "private-smollm"]);

    // baseUrl must never be part of the public payload
    for (const p of body.providers) {
      expect(p).not.toHaveProperty("baseUrl");
    }
  });

  it("GET /api/providers/prefs auto-logins when no cookie (AUTO-LOGIN MODE)", async () => {
    const res = await app.request("/api/providers/prefs", { method: "GET" }, ENV);
    // Auto-login mode: no cookie = auto-create default-user, returns 200 not 401
    expect(res.status).toBe(200);
  });

  it("POST /api/chat/stream auto-logins when no cookie (AUTO-LOGIN MODE)", async () => {
    const res = await app.request(
      "/api/chat/stream",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: CHAT_BODY },
      ENV,
    );
    // Auto-login mode: should not be 401, should proceed to validation or stream
    expect(res.status).not.toBe(401);
  });

  it("unknown route -> 404 NOT_FOUND", async () => {
    const res = await app.request("/api/does-not-exist", { method: "GET" }, ENV);
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error_code).toBe(ERROR_CODES.NOT_FOUND);
  });
});

describe("CORS allowlist", () => {
  it("echoes only the configured APP_ORIGIN, with credentials", async () => {
    const res = await app.request(
      "/api/providers/catalog",
      { method: "GET", headers: { Origin: "http://127.0.0.1:5173" } },
      ENV,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:5173");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it("never echoes a disallowed origin, and never uses a wildcard", async () => {
    const res = await app.request(
      "/api/providers/catalog",
      { method: "GET", headers: { Origin: "https://evil.example" } },
      ENV,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("answers preflight from the allowed origin with 204", async () => {
    const res = await app.request(
      "/api/chat/stream",
      {
        method: "OPTIONS",
        headers: { Origin: "http://127.0.0.1:5173", "Access-Control-Request-Method": "POST" },
      },
      ENV,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("X-EPHEMERAL-KEYS");
  });
});

describe("Session auth is cookie-only (LOCKED R5)", () => {
  it("ignores an Authorization bearer token and auto-logins (AUTO-LOGIN MODE)", async () => {
    const res = await app.request(
      "/api/providers/prefs",
      { method: "GET", headers: { Authorization: "Bearer looks-like-a-token" } },
      ENV,
    );
    // Auto-login mode: bearer token ignored, but auto-login gives 200
    expect(res.status).toBe(200);
  });
});

