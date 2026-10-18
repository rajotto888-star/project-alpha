import { ERROR_CODES, type ErrorCode } from "@project-alpha/shared";

const KNOWN = new Set(Object.values(ERROR_CODES) as string[]);

export function assertKnownErrorCode(code: string): asserts code is ErrorCode {
  if (!KNOWN.has(code)) {
    throw new Error(
      `assertKnownErrorCode: unknown error_code "${code}" — must be added to ERROR_CODES first`,
    );
  }
}
