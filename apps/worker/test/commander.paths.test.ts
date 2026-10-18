/**
 * Orchestrator path tests: full SSE ordering on the success path, both merge patch modes,
 * and the LOCKED distinction between an FCM deadline miss and an FCM provider failure.
 *
 * Written against the canonical contracts:
 *   - SSEEmitterLike is positional: meta(id, providers), phase(phase, source?),
 *     chunk(source, delta), verifierJson(result), patch(payload), done(args), error(args)
 *   - ChunkSource is "fcm" | "ptm"
 *   - runCommander takes a single args object that carries the emitter
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { runCommander } from "../src/orchestrator/runCommander";
import { mockOpenAIStream, mockOpenAIFailure, mockSlowStream } from "./utils/mockProvider";
import { mockOpenAICompletion } from "./utils/mockCompletion";
import { ERROR_CODES } from "@project-alpha/shared";
import type { SSEEmitterLike } from "../src/orchestrator/emitter";

function fakeD1(): any {
  return {
    prepare: () => ({
      bind: () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }),
    }),
  };
}

class RecordingEmitter implements SSEEmitterLike {
  events: any[] = [];
  meta(requestId: string, manualProviders: unknown) {
    this.events.push({ type: "meta", request_id: requestId, manualProviders });
  }
  phase(phase: string, source?: string) {
    this.events.push({ type: "phase", phase, source });
  }
  chunk(source: string, delta: string) {
    this.events.push({ type: "chunk", source, delta });
  }
  verifierJson(result: unknown) {
    this.events.push({ type: "verifier_json", result });
  }
  patch(payload: unknown) {
    this.events.push({ type: "patch", payload });
  }
  done(args: unknown) {
    this.events.push({ type: "done", args });
  }
  error(args: any) {
    this.events.push({ type: "error", ...args });
  }
  close() {
    this.events.push({ type: "close" });
  }
}

function payload(over: Record<string, unknown> = {}) {
  return {
    messages: [{ role: "user", content: "What is the capital of France?" }],
    manual_providers: {
      ptm: { provider_id: "openai", model_id: "gpt-4o-mini" },
      vcm: { provider_id: "groq", model_id: "llama-3.3-70b-versatile" },
      fcm: null,
    },
    merge_style: "hybrid",
    enable_fast_draft: false,
    router_mode: "manual",
    ...over,
  } as any;
}

async function run(p: any, emitter: RecordingEmitter) {
  await runCommander({
    emitter,
    payload: p,
    ephemeralKeys: { openai: "sk-test", groq: "gk-test" },
    userId: "u1",
    db: fakeD1(),
    signal: new AbortController().signal,
  });
  return emitter.events;
}

/** Canonical VCM JSON: no top-level severity (server computes it). */
const verifier = (o: Record<string, unknown>) =>
  JSON.stringify({ verdict: "ok", corrections: [], ...o });

describe("Full success path — canonical SSE ordering", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("meta -> phase(primary_answer) -> chunk* -> phase(verification) -> verifier_json -> done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(typeof input === "string" ? input : input.url);
        if (url.includes("openai.com")) return mockOpenAIStream([{ delta: "Paris" }, { delta: " is the capital." }]);
        return mockOpenAICompletion(verifier({ needs_correction: false, confidence: 98 }), { totalTokens: 42 });
      }),
    );

    const events = await run(payload(), new RecordingEmitter());
    const shape = events.map((e) => (e.type === "phase" ? `phase:${e.phase}` : e.type));

    expect(shape).toEqual([
      "meta",
      "phase:primary_answer",
      "chunk",
      "chunk",
      "phase:verification",
      "verifier_json",
      "done",
    ]);

    // LOCKED behaviour 3: no merge phase event, ever
    expect(shape).not.toContain("phase:merge");
    // no corrections -> merge decision "none" -> no patch
    expect(shape).not.toContain("patch");

    const done = events.find((e) => e.type === "done").args;
    expect(done.final_verdict).toBe("verified");
    expect(done.vcm).not.toBeNull();
    expect(typeof done.latencies.ptm).toBe("number");
    expect(typeof done.latencies.vcm).toBe("number");
    // §7: token_usage.vcm is a NUMBER plumbed from the upstream completion
    expect(done.token_usage.vcm).toBe(42);

    // chunk deltas arrive in order, tagged with the ptm source
    const chunks = events.filter((e) => e.type === "chunk");
    expect(chunks.map((c) => c.delta)).toEqual(["Paris", " is the capital."]);
    expect(chunks.every((c) => c.source === "ptm")).toBe(true);
  });
});

