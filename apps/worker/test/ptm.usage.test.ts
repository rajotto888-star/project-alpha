/**
 * PTM stream usage (§7, owner decision 2026-09-24: implement).
 *
 * PTM streams, so a usage figure only exists if the request asks for one. The
 * adapter therefore opts in EXPLICITLY and only for PTM. These tests pin the
 * three properties that make that safe:
 *
 *   1. the PTM request carries `stream_options.include_usage`;
 *   2. the FCM fast-draft request does NOT — its body stays byte-identical to
 *      the canonical contract, so opting in changed nothing upstream for FCM;
 *   3. usage is surfaced only for the attempt that actually succeeds, and is
 *      ABSENT (never a fabricated 0) when the provider omits the usage frame.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { runCommander } from "../src/orchestrator/runCommander";
import { runPtmWithFailover } from "../src/adapters/ptmFailover";
import { mockOpenAIStream, mockOpenAIFailure } from "./utils/mockProvider";
import { mockOpenAICompletion } from "./utils/mockCompletion";

afterEach(() => vi.unstubAllGlobals());

function fakeD1() {
  return {
    prepare: () => ({
      bind: () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }),
    }),
  } as unknown as D1Database;
}

class RecordingEmitter {
  events: any[] = [];
  meta(requestId: string, manualProviders: unknown) {
    this.events.push({ type: "meta", request_id: requestId, manualProviders });
  }
  phase(phase: string, source?: string) { this.events.push({ type: "phase", phase, source }); }
  chunk(source: string, delta: string) { this.events.push({ type: "chunk", source, delta }); }
  verifierJson(result: unknown) { this.events.push({ type: "verifier_json", result }); }
  patch(payload: unknown) { this.events.push({ type: "patch", payload }); }
  done(args: any) { this.events.push({ type: "done", ...args }); }
  error(args: any) { this.events.push({ type: "error", ...args }); }
  close() { this.events.push({ type: "close" }); }
}

const VERIFIER = JSON.stringify({
  verdict: "verified",
  needs_correction: false,
  confidence: 96,
  corrections: [],
});

/** Capture every request body so PTM vs FCM can be told apart by model. */
function captureBodies(streamFor: (model: string) => Response) {
  const bodies: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init: any) => {
      const url = String(typeof input === "string" ? input : input.url);
      const body = JSON.parse(init.body);
      bodies.push({ url, body });
      if (body.stream) return streamFor(body.model);
      return mockOpenAICompletion(VERIFIER, { totalTokens: 55 });
    }),
  );
  return bodies;
}

