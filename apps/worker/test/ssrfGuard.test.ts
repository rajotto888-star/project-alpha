// FILE: apps/worker/test/ssrfGuard.test.ts (NEW — v1.1+ true BYOE, NOT part of Lite)
// Placeholder tests for future ssrfGuard.ts
import { describe, it, expect } from "vitest";
import { assertSafeUrl } from "../src/lib/ssrfGuard";

describe("ssrfGuard (v1.1+ placeholder)", () => {
  it("allows https public host", () => {
    expect(() => assertSafeUrl("https://llm.example.com/v1")).not.toThrow();
  });
  it("blocks http", () => {
    expect(() => assertSafeUrl("http://llm.example.com/v1")).toThrow();
  });
  it("blocks localhost", () => {
    expect(() => assertSafeUrl("https://localhost/v1")).toThrow();
    expect(() => assertSafeUrl("https://127.0.0.1/v1")).toThrow();
  });
});

