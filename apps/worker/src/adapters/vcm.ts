import type { Correction, CorrectionSeverity, Severity, VerifierResult } from "@project-alpha/shared";
import { VCM_TIMEOUT_MS } from "@project-alpha/shared";
import { resolveProviderConfig, UpstreamHTTPError } from "./openaiCompat";

const SEVERITY_RANK: Record<Severity, number> = { none: 0, minor: 1, major: 2, critical: 3 };
const VALID_CORRECTION_SEVERITIES: CorrectionSeverity[] = ["minor", "major", "critical"];

function normalizeCorrectionSeverity(raw: unknown): CorrectionSeverity {
  if (typeof raw === "string" && (VALID_CORRECTION_SEVERITIES as string[]).includes(raw)) {
    return raw as CorrectionSeverity;
  }
  // never "none" at per-correction level — default to "minor"
  return "minor";
}

export function deriveTopLevelSeverity(corrections: Correction[]): Severity {
  let top: Severity = "none";
  for (const c of corrections) {
    if (SEVERITY_RANK[c.severity] > SEVERITY_RANK[top]) top = c.severity;
  }
  return top;
}

export function extractStrictJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        // fall through
      }
    }
    const braced = raw.match(/\{[\s\S]*\}/);
    if (braced) {
      try {
        return JSON.parse(braced[0]);
      } catch {
        // fall through
      }
    }
    throw new Error("VCM_PARSE_FAILED: could not extract JSON from verifier output");
  }
}

// LOCKED: VerifierResult.severity is SERVER-COMPUTED — raw JSON severity from
// the model is ignored entirely.
export function normalizeVerifierResult(parsed: unknown): VerifierResult {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("VCM_PARSE_FAILED: verifier output must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const rawCorrections = Array.isArray(obj.corrections) ? obj.corrections : [];
  const corrections: Correction[] = rawCorrections.map((c) => {
    const co = (c ?? {}) as Record<string, unknown>;
    return {
      location: typeof co.location === "string" ? co.location : undefined,
      issue: typeof co.issue === "string" ? co.issue : "unspecified issue",
      explanation: typeof co.explanation === "string" ? co.explanation : undefined,
      severity: normalizeCorrectionSeverity(co.severity),
    };
  });
  const confidenceRaw = typeof obj.confidence === "number" ? obj.confidence : 0;
  const confidence = Math.max(0, Math.min(100, confidenceRaw));

  return {
    verdict: typeof obj.verdict === "string" ? obj.verdict : "unknown",
    needs_correction: Boolean(obj.needs_correction),
    confidence,
    severity: deriveTopLevelSeverity(corrections),
    corrections,
    notes: typeof obj.notes === "string" ? obj.notes : undefined,
  };
}

const VCM_SYSTEM_PROMPT = `You are a verification model. Review the assistant's answer for factual and logical
errors. Respond with STRICT JSON ONLY, no prose, no markdown fences, matching exactly:
{"verdict": string, "needs_correction": boolean, "confidence": number (0-100),
 "corrections": [{"location"?: string, "issue": string, "explanation"?: string,
 "severity": "minor"|"major"|"critical"}], "notes"?: string}
Do NOT include a top-level "severity" field — it is computed by the caller.`;

export interface VcmRunArgs {
  providerId: string;
  modelId: string;
  originalMessages: Array<{ role: string; content: string }>;
  ptmAnswer: string;
  ephemeralKeys: Record<string, string>;
  parentSignal: AbortSignal;
  maxAttempts?: number;
  customEndpoints?: Record<string, string>;
}

export async function runVcmWithRetries(args: VcmRunArgs): Promise<VerifierResult> {
  const maxAttempts = args.maxAttempts ?? 2;
  let lastError: unknown = null;

  const verifierMessages = [
    { role: "system", content: VCM_SYSTEM_PROMPT },
    ...args.originalMessages,
    { role: "assistant", content: args.ptmAnswer },
    { role: "user", content: "Verify the assistant answer above. Respond with strict JSON only." },
  ];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    args.parentSignal.addEventListener("abort", onParentAbort);
    const timer = setTimeout(() => controller.abort(), VCM_TIMEOUT_MS);
    try {
      const config = resolveProviderConfig(args.providerId, args.ephemeralKeys, args.customEndpoints);
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model: args.modelId, messages: verifierMessages, stream: false }),
      });
      if (!res.ok) {
        throw new UpstreamHTTPError(res.status, `VCM upstream returned ${res.status}`);
      }
      // Typed at the boundary: @cloudflare/workers-types gives res.json() the
      // type {}, so the OpenAI response shape is asserted here (behaviour unchanged).
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number };
      };
      const raw = json?.choices?.[0]?.message?.content ?? "";
      const parsed = extractStrictJson(raw);
      const result = normalizeVerifierResult(parsed);
      // Attach upstream token usage server-side (never taken from model output).
      const totalTokens = json?.usage?.total_tokens;
      if (typeof totalTokens === "number" && Number.isFinite(totalTokens)) {
        result.usage_tokens = totalTokens;
      }
      return result;
    } catch (err) {
      lastError = err;
      if (args.parentSignal.aborted) throw err;
      continue;
    } finally {
      clearTimeout(timer);
      args.parentSignal.removeEventListener("abort", onParentAbort);
    }
  }
  throw lastError ?? new Error("VCM failed with no error captured");
}
