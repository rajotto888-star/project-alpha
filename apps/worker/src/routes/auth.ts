import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import {
  ERROR_CODES,
  OAUTH_STATE_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "@project-alpha/shared";
import { pkceChallenge, signSession } from "../lib/crypto";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  GoogleOAuthConfigError,
} from "../lib/googleOAuth";
import { upsertUser } from "../db/users";
import type { PublicEnv } from "../types/env";

export function cookieSecureFlag(env: PublicEnv["Bindings"]): boolean {
  return env.COOKIE_SECURE === "true" || env.APP_URL.startsWith("https://");
}

const auth = new Hono<PublicEnv>();

// AUTO-LOGIN with pass 123456 - no Google needed
auth.post("/auto-login", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const pass = String(body.pass || body.password || "").trim();
  // Accept 123456 or empty for auto-login mode
  if (pass !== "123456" && pass !== "" && pass !== "auto") {
    return c.json({ error_code: "INVALID_PASSWORD", message: "invalid pass" }, 401);
  }

  // Ensure default-user exists
  if (c.env.DB) {
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, oauth_provider, oauth_sub, email, created_at) VALUES ('default-user', 'auto', 'default-user', 'user@project-alpha.local', ?)"
    ).bind(Date.now()).run().catch(() => {});
  }

  const secret = c.env.SESSION_SECRET || "alpha-session-secret-production-2026";
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await signSession({ uid: "default-user", exp }, secret);

  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: cookieSecureFlag(c.env),
    sameSite: "Lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });

  return c.json({ ok: true, user_id: "default-user", message: "auto-login success" });
});

auth.post("/google/start", async (c) => {
  const state = crypto.randomUUID();
  const { verifier, challenge } = await pkceChallenge();
  await c.env.OAUTH_KV.put(`oauth:${state}`, JSON.stringify({ verifier }), {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  });
  try {
    const url = buildGoogleAuthUrl(c.env, state, challenge);
    return c.json({ url });
  } catch (err) {
    if (err instanceof GoogleOAuthConfigError) {
      return c.json({ error_code: ERROR_CODES.INTERNAL_ERROR, message: err.message }, 500);
    }
    throw err;
  }
});

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return c.json({ error_code: "INVALID_REQUEST_BODY", message: "missing code or state" }, 400);
  }
  const stored = await c.env.OAUTH_KV.get(`oauth:${state}`);
  await c.env.OAUTH_KV.delete(`oauth:${state}`);
  if (!stored) {
    return c.json({ error_code: "INVALID_REQUEST_BODY", message: "invalid or expired state" }, 400);
  }
  const { verifier } = JSON.parse(stored) as { verifier: string };

  const tokenRes = await exchangeGoogleCode(c.env, code, verifier);
  const userInfo = await fetchGoogleUserInfo(tokenRes.access_token);
  const user = await upsertUser(c.env.DB, "google", userInfo.sub, userInfo.email);

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await signSession({ uid: user.id, exp }, c.env.SESSION_SECRET);

  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: cookieSecureFlag(c.env),
    sameSite: "Lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });

  return c.redirect(c.env.APP_ORIGIN);
});

auth.post("/logout", async (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

export default auth;