/** A stream that reports usage and THEN fails, before any content chunk. */
function usageThenError(totalTokens: number): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [], usage: { total_tokens: totalTokens } })}\n\n`),
      );
      // Deferred: a synchronous controller.error() makes Node drop queued chunks.
      setTimeout(() => controller.error(new Error("upstream cut")), 0);
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function drive(opts: { ptmTokens?: number; fcm?: boolean }) {
  const bodies = captureBodies((model) =>
    model === "gpt-4o"
      ? mockOpenAIStream([{ delta: "Paris." }], { totalTokens: opts.ptmTokens })
      : mockOpenAIStream([{ delta: "draft" }]),
  );

  const emitter = new RecordingEmitter();
  await runCommander({
    userId: "u1",
    db: fakeD1(),
    payload: {
      messages: [{ role: "user", content: "What is the capital of France?" }],
      manual_providers: {
        ptm: { provider_id: "openai", model_id: "gpt-4o" },
        vcm: { provider_id: "groq", model_id: "llama-3.3-70b-versatile" },
        fcm: opts.fcm ? { provider_id: "openai", model_id: "gpt-4o-mini" } : null,
      },
      merge_style: "hybrid",
      enable_fast_draft: opts.fcm,
      router_mode: "manual",
    } as any,
    ephemeralKeys: { openai: "sk-test", groq: "gk-test" },
    signal: new AbortController().signal,
    emitter: emitter as any,
  });
  return { bodies, emitter };
}

describe("PTM stream usage is requested explicitly", () => {
  it("the PTM request carries stream_options.include_usage", async () => {
    const { bodies } = await drive({ ptmTokens: 31 });
    const ptm = bodies.find((b) => b.body.model === "gpt-4o");
    expect(ptm).toBeTruthy();
    expect(ptm.body.stream).toBe(true);
    expect(ptm.body.stream_options).toEqual({ include_usage: true });
  });

  it("the FCM fast-draft request is untouched — no stream_options at all", async () => {
    const { bodies } = await drive({ ptmTokens: 31, fcm: true });
    const fcm = bodies.find((b) => b.body.model === "gpt-4o-mini");
    expect(fcm).toBeTruthy();
    expect(fcm.body.stream).toBe(true);
    // Byte-identical to the canonical FCM contract: the key must be ABSENT, not false.
    expect("stream_options" in fcm.body).toBe(false);
  });

  it("the VCM completion request is unaffected (non-streaming, no stream_options)", async () => {
    const { bodies } = await drive({ ptmTokens: 31 });
    const vcm = bodies.find((b) => b.body.stream !== true);
    expect(vcm).toBeTruthy();
    expect("stream_options" in vcm.body).toBe(false);
  });
});

describe("token_usage.ptm reflects only what the provider actually reported", () => {
  it("is a number when the provider sends a usage frame", async () => {
    const { emitter } = await drive({ ptmTokens: 31 });
    const done = emitter.events.find((e) => e.type === "done");
    expect(done.token_usage.ptm).toBe(31);
    expect(done.token_usage.vcm).toBe(55);
  });

  it("is ABSENT, never a fabricated 0, when the provider omits usage", async () => {
    const { emitter } = await drive({ ptmTokens: undefined });
    const done = emitter.events.find((e) => e.type === "done");
    expect("ptm" in done.token_usage).toBe(false);
    // VCM usage still flows, so this is specific to the missing PTM frame.
    expect(done.token_usage.vcm).toBe(55);
  });
});

describe("a failed attempt never leaks its usage", () => {
  it("reports the successful attempt's usage only, exactly once", async () => {
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempt += 1;
        // Attempt 1 reports 999 tokens and then dies before any content chunk.
        if (attempt === 1) return usageThenError(999);
        if (attempt === 2) return mockOpenAIStream([{ delta: "ok" }], { totalTokens: 11 });
        return mockOpenAIFailure(500);
      }),
    );

    const seen: number[] = [];
    await runPtmWithFailover({
      providerId: "openai",
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      ephemeralKeys: { openai: "sk-test" },
      parentSignal: new AbortController().signal,
      maxAttempts: 3,
      includeUsage: true,
      onUsage: (u) => seen.push(u.total_tokens),
      onChunk: async () => {},
    });

    expect(seen).toEqual([11]); // the dead attempt's 999 never surfaces
  });

  it("stays silent when the request does not opt in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockOpenAIStream([{ delta: "ok" }], { totalTokens: 11 })));

    const seen: number[] = [];
    let sentBody: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: any, init: any) => {
        sentBody = JSON.parse(init.body);
        return mockOpenAIStream([{ delta: "ok" }], { totalTokens: 11 });
      }),
    );

    await runPtmWithFailover({
      providerId: "openai",
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      ephemeralKeys: { openai: "sk-test" },
      parentSignal: new AbortController().signal,
      onUsage: (u) => seen.push(u.total_tokens),
      onChunk: async () => {},
    });

    expect(seen).toEqual([]);
    expect("stream_options" in sentBody).toBe(false);
  });
});

describe("a provider that rejects stream_options never loses the answer", () => {
  it("retries WITHOUT the field on a 400 and still streams the answer", async () => {
    const sentBodies: any[] = [];
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: any, init: any) => {
        attempt += 1;
        sentBodies.push(JSON.parse(init.body));
        // A non-conforming upstream rejects the optional field outright.
        if (attempt === 1) return mockOpenAIFailure(400);
        return mockOpenAIStream([{ delta: "the answer survived" }], { totalTokens: 12 });
      }),
    );

    const deltas: string[] = [];
    const usage: number[] = [];
    await runPtmWithFailover({
      providerId: "openai",
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      ephemeralKeys: { openai: "sk-test" },
      parentSignal: new AbortController().signal,
      maxAttempts: 2,
      includeUsage: true,
      onUsage: (u) => usage.push(u.total_tokens),
      onChunk: async (d) => {
        deltas.push(d);
      },
    });

    // The user gets their answer — telemetry did not cost them anything.
    expect(deltas).toEqual(["the answer survived"]);
    // Attempt 1 asked for usage; the retry deliberately did not.
    expect(sentBodies[0].stream_options).toEqual({ include_usage: true });
    expect("stream_options" in sentBodies[1]).toBe(false);
    // No usage is reported. The retry never asked for it, so we have nothing
    // legitimate to report — even though this mock volunteers a usage frame
    // anyway. Telemetry degrades to *nothing* rather than to a figure we did
    // not request, which is the same contract the opt-out case pins.
    expect(usage).toEqual([]);
  });

  it("a 400 is NOT retried away when usage was never requested", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return mockOpenAIFailure(400);
      }),
    );

    await expect(
      runPtmWithFailover({
        providerId: "openai",
        modelId: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
        ephemeralKeys: { openai: "sk-test" },
        parentSignal: new AbortController().signal,
        maxAttempts: 2,
        onChunk: async () => {},
      }),
    ).rejects.toThrow();

    // Both attempts were the identical plain request — the downgrade is not a
    // second, different guess at what the server wanted.
    expect(calls).toBe(2);
  });
});
