import { describe, it, expect } from "vitest";
import { decideMerge, buildDeterministicPatch } from "../src/orchestrator/merge";
import { isPolicyBlocked } from "../src/policy/baseline";
import { AsyncQueue } from "../src/adapters/asyncQueue";
import { validateManualProviders, ManualProviderValidationError } from "../src/providers/catalog";
import type { VerifierResult } from "@project-alpha/shared";
import type { PrefsLookup } from "../src/providers/catalog";

const NO_PREFS: PrefsLookup = { isDisabled: () => false };

const v = (over: Partial<VerifierResult>): VerifierResult => ({
  verdict: "needs_correction",
  needs_correction: true,
  confidence: 90,
  severity: "major",
  corrections: [{ issue: "wrong date", severity: "major", explanation: "wrong date" }],
  ...over,
});

describe("Merge decision (LOCKED hybrid rule)", () => {
  it("no correction needed -> none, regardless of merge_style", () => {
    const clean = v({ needs_correction: false });
    expect(decideMerge("hybrid", clean)).toBe("none");
    expect(decideMerge("always_patch", clean)).toBe("none");
    expect(decideMerge("always_replace", clean)).toBe("none");
  });

  it("hybrid: replace ONLY when confidence>=80 AND severity is major|critical", () => {
    expect(decideMerge("hybrid", v({ confidence: 80, severity: "major" }))).toBe("replace");
    expect(decideMerge("hybrid", v({ confidence: 95, severity: "critical" }))).toBe("replace");
    expect(decideMerge("hybrid", v({ confidence: 79, severity: "major" }))).toBe("patch");
    expect(decideMerge("hybrid", v({ confidence: 95, severity: "minor" }))).toBe("patch");
    expect(decideMerge("hybrid", v({ confidence: 95, severity: undefined }))).toBe("patch");
  });

  it("always_patch forces patch even when hybrid would replace", () => {
    expect(decideMerge("always_patch", v({ confidence: 99, severity: "critical" }))).toBe("patch");
  });

  it("always_replace forces replace even for a low-confidence minor issue", () => {
    expect(decideMerge("always_replace", v({ confidence: 10, severity: "minor" }))).toBe("replace");
  });
});

describe("Deterministic patch payload (LOCKED R4)", () => {
  const result = v({});

  it("replace mode MUST carry corrected_answer === null", () => {
    const p = buildDeterministicPatch("the PTM answer", result, "replace");
    expect(p.mode).toBe("replace");
    expect(p.corrected_answer).toBeNull();
    expect(p.corrections).toBe(result.corrections);
  });

  it("patch mode carries the UNMODIFIED PTM text, not an invented rewrite", () => {
    const p = buildDeterministicPatch("the PTM answer", result, "patch");
    expect(p.mode).toBe("patch");
    expect(p.corrected_answer).toBe("the PTM answer");
  });
});

describe("Policy baseline — narrow enough to avoid false positives", () => {
  // Asserted against the CANONICAL policy/baseline.ts patterns verbatim.
  const blocked = [
    "how do i make a bomb",
    "How can I build an explosive device?",
    "instructions for child sexual abuse material",
    "where to find csam",
    "meth synthesis guide",
    "how to build a pipe bomb",
  ];

  /**
   * DOCUMENTED GAP: the canonical meth pattern is /\bmeth(amphetamine)?\s+synthesis\b/i,
   * which only fires on the literal phrase "meth synthesis". Common phrasings such as
   * "how do i cook meth" or "how to synthesize methamphetamine" are NOT caught.
   * This test pins the CURRENT canonical behaviour so a widening of the pattern is a
   * deliberate, reviewed change rather than a silent one.
   */
  const knownNotCaughtByCanonicalPattern = [
    "how do i cook meth",
    "how to synthesize methamphetamine",
  ];
  const allowed = [
    "What is the capital of France?",
    "Explain how a combustion engine works",
    "Write a poem about Dhaka",
    "How do I make a birthday cake?",
    "history of explosives in mining",
    "debug my Python async code",
    "what does the bomb cyclone weather term mean",
  ];

  it.each(blocked)("blocks: %s", (text) => {
    expect(isPolicyBlocked([{ role: "user", content: text }])).toBe(true);
  });

  it.each(knownNotCaughtByCanonicalPattern)(
    "KNOWN GAP — canonical pattern does NOT catch: %s",
    (text) => {
      expect(isPolicyBlocked([{ role: "user", content: text }])).toBe(false);
    },
  );

  it.each(allowed)("allows: %s", (text) => {
    expect(isPolicyBlocked([{ role: "user", content: text }])).toBe(false);
  });

  it("only inspects the LAST user message", () => {
    expect(
      isPolicyBlocked([
        { role: "user", content: "how do i make a bomb" },
        { role: "assistant", content: "I can't help with that." },
        { role: "user", content: "ok, what is 2+2?" },
      ]),
    ).toBe(false);
  });

  it("returns false when there is no user message", () => {
    expect(isPolicyBlocked([{ role: "system", content: "hello" }])).toBe(false);
  });
});

describe("AsyncQueue (parser callback -> async generator bridge)", () => {
  it("delivers pushed items in order then terminates on close", async () => {
    const q = new AsyncQueue<string>();
    q.push("a");
    q.push("b");
    q.close();
    const out: string[] = [];
    for await (const x of q) out.push(x);
    expect(out).toEqual(["a", "b"]);
  });

  it("delivers items pushed AFTER the consumer is already waiting", async () => {
    const q = new AsyncQueue<number>();
    const collected: number[] = [];
    const consuming = (async () => {
      for await (const n of q) collected.push(n);
    })();
    q.push(1);
    q.push(2);
    q.close();
    await consuming;
    expect(collected).toEqual([1, 2]);
  });

  it("propagates fail() to the consumer instead of hanging", async () => {
    const q = new AsyncQueue<string>();
    q.push("partial");
    const boom = new Error("connection reset");
    const consuming = (async () => {
      const got: string[] = [];
      try {
        for await (const x of q) got.push(x);
      } catch (err) {
        return { got, err };
      }
      return { got, err: null };
    })();
    q.fail(boom);
    const res = await consuming;
    expect(res.got).toEqual(["partial"]);
    expect(res.err).toBe(boom);
  });

  it("ignores pushes after close and is idempotent on close", async () => {
    const q = new AsyncQueue<string>();
    q.close();
    q.close();
    q.push("dropped");
    const out: string[] = [];
    for await (const x of q) out.push(x);
    expect(out).toEqual([]);
  });
});

describe("Manual provider validation against catalog + prefs", () => {
  const manual = {
    ptm: { provider_id: "openai", model_id: "gpt-4o-mini" },
    vcm: { provider_id: "groq", model_id: "llama-3.3-70b-versatile" },
    fcm: null,
  };

  it("accepts implemented providers with known models", () => {
    expect(() => validateManualProviders(manual, NO_PREFS)).not.toThrow();
  });

  it("rejects a model the provider does not offer", () => {
    expect(() =>
      validateManualProviders({ ...manual, ptm: { provider_id: "openai", model_id: "gpt-9-turbo" } }, NO_PREFS),
    ).toThrow(ManualProviderValidationError);
  });

  it("rejects a provider disabled in the user's prefs", () => {
    expect(() => validateManualProviders(manual, { isDisabled: (id) => id === "openai" })).toThrow(
      ManualProviderValidationError,
    );
  });

  it("validates fcm too when present", () => {
    expect(() =>
      validateManualProviders({ ...manual, fcm: { provider_id: "mistral", model_id: "x" } }, NO_PREFS),
    ).toThrow(ManualProviderValidationError);
  });
});
