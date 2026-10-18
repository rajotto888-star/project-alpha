export interface GoogleEnv {
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  APP_URL: string;
}

/**
 * Thrown when a required Google/OAuth binding is absent or blank.
 *
 * Why this guard exists: without it, a missing `GOOGLE_OAUTH_CLIENT_ID` produced a perfectly
 * valid-looking HTTP 200 whose authorization URL contained `client_id=undefined`. The user was
 * sent to Google, which answered "Access blocked: Missing required parameter: client_id" — a
 * confusing failure that points at the wrong place. Measured on a live `wrangler dev` with a
 * `.dev.vars` that had SESSION_SECRET only:
 *
 *   POST /api/auth/google/start -> 200 {"url":"https://accounts.google.com/...&client_id=undefined&..."}
 *
 * Now it fails loudly and locally, naming the binding, before the browser ever leaves the origin.
 */
export class GoogleOAuthConfigError extends Error {}

/** Values that are technically present but mean "not configured". */
const NOT_CONFIGURED = new Set(["", "undefined", "null", "none", "todo", "changeme", "your-client-id"]);

/**
 * True when the value is an unfilled placeholder rather than a real credential.
 *
 * `GOOGLE_OAUTH_CLIENT_ID=<REDACTED>` is what a handoff template literally says, and copying it
 * verbatim is an easy mistake — it produces the same browser-side Google error as a missing value
 * ("Access blocked: Missing required parameter: client_id"), because `<REDACTED>` is not a valid
 * client id. Angle-bracket placeholders are therefore treated as not-configured.
 */
function isPlaceholder(value: string): boolean {
  const v = value.trim();
  return /^<.*>$/.test(v) || v.startsWith("YOUR_") || v.startsWith("PASTE_");
}

function isConfigured(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return !NOT_CONFIGURED.has(v.toLowerCase()) && !isPlaceholder(v);
}

export function assertGoogleOAuthConfigured(
  env: GoogleEnv,
  required: Array<"GOOGLE_OAUTH_CLIENT_ID" | "GOOGLE_OAUTH_CLIENT_SECRET" | "APP_URL">,
): void {
  const missing = required.filter((key) => !isConfigured(env[key]));
  if (missing.length > 0) {
    throw new GoogleOAuthConfigError(
      `Google OAuth is not configured: ${missing.join(", ")} missing or blank`,
    );
  }
}

export function googleRedirectUri(env: GoogleEnv): string {
  return `${env.APP_URL}/api/auth/google/callback`;
}

export function buildGoogleAuthUrl(env: GoogleEnv, state: string, codeChallenge: string): string {
  assertGoogleOAuthConfigured(env, ["GOOGLE_OAUTH_CLIENT_ID", "APP_URL"]);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: googleRedirectUri(env),
    response_type: "code",
    scope: "openid email",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "online",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
}

export async function exchangeGoogleCode(
  env: GoogleEnv,
  code: string,
  codeVerifier: string,
): Promise<GoogleTokenResponse> {
  assertGoogleOAuthConfigured(env, [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "APP_URL",
  ]);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: googleRedirectUri(env),
    }),
  });
  if (!res.ok) {
    throw new Error(`google token exchange failed: ${res.status}`);
  }
  return res.json();
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`google userinfo failed: ${res.status}`);
  }
  const json = await res.json<{ sub: string; email: string }>();
  return { sub: json.sub, email: json.email };
}
