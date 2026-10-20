import { streamOpenAICompat, resolveProviderConfig, type ResolvedProviderConfig } from "./openaiCompat";
import { statusFromError } from "./errors";
import { PTM_STREAM_TIMEOUT_MS } from "@project-alpha/shared";

export interface PtmTaggedError extends Error {
  isPtmTimeout?: boolean;
  isPtmMidstream?: boolean;
}

export interface PtmRunArgs {
  providerId: string;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  ephemeralKeys: Record<string, string>;
  parentSignal: AbortSignal;
  onChunk: (delta: string) => Promise<void>;
  maxAttempts?: number;
  /** Opt into upstream stream usage; reported only for the attempt that succeeds. */
  includeUsage?: boolean;
  onUsage?: (usage: { total_tokens: number }) => void;
  customEndpoints?: Record<string, string>;
}

// LOCKED: retry/failover allowed only before the first successfully emitted
// chunk. The flag flips only after onChunk() RESOLVES, never on provider
// receipt. isPtmMidstream always takes precedence over isPtmTimeout.
export async function runPtmWithFailover(args: PtmRunArgs): Promise<void> {
  const maxAttempts = args.maxAttempts ?? 2;
  let firstChunkEmitted = false;
  let lastError: PtmTaggedError | null = null;
  // Mutable so a provider that rejects the optional usage field can be retried
  // without it. Telemetry must never cost the user their answer.
  // Declared outside the loop so the downgrade persists across attempts.
  let includeUsage = args.includeUsage ?? false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (firstChunkEmitted) break;
    const controller = new AbortController();
    let timedOutInternally = false;
    const timer = setTimeout(() => {
      timedOutInternally = true;
      controller.abort();
    }, PTM_STREAM_TIMEOUT_MS);

    const onParentAbort = () => controller.abort();
    args.parentSignal.addEventListener("abort", onParentAbort);

    try {
      const config: ResolvedProviderConfig = resolveProviderConfig(args.providerId, args.ephemeralKeys, args.customEndpoints);
      // Per-attempt sink: a failed attempt must never leak its usage to the caller.
      const attemptUsage: { total_tokens?: number } = {};
      for await (const chunk of streamOpenAICompat(config, args.modelId, args.messages, controller.signal, {
        includeUsage,
        onUsage: (u) => {
          attemptUsage.total_tokens = u.total_tokens;
        },
      })) {
        try {
          await args.onChunk(chunk.delta);
          firstChunkEmitted = true;
        } catch (emitErr) {
          const tagged = emitErr as PtmTaggedError;
          tagged.isPtmMidstream = firstChunkEmitted;
          throw tagged;
        }
      }
      clearTimeout(timer);
      args.parentSignal.removeEventListener("abort", onParentAbort);
      // Surface usage only for the fully-consumed, successful attempt.
      if (args.onUsage && typeof attemptUsage.total_tokens === "number") {
        args.onUsage({ total_tokens: attemptUsage.total_tokens });
      }
      return;
    } catch (err) {
      clearTimeout(timer);
      args.parentSignal.removeEventListener("abort", onParentAbort);
      const tagged = err as PtmTaggedError;
      if (firstChunkEmitted) {
        tagged.isPtmMidstream = true;
        throw tagged;
      }
      tagged.isPtmTimeout = timedOutInternally && !args.parentSignal.aborted;
      // A provider that does not implement `stream_options` answers 400. Drop
      // the field and retry the same request without usage. This branch is only
      // reachable while firstChunkEmitted is false, so the midstream lock is
      // untouched and no partial answer is ever duplicated.
      if (includeUsage && statusFromError(err) === 400) {
        includeUsage = false;
      }
      lastError = tagged;
      if (args.parentSignal.aborted) {
        throw tagged;
      }
      continue;
    }
  }
  throw lastError ?? new Error("PTM failed with no error captured");
}
