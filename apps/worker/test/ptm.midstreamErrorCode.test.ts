import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCommander } from "../src/orchestrator/runCommander";
import type { SSEEmitterLike } from "../src/orchestrator/emitter";
import type { ChatStreamRequest } from "@project-alpha/shared";
import * as ptmModule from "../src/adapters/ptmFailover";

class RecordingEmitter implements SSEEmitterLike {
  events: any[] = [];
  meta(requestId: string, manualProviders: unknown) {
    this.events.push({ type: "meta", requestId, manualProviders });
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
  error(args: unknown) {
    this.events.push({ type: "error", args });
  }
  close() {
    this.events.push({ type: "close" });
  }
}

describe("PTM midstream terminal error code", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports PTM_TERMINAL_MIDSTREAM after one emitted chunk, no retry, no done, no verifier_json", async () => {
    let fetchCallCount = 0;
    vi.spyOn(ptmModule, "runPtmWithFailover").mockImplementation(async (args) => {
      fetchCallCount += 1;
      await args.onChunk("partial answer");
      const err = new Error("hard upstream failure") as ptmModule.PtmTaggedError;
      err.isPtmMidstream = true;
      throw err;
    });

    const emitter = new RecordingEmitter();
    const payload: ChatStreamRequest = {
      messages: [{ role: "user", content: "hi" }],
      manual_providers: {
        ptm: { provider_id: "openai", model_id: "gpt-4o-mini" },
        vcm: { provider_id: "groq", model_id: "llama-3.3-70b-versatile" },
        fcm: null,
      },
      merge_style: "hybrid",
      enable_fast_draft: false,
      router_mode: "manual",
    };

    const fakeDb = { prepare: () => ({ bind: () => ({ run: async () => {} }) }) } as unknown as D1Database;

    await runCommander({
      emitter,
      payload,
      ephemeralKeys: { openai: "k1", groq: "k2" },
      userId: "user-1",
      db: fakeDb,
      signal: new AbortController().signal,
    });

    expect(fetchCallCount).toBe(1);

    const types = emitter.events.map((e) => e.type);
    expect(types).not.toContain("done");
    expect(types).not.toContain("verifier_json");

    const chunkEvent = emitter.events.find((e) => e.type === "chunk");
    expect(chunkEvent.delta).toBe("partial answer");

    const errorEvent = emitter.events.find((e) => e.type === "error");
    expect(errorEvent.args.error_code).toBe("PTM_TERMINAL_MIDSTREAM");
    expect(errorEvent.args.recoverable).toBe(false);
  });
});
