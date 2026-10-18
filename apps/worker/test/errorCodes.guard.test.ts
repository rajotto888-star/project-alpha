import { describe, it, expect } from "vitest";
import { assertKnownErrorCode } from "../src/orchestrator/assertKnownErrorCode";

describe("ERROR_CODES enforcement (L2 lock)", () => {
  it("accepts known canonical codes", () => {
    expect(() => assertKnownErrorCode("POLICY_BLOCKED")).not.toThrow();
    expect(() => assertKnownErrorCode("VCM_ALL_ATTEMPTS_FAILED")).not.toThrow();
  });
  it("rejects any ad-hoc / unknown code", () => {
    expect(() => assertKnownErrorCode("SOME_RANDOM_CODE")).toThrow();
  });
});
