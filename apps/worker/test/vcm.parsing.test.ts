/**
 * VCM output parsing — written against the canonical adapters/vcm.ts exports:
 * extractStrictJson, normalizeVerifierResult, deriveTopLevelSeverity.
 *
 * LOCKED (behaviour 12): VerifierResult.severity is SERVER-COMPUTED as
 * max(corrections[].severity); a raw top-level severity from the model is
 * ignored. corrections[].severity can never be "none".
 */
import { describe, it, expect } from "vitest";
import { extractStrictJson, normalizeVerifierResult, deriveTopLevelSeverity } from "../src/adapters/vcm";

describe("extractStrictJson", () => {
  it("parses a bare JSON object", () => {
    const parsed = extractStrictJson('{"needs_correction":false,"confidence":90}') as any;
    expect(parsed.needs_correction).toBe(false);
    expect(parsed.confidence).toBe(90);
  });

  it("parses JSON wrapped in markdown fences", () => {
    const parsed = extractStrictJson('```json\n{"confidence":100}\n```') as any;
    expect(parsed.confidence).toBe(100);
  });

  it("parses JSON wrapped in prose via the braced fallback", () => {
    const parsed = extractStrictJson('Sure!\n{"confidence":85}\nHope that helps.') as any;
    expect(parsed.confidence).toBe(85);
  });

  it("does not terminate early on a brace inside a string value", () => {
    const parsed = extractStrictJson('{"notes":"use { and } carefully","confidence":7}') as any;
    expect(parsed.notes).toBe("use { and } carefully");
    expect(parsed.confidence).toBe(7);
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractStrictJson("no json here at all")).toThrow(/VCM_PARSE_FAILED/);
  });

  it("throws on an unterminated object", () => {
    expect(() => extractStrictJson('{"confidence": 5')).toThrow(/VCM_PARSE_FAILED/);
  });
});

describe("deriveTopLevelSeverity (SERVER-COMPUTED)", () => {
  const c = (severity: "minor" | "major" | "critical") => ({ issue: "x", severity });

  it("is 'none' when there are no corrections", () => {
    expect(deriveTopLevelSeverity([])).toBe("none");
  });

  it("is the single correction's severity when there is one", () => {
    expect(deriveTopLevelSeverity([c("major")])).toBe("major");
  });

  it("is the MAX across many corrections", () => {
    expect(deriveTopLevelSeverity([c("minor"), c("critical"), c("major")])).toBe("critical");
    expect(deriveTopLevelSeverity([c("minor"), c("major")])).toBe("major");
    expect(deriveTopLevelSeverity([c("minor"), c("minor")])).toBe("minor");
  });
});

describe("normalizeVerifierResult", () => {
  it("rejects non-objects, null and arrays", () => {
    expect(() => normalizeVerifierResult(null)).toThrow(/VCM_PARSE_FAILED/);
    expect(() => normalizeVerifierResult([])).toThrow(/VCM_PARSE_FAILED/);
    expect(() => normalizeVerifierResult("nope")).toThrow(/VCM_PARSE_FAILED/);
    expect(() => normalizeVerifierResult(42)).toThrow(/VCM_PARSE_FAILED/);
  });

  it("clamps confidence into 0..100 and defaults it to 0", () => {
    expect(normalizeVerifierResult({ confidence: 180 }).confidence).toBe(100);
    expect(normalizeVerifierResult({ confidence: -20 }).confidence).toBe(0);
    expect(normalizeVerifierResult({}).confidence).toBe(0);
    // a non-number is coerced to the default rather than passed through
    expect(normalizeVerifierResult({ confidence: "88" }).confidence).toBe(0);
  });

  it("defaults verdict to 'unknown' and needs_correction to false", () => {
    const r = normalizeVerifierResult({});
    expect(r.verdict).toBe("unknown");
    expect(r.needs_correction).toBe(false);
  });

  it("always returns a corrections array", () => {
    expect(normalizeVerifierResult({}).corrections).toEqual([]);
    expect(normalizeVerifierResult({ corrections: "not-an-array" }).corrections).toEqual([]);
  });

  it("normalizes an unknown per-correction severity to 'minor' (never 'none')", () => {
    const r = normalizeVerifierResult({
      corrections: [{ issue: "a", severity: "catastrophic" }, { issue: "b" }],
    });
    expect(r.corrections.map((c) => c.severity)).toEqual(["minor", "minor"]);
    expect(r.corrections.some((c) => c.severity === ("none" as any))).toBe(false);
  });

  it("keeps valid per-correction severities", () => {
    const r = normalizeVerifierResult({
      corrections: [{ issue: "a", severity: "critical" }, { issue: "b", severity: "minor" }],
    });
    expect(r.corrections.map((c) => c.severity)).toEqual(["critical", "minor"]);
  });

  it("defaults a missing issue string to 'unspecified issue'", () => {
    const r = normalizeVerifierResult({ corrections: [{ severity: "major" }] });
    expect(r.corrections[0].issue).toBe("unspecified issue");
  });

  it("carries optional location and notes through when they are strings", () => {
    const r = normalizeVerifierResult({
      notes: "some note",
      corrections: [{ issue: "a", location: "para 2", severity: "minor" }],
    });
    expect(r.notes).toBe("some note");
    expect(r.corrections[0].location).toBe("para 2");
  });

  it("IGNORES a raw top-level severity and recomputes it from corrections (LOCKED)", () => {
    const r = normalizeVerifierResult({
      severity: "critical", // model-supplied — must be discarded
      corrections: [{ issue: "a", severity: "minor" }],
    });
    expect(r.severity).toBe("minor");
  });

  it("computes 'none' when needs_correction is set but corrections are empty", () => {
    const r = normalizeVerifierResult({ needs_correction: true, corrections: [] });
    expect(r.severity).toBe("none");
  });
});
