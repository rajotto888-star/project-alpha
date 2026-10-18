import type { Correction, MergeStyle, PatchPayload, VerifierResult } from "@project-alpha/shared";

const SEVERITY_RANK: Record<string, number> = { none: 0, minor: 1, major: 2, critical: 3 };

export function decideMerge(mergeStyle: MergeStyle, vcm: VerifierResult): "none" | "patch" | "replace" {
  if (!vcm.needs_correction || vcm.corrections.length === 0) return "none";

  if (mergeStyle === "always_patch") return "patch";
  if (mergeStyle === "always_replace") return "replace";

  const isMajorOrCritical = SEVERITY_RANK[vcm.severity] >= SEVERITY_RANK.major;
  if (vcm.confidence >= 80 && isMajorOrCritical) return "replace";
  return "patch";
}

export function buildDeterministicPatch(
  ptmAnswer: string,
  vcm: VerifierResult,
  mode: "patch" | "replace",
): PatchPayload {
  const corrections: Correction[] = vcm.corrections;
  if (mode === "replace") {
    return { mode: "replace", corrected_answer: null, corrections };
  }
  return { mode: "patch", corrected_answer: ptmAnswer, corrections };
}
