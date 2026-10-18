/**
 * Root health probe (D7) — pins the additive `GET /` contract:
 * public (no cookie), metadata-only, and it must NOT swallow the 404 handler.
 *
 * Why: uptime checks and the CI dry-run smoke need a stable "worker is up"
 * signal that does not depend on auth or on any binding being reachable.
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

describe("GET / health probe", () => {
  it("returns 200 with exactly {ok, service, version} and no extra keys", async () => {
    const res = await app.request("/", { method: "GET" }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Object.keys(body).sort()).toEqual(["ok", "service", "version"]);
    expect(body.ok).toBe(true);
    expect(typeof body.service).toBe("string");
    expect(body.service.length).toBeGreaterThan(0);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("needs no session cookie and sets none", async () => {
    const res = await app.request("/", { method: "GET" }, ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not shadow the 404 handler for unknown routes", async () => {
    const res = await app.request("/api/does-not-exist", { method: "GET" }, ENV);
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error_code).toBe(ERROR_CODES.NOT_FOUND);
  });
});
