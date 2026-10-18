import { COST_DISCLAIMER, type ErrorCode } from "@project-alpha/shared";
import type {
  ChunkSource,
  ErrorPhase,
  PatchPayload,
  PhaseName,
  VerifierResult,
} from "@project-alpha/shared";
import { assertKnownErrorCode } from "./assertKnownErrorCode";

type State = "INIT" | "STREAMING" | "TERMINAL";

export interface SSEEmitterLike {
  meta(
    requestId: string,
    manualProviders: {
      fcm: { provider_id: string; model_id: string } | null;
      ptm: { provider_id: string; model_id: string };
      vcm: { provider_id: string; model_id: string };
    },
  ): void;
  phase(phase: PhaseName, source?: ChunkSource): void;
  chunk(source: ChunkSource, delta: string): void;
  verifierJson(result: VerifierResult): void;
  patch(payload: PatchPayload): void;
  done(args: {
    final_verdict: "verified" | "unverified";
    vcm: VerifierResult | null;
    latencies: Record<string, number>;
    token_usage: Record<string, number>;
    cost_estimate: number;
  }): void;
  error(args: {
    error_code: ErrorCode;
    message: string;
    recoverable: boolean;
    phase: ErrorPhase | null;
    provider_id: string | null;
  }): void;
  close(): void;
}

// LOCKED: this emitter must never silently no-op on out-of-state calls — it
// must throw. Silent no-ops previously let runPtmWithFailover believe a
// chunk was truly emitted when it was actually dropped, corrupting the
// LOCKED PTM failover boundary.
export class SSEEmitter implements SSEEmitterLike {
  private state: State = "INIT";
  private encoder = new TextEncoder();
  private chunkIndex = new Map<ChunkSource, number>();
  private phasesSeen = new Set<PhaseName>();
  private verifierJsonEmitted = false;
  private patchEmitted = false;
  private terminatedWithNonRecoverableError = false;

  constructor(private controller: ReadableStreamDefaultController<Uint8Array>) {}

  private write(obj: unknown): void {
    const line = `data: ${JSON.stringify(obj)}\n\n`;
    this.controller.enqueue(this.encoder.encode(line));
  }

  private assertStreaming(callSite: string): void {
    if (this.state === "INIT") {
      throw new Error(`SSEEmitter: ${callSite} called before meta()`);
    }
    if (this.state === "TERMINAL") {
      throw new Error(`SSEEmitter: ${callSite} called after terminal event`);
    }
  }

  meta(
    requestId: string,
    manualProviders: {
      fcm: { provider_id: string; model_id: string } | null;
      ptm: { provider_id: string; model_id: string };
      vcm: { provider_id: string; model_id: string };
    },
  ): void {
    if (this.state !== "INIT") {
      throw new Error("SSEEmitter: meta() called more than once");
    }
    this.state = "STREAMING";
    this.write({
      type: "meta",
      timestamp: Date.now(),
      request_id: requestId,
      manual_providers: manualProviders,
    });
  }

  phase(phase: PhaseName, source?: ChunkSource): void {
    this.assertStreaming("phase()");
    this.phasesSeen.add(phase);
    this.write({ type: "phase", timestamp: Date.now(), phase, source });
  }

  chunk(source: ChunkSource, delta: string): void {
    this.assertStreaming("chunk()");
    const requiredPhase: PhaseName = source === "fcm" ? "fast_draft" : "primary_answer";
    if (!this.phasesSeen.has(requiredPhase)) {
      throw new Error(`SSEEmitter: chunk(${source}) emitted before phase("${requiredPhase}")`);
    }
    const prevIndex = this.chunkIndex.get(source) ?? -1;
    const nextIndex = prevIndex + 1;
    this.chunkIndex.set(source, nextIndex);
    this.write({ type: "chunk", timestamp: Date.now(), source, index: nextIndex, delta });
  }

  verifierJson(result: VerifierResult): void {
    this.assertStreaming("verifierJson()");
    if (!this.phasesSeen.has("verification")) {
      throw new Error('SSEEmitter: verifierJson() emitted before phase("verification")');
    }
    if (this.verifierJsonEmitted) {
      throw new Error("SSEEmitter: verifierJson() emitted more than once");
    }
    this.verifierJsonEmitted = true;
    this.write({ type: "verifier_json", timestamp: Date.now(), result });
  }

  patch(payload: PatchPayload): void {
    this.assertStreaming("patch()");
    if (!this.verifierJsonEmitted) {
      throw new Error("SSEEmitter: patch() emitted before verifierJson()");
    }
    if (this.patchEmitted) {
      throw new Error("SSEEmitter: patch() emitted more than once");
    }
    this.patchEmitted = true;
    this.write({ type: "patch", timestamp: Date.now(), ...payload });
  }

  done(args: {
    final_verdict: "verified" | "unverified";
    vcm: VerifierResult | null;
    latencies: Record<string, number>;
    token_usage: Record<string, number>;
    cost_estimate: number;
  }): void {
    this.assertStreaming("done()");
    if (this.terminatedWithNonRecoverableError) {
      throw new Error("SSEEmitter: done() called after a non-recoverable error");
    }
    this.state = "TERMINAL";
    this.write({
      type: "done",
      timestamp: Date.now(),
      final_verdict: args.final_verdict,
      vcm: args.vcm,
      latencies: args.latencies,
      token_usage: args.token_usage,
      cost_estimate: args.cost_estimate,
      cost_disclaimer: COST_DISCLAIMER,
    });
  }

  error(args: {
    error_code: ErrorCode;
    message: string;
    recoverable: boolean;
    phase: ErrorPhase | null;
    provider_id: string | null;
  }): void {
    assertKnownErrorCode(args.error_code);
    this.assertStreaming("error()");
    if (!args.recoverable) {
      this.state = "TERMINAL";
      this.terminatedWithNonRecoverableError = true;
    }
    this.write({
      type: "error",
      timestamp: Date.now(),
      error_code: args.error_code,
      message: args.message,
      recoverable: args.recoverable,
      phase: args.phase,
      provider_id: args.provider_id,
    });
  }

  close(): void {
    try {
      this.controller.close();
    } catch {
      // already closed — ignore
    }
  }
}
