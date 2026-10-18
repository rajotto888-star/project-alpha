import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { ERROR_CODES, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@project-alpha/shared";
import { verifySession, signSession } from "../lib/crypto";
import type { AuthedEnv } from "../types/env";

// AUTO-LOGIN MODE: Site open = logged in as default-user
// Pass 123456 is for explicit auto-login endpoint, but middleware also auto-creates session
// if no cookie exists, so no Google OAuth required.
export const sessionMiddleware: MiddlewareHandler<AuthedEnv> = async (c, next) => {
  const secret = c.env.SESSION_SECRET || "alpha-session-secret-production-2026";
  let token = getCookie(c, SESSION_COOKIE_NAME);

  // AUTO-LOGIN: No token = auto-create default-user session
  if (!token) {
    // Ensure default-user exists in D1 (best-effort)
    if (c.env.DB) {
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO users (id, oauth_provider, oauth_sub, email, created_at) VALUES ('default-user', 'auto', 'default-user', 'user@project-alpha.local', ?)"
      ).bind(Date.now()).run().catch(() => {});
    }
    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    token = await signSession({ uid: "default-user", exp }, secret);
    setCookie(c, SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: c.env.COOKIE_SECURE === "true" || Boolean(c.env.APP_URL?.startsWith("https://")),
      sameSite: "Lax",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    });
    c.set("userId", "default-user");
    await next();
    return;
  }

  const payload = await verifySession(token, secret);
  if (!payload) {
    // Invalid token -> auto-refresh as default-user instead of 401 (auto-login mode)
    if (c.env.DB) {
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO users (id, oauth_provider, oauth_sub, email, created_at) VALUES ('default-user', 'auto', 'default-user', 'user@project-alpha.local', ?)"
      ).bind(Date.now()).run().catch(() => {});
    }
    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    const newToken = await signSession({ uid: "default-user", exp }, secret);
    setCookie(c, SESSION_COOKIE_NAME, newToken, {
      httpOnly: true,
      secure: c.env.COOKIE_SECURE === "true" || Boolean(c.env.APP_URL?.startsWith("https://")),
      sameSite: "Lax",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    });
    c.set("userId", "default-user");
    await next();
    return;
  }

  c.set("userId", payload.uid);
  await next();
};
