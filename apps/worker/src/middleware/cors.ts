import type { MiddlewareHandler } from "hono";
import type { PublicEnv } from "../types/env";

// LOCKED (C3): strict allowlist only; no-Origin requests processed without
// CORS headers added; blocked origins never echoed.
export function corsMiddleware(): MiddlewareHandler<PublicEnv> {
  return async (c, next) => {
    const origin = c.req.header("Origin");
    const allowedOrigin = c.env.APP_ORIGIN;
    const isAllowed = Boolean(origin) && origin === allowedOrigin;

    if (c.req.method === "OPTIONS") {
      if (!isAllowed) {
        return c.body(null, 204);
      }
      return c.body(null, 204, {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,X-EPHEMERAL-KEYS",
        Vary: "Origin",
      });
    }

    await next();

    if (isAllowed) {
      c.res.headers.set("Access-Control-Allow-Origin", allowedOrigin);
      c.res.headers.set("Access-Control-Allow-Credentials", "true");
      c.res.headers.set("Vary", "Origin");
    }
  };
}
