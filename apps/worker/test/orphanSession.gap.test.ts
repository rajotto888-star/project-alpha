/**
 * KNOWN GAP — orphaned session tokens.
 *
 * Canonical apps/worker/src/middleware/session.ts verifies the HMAC and the
 * expiry, then sets userId. It does NOT call getUserById(). That is a deliberate
 * trade in the canonical code (one fewer D1 round trip on every request), but it
 * has a consequence worth pinning so a future change is a *decision*, not a drift:
 *
 *   A session signed for a uid that has no row in `users` still authenticates.
 *
 * Because provider_prefs / role_assignments carry
 *   FOREIGN KEY (user_id) REFERENCES users(id)
 * the first WRITE for such a session fails at the database layer and surfaces as
 * HTTP 500 INTERNAL_ERROR rather than a clean 401/403.
 *
 * This was reproduced against a live `wrangler dev` worker: with an empty `users`
 * table, PUT /api/providers/prefs returned 500; inserting the row made the exact
 * same request return 200.
 *
 * These tests assert the behaviour AS IT IS. If someone adds the existence check,
 * they must update these assertions on purpose.
 */
import { describe, it, expect } from "vitest";
import app from "../src/index";
import { signSession } from "../src/lib/crypto";
import { SESSION_COOKIE_NAME } from "@project-alpha/shared";

const ENV = {
  APP_URL: "http://127.0.0.1:8787",
  APP_ORIGIN: "http://127.0.0.1:5173",
  COOKIE_SECURE: "false",
  SESSION_SECRET: "test-secret",
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
} as any;

async function cookieFor(uid: string): Promise<string> {
  const token = await signSession({ uid, exp: Math.floor(Date.now() / 1000) + 60 }, "test-secret");
  return `${SESSION_COOKIE_NAME}=${token}`;
}

/** Permissive D1 stand-in: reads succeed, nothing is written. */
function emptyDb() {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({}),
      }),
    }),
    batch: async () => [],
  } as unknown as D1Database;
}

/** D1 stand-in that behaves like SQLite with FK enforcement ON. */
function fkEnforcingDb() {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => null,
        all: async () => ({ results: [] }),
        // D1/SQLite raise on the FK violation; the worker maps it to 500.
        run: async () => {
          throw new Error("D1_ERROR: FOREIGN KEY constraint failed");
        },
      }),
    }),
    batch: async () => {
      throw new Error("D1_ERROR: FOREIGN KEY constraint failed");
    },
  } as unknown as D1Database;
}

describe("KNOWN GAP — orphaned session (no row in `users`)", () => {
  it("still authenticates: the middleware never checks user existence", async () => {
    // Reads succeed because sessionMiddleware only validates signature + expiry.
    const res = await app.request(
      "/api/providers/prefs",
      { headers: { Cookie: await cookieFor("ghost-user") } },
      { ...ENV, DB: emptyDb() } as any,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.provider_prefs).toEqual([]);
  });

  it("a WRITE then fails at the FK boundary and surfaces as 500, not 401", async () => {
    const res = await app.request(
      "/api/providers/prefs",
      {
        method: "PUT",
        headers: { Cookie: await cookieFor("ghost-user"), "Content-Type": "application/json" },
        body: JSON.stringify({
          prefs: [
            {
              provider_id: "openai",
              enabled: true,
              selected_model: "gpt-4o",
              priority_mode: "balanced",
              cost_weight: 7,
            },
          ],
        }),
      },
      { ...ENV, DB: fkEnforcingDb() } as any,
    );

    // Documents the sharp edge: a client with a valid cookie gets an opaque 500.
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).error_code).toBe("INTERNAL_ERROR");
  });

  it("a tampered token auto-refreshes to default-user in AUTO-LOGIN MODE", async () => {
    const good = await cookieFor("ghost-user");
    const tampered = good.slice(0, -1) + (good.endsWith("A") ? "B" : "A");
    const res = await app.request("/api/providers/prefs", { headers: { Cookie: tampered } }, { ...ENV, DB: emptyDb() } as any);
    expect(res.status).toBe(200); // AUTO-LOGIN MODE: tampered token auto-refreshes to default-user
  });

  it("no cookie auto-logins in AUTO-LOGIN MODE", async () => {
    const res = await app.request("/api/providers/prefs", {}, { ...ENV, DB: emptyDb() } as any);
    expect(res.status).toBe(200); // AUTO-LOGIN
  });
});
