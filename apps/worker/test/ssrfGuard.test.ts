// FILE: apps/worker/test/ssrfGuard.test.ts — v8.06 hardened
import { describe, it, expect } from "vitest";
import { assertSafeUrl } from "../src/lib/ssrfGuard";

describe("ssrfGuard hardened for custom baseUrl", () => {
  it("allows https public host", () => {
    expect(() => assertSafeUrl("https://llm.example.com/v1")).not.toThrow();
  });
  it("allows hf.space and trycloudflare.com", () => {
    expect(() => assertSafeUrl("https://my-space.hf.space/v1")).not.toThrow();
    expect(() => assertSafeUrl("https://abc-123.trycloudflare.com/v1")).not.toThrow();
    expect(() => assertSafeUrl("https://alpha-llm-gateway.rajotto888.workers.dev/v1")).not.toThrow();
  });
  it("blocks http", () => {
    expect(() => assertSafeUrl("http://llm.example.com/v1")).toThrow();
  });
  it("blocks localhost and 127.0.0.1", () => {
    expect(() => assertSafeUrl("https://localhost/v1")).toThrow();
    expect(() => assertSafeUrl("https://127.0.0.1/v1")).toThrow();
    expect(() => assertSafeUrl("https://127.0.0.1:443/v1")).toThrow();
  });
  it("blocks private IPv4 ranges", () => {
    expect(() => assertSafeUrl("https://10.0.0.1/v1")).toThrow();
    expect(() => assertSafeUrl("https://192.168.1.1/v1")).toThrow();
    expect(() => assertSafeUrl("https://172.16.5.4/v1")).toThrow();
    expect(() => assertSafeUrl("https://169.254.169.254/v1")).toThrow();
  });
  it("blocks metadata and internal TLD", () => {
    expect(() => assertSafeUrl("https://metadata.google.internal/v1")).toThrow();
    expect(() => assertSafeUrl("https://myservice.internal/v1")).toThrow();
  });
  it("blocks non-443 port", () => {
    expect(() => assertSafeUrl("https://example.com:8080/v1")).toThrow();
  });
});

