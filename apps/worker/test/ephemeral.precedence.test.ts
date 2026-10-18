import { describe, it, expect } from "vitest";
import { extractEphemeralKeys, InvalidEphemeralHeaderError, MissingCredentialsError } from "../src/lib/ephemeralKeys";

function utf8Base64(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

describe("Ephemeral key precedence (LOCKED)", () => {
  it("header valid -> header wins, body ignored even if different", () => {
    const header = utf8Base64({ openai: "header-key" });
    const body = { openai: "body-key" };
    const result = extractEphemeralKeys(header, body);
    expect(result.openai).toBe("header-key");
  });

  it("header invalid -> reject, NEVER falls back to body", () => {
    const badHeader = "not-valid-base64-json!!";
    const body = { openai: "body-key" };
    expect(() => extractEphemeralKeys(badHeader, body)).toThrow(InvalidEphemeralHeaderError);
  });

  it("header absent + body valid -> accept body", () => {
    const result = extractEphemeralKeys(null, { openai: "body-key" });
    expect(result.openai).toBe("body-key");
  });

  it("both absent -> MISSING_CREDENTIALS", () => {
    expect(() => extractEphemeralKeys(null, undefined)).toThrow(MissingCredentialsError);
  });

  it("rejects a provider_id that fails ProviderIdSchema", () => {
    // canonical validateKeysShape rejects a malformed id in the body too
    expect(() => extractEphemeralKeys(null, { "Bad:Id": "key" })).toThrow(InvalidEphemeralHeaderError);
  });
});
