import { createParser, type EventSourceMessage } from "eventsource-parser";
import { AsyncQueue } from "./asyncQueue";
import { PROVIDER_CATALOG, getCatalogProvider } from "../providers/catalog";
import { assertSafeUrl, SsrfGuardError } from "../lib/ssrfGuard";

export class UpstreamConfigError extends Error {}
export class UpstreamHTTPError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface ResolvedProviderConfig {
  providerId: string;
  baseUrl: string;
  apiKey: string;
}

// LOCKED (B3): baseUrl is resolved exclusively from PROVIDER_CATALOG — never
// duplicated as a scattered constant elsewhere.
// SECURITY: ephemeral header-first, SSRF guard for custom baseUrl (hf-space/colab/kaggle/private-*).
export function resolveProviderConfig(
  providerId: string,
  ephemeralKeys: Record<string, string>,
): ResolvedProviderConfig {
  const catalogEntry = getCatalogProvider(providerId);
  if (!catalogEntry || !catalogEntry.implemented || !catalogEntry.selectable) {
    throw new UpstreamConfigError(`provider not available: ${providerId}`);
  }
  const apiKey = ephemeralKeys[providerId];
  if (!apiKey) {
    throw new UpstreamConfigError(`missing ephemeral key for provider: ${providerId}`);
  }
  // SSRF guard: all baseUrls must be https and non-private, especially for custom free-compute gateway
  // This ensures vault ephemeral keys are only sent to safe public endpoints.
  try {
    assertSafeUrl(catalogEntry.baseUrl);
  } catch (e) {
    if (e instanceof SsrfGuardError) {
      throw new UpstreamConfigError(`SSRF guard blocked baseUrl for ${providerId}: ${e.message}`);
    }
    throw e;
  }
  return { providerId, baseUrl: catalogEntry.baseUrl, apiKey };
}

export interface StreamChunk {
  delta: string;
}

/** Populated only when the caller opts in via StreamOpts.includeUsage. */
export interface StreamUsage {
  total_tokens: number;
}

export interface StreamOpts {
  /**
   * Sends `stream_options.include_usage` upstream AND gates `onUsage`. Both
   * halves are controlled by this one flag on purpose: usage is reported if and
   * only if it was requested, so a caller that did not opt in never sees
   * telemetry a provider volunteered. Deliberately OPT-IN — the FCM fast-draft
   * path leaves it off, so its upstream request body stays byte-identical to the
   * canonical contract.
   */
  includeUsage?: boolean;
  onUsage?: (usage: StreamUsage) => void;
}

// BUG 6 fix: adapter targets eventsource-parser@^3 API — createParser({ onEvent }).
export async function* streamOpenAICompat(
  config: ResolvedProviderConfig,
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal,
  opts: StreamOpts = {},
): AsyncGenerator<StreamChunk> {
  const queue = new AsyncQueue<StreamChunk>();

  const parser = createParser({
    onEvent: (event: EventSourceMessage) => {
      if (event.data === "[DONE]") {
        queue.close();
        return;
      }
      try {
        const json = JSON.parse(event.data);
        const totalTokens: unknown = json?.usage?.total_tokens;
        if (opts.includeUsage && opts.onUsage && typeof totalTokens === "number" && Number.isFinite(totalTokens)) {
          try {
            opts.onUsage({ total_tokens: totalTokens });
          } catch {
            // usage is telemetry only — swallow
          }
        }
        const delta: string | undefined = json?.choices?.[0]?.delta?.content;
        const role: string | undefined = json?.choices?.[0]?.delta?.role;
        if (typeof delta === "string" && delta.length > 0) {
          queue.push({ delta });
        } else if (role && !delta) {
          // role-only / empty delta — ignore (F2 lock)
        }
      } catch {
        // malformed data line — ignore
      }
    },
  });

  // BUG 3 fix: every failure path funnels into queue.fail()
  (async () => {
    try {
      // COLON-FREE MAPPING: catalog stores "-free" (colon-free) but upstream needs ":free"
      // e.g. "deepseek/deepseek-r1-free" -> "deepseek/deepseek-r1:free"
      const upstreamModel = (config.providerId === "openrouter" && modelId.endsWith("-free"))
        ? modelId.slice(0, -5) + ":free"
        : modelId;

      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: upstreamModel,
          messages,
          stream: true,
          ...(opts.includeUsage ? { stream_options: { include_usage: true } } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        throw new UpstreamHTTPError(res.status, `upstream returned ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
        queue.close();
      } catch (err) {
        queue.fail(err);
      }
    } catch (err) {
      queue.fail(err);
    }
  })();

  for await (const item of queue) {
    yield item;
  }
}

export { PROVIDER_CATALOG };
