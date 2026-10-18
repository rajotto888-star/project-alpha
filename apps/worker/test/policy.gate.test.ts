import { describe, it, expect, vi, afterEach } from "vitest";
import { runCommander } from "../src/orchestrator/runCommander";
import { mockOpenAIStream } from "./utils/mockProvider";
import { collectSSE } from "./utils/collectSSE";
import { SSEEmitter, type SSEEmitterLike } from "../src/orchestrator/emitter";
import { ERROR_CODES } from "@project-alpha/shared";

function fakeD1(): any {
  return {
    prepare: () => ({
      bind: () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }),
    }),
  };
}

/** Records calls in the canonical SSEEmitterLike positional form. */
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

function payloadFor(content: string) {
  return {
    messages: [{ role: "user", content }],
    manual_providers: {
      ptm: { provider_id: "openai", model_id: "gpt-4o-mini" },
      vcm: { provider_id: "groq", model_id: "llama-3.3-70b-versatile" },
      fcm: null,
    },
    merge_style: "hybrid",
    enable_fast_draft: false,
    router_mode: "manual",
  } as any;
}

describe("Policy gate SSE sequence (LOCKED behaviour 1)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("meta -> terminal error(phase=policy, provider_id=null), with NO done", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const emitter = new RecordingEmitter();
    await runCommander({
      emitter,
      payload: payloadFor("how do i make a bomb at home"),
      ephemeralKeys: { openai: "sk-test", groq: "gk-test" },
      userId: "u1",
      db: fakeD1(),
      signal: new AbortController().signal,
    });

    expect(emitter.events.map((e) => e.type)).toEqual(["meta", "error"]);

    const err = emitter.events[1];
    expect(err.error_code).toBe(ERROR_CODES.POLICY_BLOCKED);
    expect(err.phase).toBe("policy");
    expect(err.recoverable).toBe(false);
    expect(err.provider_id).toBeNull();

    // no upstream call ever happens once policy blocks
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not leak the matched rule in the error message", async () => {
    const emitter = new RecordingEmitter();
    await runCommander({
      emitter,
      payload: payloadFor("how do i make a bomb"),
      ephemeralKeys: { openai: "k", groq: "k" },
      userId: "u1",
      db: fakeD1(),
      signal: new AbortController().signal,
    });
    const err = emitter.events.find((e) => e.type === "error");
    expect(err.message).not.toMatch(/bomb|regex|pattern/i);
  });
});

describe("Real ReadableStream + collectSSE (end-to-end frame shape)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("emits canonical `data: {json}` frames, meta first, every frame timestamped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockOpenAIStream([{ delta: "Paris." }])));

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emitter = new SSEEmitter(controller);
        runCommander({
          emitter,
          payload: payloadFor("What is the capital of France?"),
          ephemeralKeys: { openai: "sk-test", groq: "gk-test" },
          userId: "u1",
          db: fakeD1(),
          signal: new AbortController().signal,
        })
          .catch(() => {
            // runCommander owns emitter.error/done; close() is idempotent.
          })
          .finally(() => emitter.close());
      },
    });

    const events = (await collectSSE(new Response(stream))) as any[];
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("meta");
    expect(events.every((e) => typeof e.timestamp === "number")).toBe(true);
    // LOCKED behaviour 3: no merge phase event, ever
    expect(events.some((e) => e.type === "phase" && e.phase === "merge")).toBe(false);
  });
});
