export const COST_DISCLAIMER =
  "Cost estimates are approximate, based on provider list pricing at time of request, and may not reflect your actual bill.";

export const EPHEMERAL_HEADER_SIZE_THRESHOLD_BYTES = 6 * 1024;

export const DEFAULT_COST_WEIGHT = 5;
export const DEFAULT_MERGE_STYLE = "hybrid" as const;
export const DEFAULT_PRIORITY_MODE = "balanced" as const;

export const FCM_DEADLINE_MS = 500;
export const PTM_STREAM_TIMEOUT_MS = 60_000;
export const VCM_TIMEOUT_MS = 30_000;
export const FCM_STREAM_TIMEOUT_MS = 60_000;

export const OAUTH_STATE_TTL_SECONDS = 300;
export const SESSION_COOKIE_NAME = "alpha_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

// LOCKED (session lock #7): PBKDF2-HMAC-SHA256 iterations = OWASP 2023 minimum.
// Single source of truth — vault.ts must import this, never hardcode locally.
// Raising is safe. Lowering/changing requires an explicit re-lock + migration
// path, since existing client-side vaults become undecryptable otherwise.
export const VAULT_PBKDF2_ITERATIONS = 600_000;
