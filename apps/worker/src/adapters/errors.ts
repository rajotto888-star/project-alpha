import { ERROR_CODES, type ErrorCode } from "@project-alpha/shared";
import { UpstreamHTTPError } from "./openaiCompat";

export type Role = "fcm" | "ptm" | "vcm";

export function statusFromError(err: unknown): number | null {
  if (err instanceof UpstreamHTTPError) return err.status;
  return null;
}

// LOCKED: FCM_DEADLINE_MISSED is emitted EXCLUSIVELY from raceWithDeadline()'s
// "deadline" branch. This function never returns it for FCM under any
// circumstance — real FCM failures classify as FCM_PROVIDER_ERROR.
export function normalizeProviderError(
  role: Role,
  status: number | null,
  isAbort: boolean,
  isTimeout: boolean,
): ErrorCode {
  if (role === "fcm") {
    return ERROR_CODES.FCM_PROVIDER_ERROR;
  }

  if (status === 401 || status === 403) {
    return role === "ptm" ? ERROR_CODES.PTM_AUTH_INVALID : ERROR_CODES.VCM_PROVIDER_ERROR;
  }
  if (status === 429) {
    return role === "ptm" ? ERROR_CODES.PTM_RATE_LIMITED : ERROR_CODES.VCM_PROVIDER_ERROR;
  }
  if (isAbort || isTimeout) {
    return role === "ptm" ? ERROR_CODES.PTM_TIMEOUT : ERROR_CODES.VCM_TIMEOUT;
  }
  return role === "ptm" ? ERROR_CODES.PTM_PROVIDER_ERROR : ERROR_CODES.VCM_PROVIDER_ERROR;
}

export async function raceWithDeadline<T>(
  promise: Promise<T>,
  deadlineMs: number,
  controller: AbortController,
): Promise<{ outcome: "ok"; value: T } | { outcome: "deadline" }> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<{ outcome: "deadline" }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ outcome: "deadline" });
    }, deadlineMs);
  });
  try {
    return await Promise.race([
      promise.then((value) => ({ outcome: "ok" as const, value })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
