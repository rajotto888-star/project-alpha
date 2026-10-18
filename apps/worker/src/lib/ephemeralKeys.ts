import { ProviderIdSchema } from "@project-alpha/shared";

export class MissingCredentialsError extends Error {}
export class InvalidEphemeralHeaderError extends Error {}

export function atobUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function validateKeysShape(obj: unknown): Record<string, string> {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new InvalidEphemeralHeaderError("ephemeral keys must be a JSON object");
  }
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) {
    throw new InvalidEphemeralHeaderError("ephemeral keys object must not be empty");
  }
  const result: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!ProviderIdSchema.safeParse(k).success) {
      throw new InvalidEphemeralHeaderError(`invalid provider id: ${k}`);
    }
    if (typeof v !== "string" || v.length === 0) {
      throw new InvalidEphemeralHeaderError(`invalid key value for provider: ${k}`);
    }
    result[k] = v;
  }
  return result;
}

// LOCKED precedence: header valid => use; header invalid => reject (never
// fall back to body); header absent + body valid => use body; both
// absent/invalid => MISSING_CREDENTIALS.
export function extractEphemeralKeys(
  headerValue: string | undefined | null,
  bodyKeys: Record<string, string> | undefined,
): Record<string, string> {
  if (headerValue) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(atobUtf8(headerValue));
    } catch {
      throw new InvalidEphemeralHeaderError("X-EPHEMERAL-KEYS header is not valid base64 JSON");
    }
    return validateKeysShape(decoded);
  }
  if (bodyKeys && Object.keys(bodyKeys).length > 0) {
    return validateKeysShape(bodyKeys);
  }
  throw new MissingCredentialsError("no ephemeral keys provided in header or body");
}