describe("Merge patch modes over the wire", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function runWithVerifier(vJson: string, merge_style: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(typeof input === "string" ? input : input.url);
        if (url.includes("openai.com")) return mockOpenAIStream([{ delta: "The answer is 4." }]);
        return mockOpenAICompletion(vJson, { totalTokens: 42 });
      }),
    );
    return run(payload({ merge_style }), new RecordingEmitter());
  }

  it("hybrid + confidence>=80 + critical -> patch mode 'replace' with corrected_answer null", async () => {
    const events = await runWithVerifier(
      verifier({
        needs_correction: true,
        confidence: 95,
        corrections: [{ issue: "arithmetically wrong", severity: "critical" }],
      }),
      "hybrid",
    );
    const patch = events.find((e) => e.type === "patch").payload;
    expect(patch.mode).toBe("replace");
    expect(patch.corrected_answer).toBeNull(); // LOCKED: server never fabricates
    // verifier_json must precede patch
    const order = events.map((e) => e.type);
    expect(order.indexOf("verifier_json")).toBeLessThan(order.indexOf("patch"));
  });

  it("hybrid + low confidence -> patch mode 'patch' carrying the unmodified PTM text", async () => {
    const events = await runWithVerifier(
      verifier({
        needs_correction: true,
        confidence: 40,
        corrections: [{ issue: "imprecise wording", severity: "major" }],
      }),
      "hybrid",
    );
    const patch = events.find((e) => e.type === "patch").payload;
    expect(patch.mode).toBe("patch");
    expect(patch.corrected_answer).toBe("The answer is 4.");
  });

  it("always_replace forces replace even for a minor issue", async () => {
    const events = await runWithVerifier(
      verifier({
        needs_correction: true,
        confidence: 20,
        corrections: [{ issue: "style", severity: "minor" }],
      }),
      "always_replace",
    );
    expect(events.find((e) => e.type === "patch").payload.mode).toBe("replace");
  });

  it("final_verdict stays 'verified' even when a patch is applied", async () => {
    const events = await runWithVerifier(
      verifier({
        needs_correction: true,
        confidence: 95,
        corrections: [{ issue: "wrong", severity: "critical" }],
      }),
      "hybrid",
    );
    expect(events.find((e) => e.type === "done").args.final_verdict).toBe("verified");
  });
});

describe("FCM: deadline miss vs provider failure (LOCKED behaviour 15 — must not be conflated)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fcmPayload() {
    return payload({
      enable_fast_draft: true,
      manual_providers: {
        ptm: { provider_id: "openai", model_id: "gpt-4o-mini" },
        vcm: { provider_id: "groq", model_id: "llama-3.3-70b-versatile" },
        fcm: { provider_id: "groq", model_id: "llama-3.1-8b-instant" },
      },
    });
  }

  it("slow FCM past the 500ms deadline -> FCM_DEADLINE_MISSED (recoverable), request still completes", async () => {
    let groqCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(typeof input === "string" ? input : input.url);
        if (url.includes("openai.com")) return mockOpenAIStream([{ delta: "Paris." }]);
        groqCalls += 1;
        if (groqCalls === 1) return mockSlowStream(1200); // FCM: too slow, misses the deadline
        return mockOpenAICompletion(verifier({ needs_correction: false, confidence: 99 }), { totalTokens: 42 }); // VCM
      }),
    );

    const events = await run(fcmPayload(), new RecordingEmitter());
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    expect(err.error_code).toBe(ERROR_CODES.FCM_DEADLINE_MISSED);
    expect(err.phase).toBe("fast_draft");
    expect(err.recoverable).toBe(true);

    // FCM failure must NOT kill the request
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done.args.final_verdict).toBe("verified");
  }, 15_000);

  it("FCM provider HTTP failure -> FCM_PROVIDER_ERROR, NOT FCM_DEADLINE_MISSED", async () => {
    let groqCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(typeof input === "string" ? input : input.url);
        if (url.includes("openai.com")) return mockOpenAIStream([{ delta: "Paris." }]);
        groqCalls += 1;
        if (groqCalls === 1) return mockOpenAIFailure(500); // FCM: real provider error
        return mockOpenAICompletion(verifier({ needs_correction: false, confidence: 99 }), { totalTokens: 42 }); // VCM
      }),
    );

    const events = await run(fcmPayload(), new RecordingEmitter());
    const codes = events.filter((e) => e.type === "error").map((e) => e.error_code);
    expect(codes).toContain(ERROR_CODES.FCM_PROVIDER_ERROR);
    expect(codes).not.toContain(ERROR_CODES.FCM_DEADLINE_MISSED);
    expect(events.find((e) => e.type === "done")).toBeDefined();
  }, 15_000);

  it("a fast FCM streams fast_draft chunks and emits no error", async () => {
    let groqCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(typeof input === "string" ? input : input.url);
        if (url.includes("openai.com")) return mockOpenAIStream([{ delta: "Paris." }]);
        groqCalls += 1;
        if (groqCalls === 1) return mockOpenAIStream([{ delta: "Pa" }]); // FCM: well inside the deadline
        return mockOpenAICompletion(verifier({ needs_correction: false, confidence: 99 }), { totalTokens: 42 });
      }),
    );

    const events = await run(fcmPayload(), new RecordingEmitter());
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
    const draft = events.filter((e) => e.type === "chunk" && e.source === "fcm");
    expect(draft.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "phase" && e.phase === "fast_draft")).toBe(true);
    expect(events.find((e) => e.type === "chunk" && e.source === "ptm")).toBeDefined();
  }, 15_000);
});
