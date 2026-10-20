// FILE: apps/worker/test/ssrfGuard.test.ts — v8.06 hardened + Android Private LM support
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
  it("blocks http for public providers", () => {
    expect(() => assertSafeUrl("http://llm.example.com/v1")).toThrow();
    expect(() => assertSafeUrl("http://llm.example.com/v1", { providerId: "groq" })).toThrow();
  });
  it("allows http for local providers with private IP (Android Private LM)", () => {
    expect(() => assertSafeUrl("http://192.168.1.10:8080/v1", { providerId: "private-llama", allowPrivate: true, allowHttp: true })).not.toThrow();
    expect(() => assertSafeUrl("http://10.0.0.5:11434/v1", { providerId: "private-llama", allowPrivate: true, allowHttp: true })).not.toThrow();
    expect(() => assertSafeUrl("https://192.168.1.10:8080/v1", { providerId: "private-llama", allowPrivate: true })).not.toThrow();
  });
  it("blocks localhost for public providers, allows for local", () => {
    expect(() => assertSafeUrl("https://localhost/v1")).toThrow();
    expect(() => assertSafeUrl("https://localhost/v1", { providerId: "groq" })).toThrow();
    expect(() => assertSafeUrl("https://localhost/v1", { providerId: "private-llama", allowPrivate: true })).not.toThrow();
  });
  it("blocks private IPv4 ranges for public, allows for local", () => {
    expect(() => assertSafeUrl("https://10.0.0.1/v1")).toThrow();
    expect(() => assertSafeUrl("https://192.168.1.1/v1")).toThrow();
    expect(() => assertSafeUrl("https://172.16.5.4/v1")).toThrow();
    expect(() => assertSafeUrl("https://10.0.0.1/v1", { providerId: "private-llama", allowPrivate: true })).not.toThrow();
    expect(() => assertSafeUrl("https://192.168.1.1/v1", { providerId: "colab", allowPrivate: true })).not.toThrow();
    expect(() => assertSafeUrl("https://169.254.169.254/v1")).toThrow(); // metadata always blocked
  });
  it("blocks metadata and internal TLD", () => {
    expect(() => assertSafeUrl("https://metadata.google.internal/v1")).toThrow();
    expect(() => assertSafeUrl("https://myservice.internal/v1")).toThrow();
  });
  it("blocks non-443 port for public, allows common LLM ports for local", () => {
    expect(() => assertSafeUrl("https://example.com:8080/v1")).toThrow();
    expect(() => assertSafeUrl("https://192.168.1.10:8080/v1", { providerId: "private-llama", allowPrivate: true })).not.toThrow();
    expect(() => assertSafeUrl("http://192.168.1.10:11434/v1", { providerId: "private-llama", allowPrivate: true, allowHttp: true })).not.toThrow();
  });
});

