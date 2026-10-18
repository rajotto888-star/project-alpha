import type { ErrorCode } from "./error-codes";

export type CorrectionSeverity = "minor" | "major" | "critical";
export type Severity = "none" | CorrectionSeverity;

export interface Correction {
  location?: string;
  issue: string;
  explanation?: string;
  severity: CorrectionSeverity;
}

export interface VerifierResult {
  verdict: string;
  needs_correction: boolean;
  confidence: number;
  severity: Severity;
  corrections: Correction[];
  notes?: string;
  /**
   * VCM token usage, attached SERVER-SIDE from the upstream completion response.
   * Never model-supplied. Optional so that a degraded VCM (vcm:null) stays valid.
   * Plumbed into DoneEvent.token_usage.vcm as a number.
   */
  usage_tokens?: number;
}

export type PhaseName = "fast_draft" | "primary_answer" | "verification";
export type ChunkSource = "fcm" | "ptm";
export type ErrorPhase = PhaseName | "policy";

export interface MetaEvent {
  type: "meta";
  timestamp: number;
  request_id: string;
  manual_providers: {
    fcm: { provider_id: string; model_id: string } | null;
    ptm: { provider_id: string; model_id: string };
    vcm: { provider_id: string; model_id: string };
  };
}

export interface PhaseEvent {
  type: "phase";
  timestamp: number;
  phase: PhaseName;
  source?: ChunkSource;
}

export interface ChunkEvent {
  type: "chunk";
  timestamp: number;
  source: ChunkSource;
  index: number;
  delta: string;
}

export interface VerifierJsonEvent {
  type: "verifier_json";
  timestamp: number;
  result: VerifierResult;
}

// LOCKED: replace mode's corrected_answer must be null at the TYPE level —
// no string|null escape hatch.
export type PatchPayload =
  | { mode: "patch"; corrected_answer: string; corrections: Correction[] }
  | { mode: "replace"; corrected_answer: null; corrections: Correction[] };

export type PatchEvent = { type: "patch"; timestamp: number } & PatchPayload;

export interface DoneEvent {
  type: "done";
  timestamp: number;
  final_verdict: "verified" | "unverified";
  vcm: VerifierResult | null;
  latencies: Record<string, number>;
  token_usage: Record<string, number>;
  cost_estimate: number;
  cost_disclaimer: string;
}

export interface ErrorEvent {
  type: "error";
  timestamp: number;
  error_code: ErrorCode;
  message: string;
  recoverable: boolean;
  phase: ErrorPhase | null;
  provider_id: string | null;
}

export type SSEEvent =
  | MetaEvent
  | PhaseEvent
  | ChunkEvent
  | VerifierJsonEvent
  | PatchEvent
  | DoneEvent
  | ErrorEvent;
