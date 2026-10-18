import type { ChatStreamRequest } from "@project-alpha/shared";
import { ERROR_CODES, FCM_DEADLINE_MS } from "@project-alpha/shared";
import type { SSEEmitterLike } from "./emitter";
import { isPolicyBlocked } from "../policy/baseline";
import { runPtmWithFailover, type PtmTaggedError } from "../adapters/ptmFailover";
import { runVcmWithRetries } from "../adapters/vcm";
import { streamOpenAICompat, resolveProviderConfig } from "../adapters/openaiCompat";
import { normalizeProviderError, statusFromError, raceWithDeadline } from "../adapters/errors";
import { decideMerge, buildDeterministicPatch } from "./merge";
import { insertAuditEvent } from "../db/audit";

export interface RunCommanderArgs {
  emitter: SSEEmitterLike;
  payload: ChatStreamRequest;
  ephemeralKeys: Record<string, string>;
  userId: string;
  db: D1Database;
  signal: AbortSignal;
}

export async function runCommander(args: RunCommanderArgs): Promise<void> {
  const { emitter, payload, ephemeralKeys, userId, db, signal } = args;
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const latencies: Record<string, number> = {};
  const tokenUsage: Record<string, number> = {};

  emitter.meta(requestId, payload.manual_providers);

  // LOCKED policy gate: always SSE 200; blocked flow = meta -> error(policy) -> close.
  if (isPolicyBlocked(payload.messages)) {
    emitter.error({
      error_code: ERROR_CODES.POLICY_BLOCKED,
      message: "This request cannot be processed.",
      recoverable: false,
      phase: "policy",
      provider_id: null,
    });
    await insertAuditEvent(db, {
      id: crypto.randomUUID(),
      user_id: userId,
      request_id: requestId,
      provider_id: null,
      model_id: null,
      status: "blocked",
      latency_ms: Date.now() - startedAt,
      token_estimate: null,
      cost_estimate: null,
      phase: "policy",
      error_code: ERROR_CODES.POLICY_BLOCKED,
    });
    return;
  }

  const messages = payload.messages;

  // ---- Optional FCM (fast draft, 500ms deadline, non-fatal) ----
  if (payload.enable_fast_draft && payload.manual_providers.fcm) {
    const fcmRef = payload.manual_providers.fcm;
    emitter.phase("fast_draft", "fcm");
    const fcmController = new AbortController();
    const onParentAbort = () => fcmController.abort();
    signal.addEventListener("abort", onParentAbort);
    const fcmStart = Date.now();
    try {
      const runFcm = (async () => {
        const config = resolveProviderConfig(fcmRef.provider_id, ephemeralKeys);
        for await (const chunk of streamOpenAICompat(config, fcmRef.model_id, messages, fcmController.signal)) {
          emitter.chunk("fcm", chunk.delta);
        }
      })();
      const result = await raceWithDeadline(runFcm, FCM_DEADLINE_MS, fcmController);
      if (result.outcome === "deadline" && !signal.aborted) {
        emitter.error({
          error_code: ERROR_CODES.FCM_DEADLINE_MISSED,
          message: "fast draft did not complete within the deadline",
          recoverable: true,
          phase: "fast_draft",
          provider_id: fcmRef.provider_id,
        });
      }
    } catch (err) {
      if (signal.aborted) {
        signal.removeEventListener("abort", onParentAbort);
        return;
      }
      const status = statusFromError(err);
      const code = normalizeProviderError("fcm", status, false, false);
      emitter.error({
        error_code: code,
        message: "fast draft failed",
        recoverable: true,
        phase: "fast_draft",
        provider_id: fcmRef.provider_id,
      });
    } finally {
      signal.removeEventListener("abort", onParentAbort);
      latencies.fcm = Date.now() - fcmStart;
    }
  }

  if (signal.aborted) return;

  // ---- PTM (always runs) ----
  const ptmRef = payload.manual_providers.ptm;
  emitter.phase("primary_answer", "ptm");
  const ptmStart = Date.now();
  let ptmAnswer = "";

  try {
    await runPtmWithFailover({
      providerId: ptmRef.provider_id,
      modelId: ptmRef.model_id,
      messages,
      ephemeralKeys,
      parentSignal: signal,
      // PTM streams, so usage only exists if we ask for it. Opted in here and
      // nowhere else — FCM keeps the canonical request body.
      includeUsage: true,
      onUsage: (usage) => {
        tokenUsage.ptm = usage.total_tokens;
      },
      onChunk: async (delta) => {
        emitter.chunk("ptm", delta);
        ptmAnswer += delta;
      },
    });
  } catch (err) {
    if (signal.aborted) return; // A4: client disconnect — stop quietly
    const tagged = err as PtmTaggedError;
    latencies.ptm = Date.now() - ptmStart;
    const errorCode = tagged.isPtmMidstream
      ? ERROR_CODES.PTM_TERMINAL_MIDSTREAM
      : normalizeProviderError("ptm", statusFromError(err), false, Boolean(tagged.isPtmTimeout));
    emitter.error({
      error_code: errorCode,
      message: tagged.isPtmMidstream ? "primary model failed mid-stream" : "primary model failed",
      recoverable: false,
      phase: "primary_answer",
      provider_id: ptmRef.provider_id,
    });
    await insertAuditEvent(db, {
      id: crypto.randomUUID(),
      user_id: userId,
      request_id: requestId,
      provider_id: ptmRef.provider_id,
      model_id: ptmRef.model_id,
      status: "error",
      latency_ms: latencies.ptm,
      token_estimate: null,
      cost_estimate: null,
      phase: "primary_answer",
      error_code: errorCode,
    });
    return;
  }

  latencies.ptm = Date.now() - ptmStart;
  if (signal.aborted) return;

  // ---- VCM (always runs after PTM success) ----
  const vcmRef = payload.manual_providers.vcm;
  emitter.phase("verification");
  const vcmStart = Date.now();
  let vcmResult;
  try {
    vcmResult = await runVcmWithRetries({
      providerId: vcmRef.provider_id,
      modelId: vcmRef.model_id,
      originalMessages: messages,
      ptmAnswer,
      ephemeralKeys,
      parentSignal: signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    latencies.vcm = Date.now() - vcmStart;
    emitter.error({
      error_code: ERROR_CODES.VCM_ALL_ATTEMPTS_FAILED,
      message: "verification failed after retries",
      recoverable: true,
      phase: "verification",
      provider_id: vcmRef.provider_id,
    });
    emitter.done({
      final_verdict: "unverified",
      vcm: null,
      latencies,
      token_usage: tokenUsage,
      cost_estimate: 0,
    });
    await insertAuditEvent(db, {
      id: crypto.randomUUID(),
      user_id: userId,
      request_id: requestId,
      provider_id: vcmRef.provider_id,
      model_id: vcmRef.model_id,
      status: "error",
      latency_ms: latencies.vcm,
      token_estimate: null,
      cost_estimate: null,
      phase: "verification",
      error_code: ERROR_CODES.VCM_ALL_ATTEMPTS_FAILED,
    });
    return;
  }

  latencies.vcm = Date.now() - vcmStart;
  if (signal.aborted) return;

  // token_usage.vcm is a NUMBER (or absent) — never null, never a string.
  if (typeof vcmResult.usage_tokens === "number") {
    tokenUsage.vcm = vcmResult.usage_tokens;
  }

  emitter.verifierJson(vcmResult);

  const mergeMode = decideMerge(payload.merge_style, vcmResult);
  if (mergeMode !== "none") {
    emitter.patch(buildDeterministicPatch(ptmAnswer, vcmResult, mergeMode));
  }

  emitter.done({
    final_verdict: "verified",
    vcm: vcmResult,
    latencies,
    token_usage: tokenUsage,
    cost_estimate: 0,
  });

  await insertAuditEvent(db, {
    id: crypto.randomUUID(),
    user_id: userId,
    request_id: requestId,
    provider_id: ptmRef.provider_id,
    model_id: ptmRef.model_id,
    status: "ok",
    latency_ms: Date.now() - startedAt,
    token_estimate: null,
    cost_estimate: null,
    phase: "done",
    error_code: null,
  });
}
