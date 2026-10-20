/**
 * CROSS-BOUNDARY SHAPE CONTRACT — catalog payload.
 *
 * Why this file exists: the catalog response is the ONE payload that is consumed by
 * a different package (apps/web) with no shared TypeScript type guarding it. An
 * external agent running a mixed build hit both failure modes in the same session:
 *
 *   1. `selectable` absent from the server payload
 *      -> apps/web filters `p.implemented && p.selectable` -> 0 providers
 *      -> UI: "No selectable providers returned by the catalog."
 *
 *   2. `models` as objects (`[{id, name}]`) instead of strings
 *      -> `<option>{model}</option>` renders an object -> React throws
 *      -> "Objects are not valid as a React child (found: object with keys {id, name})"
 *
 * Neither bug is reachable from the worker's own type checker, so it is pinned here
 * as a runtime shape contract. If you change the payload, change these tests AND
 * `apps/web/src/components/ProviderSettings.tsx` together.
 */
import { describe, it, expect } from "vitest";
import app from "../src/index";

const ENV = {
  APP_URL: "http://127.0.0.1:8787",
  APP_ORIGIN: "http://127.0.0.1:5173",
  COOKIE_SECURE: "false",
  SESSION_SECRET: "test-secret",
} as any;

async function getCatalog() {
  const res = await app.request("/api/providers/catalog", { method: "GET" }, ENV);
  expect(res.status).toBe(200);
  return (await res.json()) as { providers: any[] };
}

describe("catalog payload shape (web <-> worker contract)", () => {
  it("exposes exactly the 4 public-safe keys per provider — no baseUrl, no name", async () => {
    const body = await getCatalog();
    expect(body.providers.length).toBe(12);
    for (const p of body.providers) {
      expect(Object.keys(p).sort()).toEqual(["id", "implemented", "models", "selectable"]);
    }
  });

  it("models MUST be an array of strings (never objects)", async () => {
    const body = await getCatalog();
    for (const p of body.providers) {
      expect(Array.isArray(p.models)).toBe(true);
      for (const m of p.models) {
        expect(typeof m).toBe("string");
        expect(m.length).toBeGreaterThan(0);
      }
    }
  });

  it("selectable providers are openai + groq, each with >= 1 model", async () => {
    const body = await getCatalog();
    const selectable = body.providers.filter((p) => p.implemented && p.selectable);
    expect(selectable.map((p) => p.id).sort()).toEqual([
      "colab",
      "groq",
      "hf-space",
      "kaggle",
      "openai",
      "openrouter",
      "private-llama",
      "private-smollm",
    ]);
    for (const p of selectable) expect(p.models.length).toBeGreaterThan(0);
  });

  it("unimplemented providers stay in the list but are neither implemented nor selectable", async () => {
    const body = await getCatalog();
    const rest = body.providers.filter((p) => !p.implemented);
    expect(rest.map((p) => p.id).sort()).toEqual(["anthropic", "deepseek", "gemini", "mistral"]);
    for (const p of rest) {
      expect(p.selectable).toBe(false);
      expect(p.models).toEqual([]);
    }
  });

  it("never leaks upstream base URLs to an anonymous caller", async () => {
    const res = await app.request("/api/providers/catalog", { method: "GET" }, ENV);
    const raw = await res.text();
    expect(raw).not.toContain("api.openai.com");
    expect(raw).not.toContain("api.groq.com");
    expect(raw).not.toContain("openrouter.ai");
    expect(raw).not.toContain("baseUrl");
    // BYOE Lite: even private gateway URLs must not leak
    expect(raw).not.toContain("<REAL-GATEWAY>");
    expect(JSON.stringify(JSON.parse(raw))).not.toContain("https://");
  });
});

