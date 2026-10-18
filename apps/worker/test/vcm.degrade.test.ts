import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCommander } from "../src/orchestrator/runCommander";
import type { SSEEmitterLike } from "../src/orchestrator/emitter";
import type { ChatStreamRequest } from "@project-alpha/shared";
import * as vcmModule from "../src/adapters/vcm";
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

describe("VCM degradation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("emits recoverable error then done(unverified, vcm:null) when VCM exhausts retries", async () => {
    vi.spyOn(ptmModule, "runPtmWithFailover").mockImplementation(async (args) => {
      await args.onChunk("hello world");
    });
    vi.spyOn(vcmModule, "runVcmWithRetries").mockRejectedValue(new Error("all VCM attempts failed"));

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

    const types = emitter.events.map((e) => e.type);
    expect(types).not.toContain("verifier_json");
    expect(types).not.toContain("patch");

    const errorEvent = emitter.events.find((e) => e.type === "error");
    expect(errorEvent.args.phase).toBe("verification");
    expect(errorEvent.args.recoverable).toBe(true);
    expect(errorEvent.args.error_code).toBe("VCM_ALL_ATTEMPTS_FAILED");

    const doneEvent = emitter.events.find((e) => e.type === "done");
    expect(doneEvent.args.final_verdict).toBe("unverified");
    expect(doneEvent.args.vcm).toBeNull();
  });
});
