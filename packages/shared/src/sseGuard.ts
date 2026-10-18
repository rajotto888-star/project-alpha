import { ERROR_CODES } from "./error-codes";
import type { SSEEvent } from "./sse-events";

const VALID_TYPES = new Set([
  "meta",
  "phase",
  "chunk",
  "verifier_json",
  "patch",
  "done",
  "error",
]);

const KNOWN_ERROR_CODES = new Set(Object.values(ERROR_CODES) as string[]);

export function isSSEEvent(x: unknown): x is SSEEvent {
  if (typeof x !== "object" || x === null) return false;
  const obj = x as Record<string, unknown>;
  if (typeof obj.type !== "string" || !VALID_TYPES.has(obj.type)) return false;
  if (typeof obj.timestamp !== "number") return false;
  if (obj.type === "error") {
    if (typeof obj.error_code !== "string" || !KNOWN_ERROR_CODES.has(obj.error_code)) {
      return false;
    }
  }
  return true;
}
