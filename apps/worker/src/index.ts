import { Hono } from "hono";
import { ERROR_CODES } from "@project-alpha/shared";
import { corsMiddleware } from "./middleware/cors";
import authRoute from "./routes/auth";
import providerPrefsRoute from "./routes/providerPrefs";
import catalogRoute from "./routes/catalog";
import chatRoute from "./routes/chat";
import { brokerRoute } from "./routes/broker";
import type { PublicEnv } from "./types/env";

const app = new Hono<PublicEnv>();

app.use("*", corsMiddleware());

// Health probe: public, metadata-only, touches no binding. Lets uptime checks
// distinguish "worker up" from "route not found".
app.get("/", (c) => c.json({ ok: true, service: "project-alpha-worker", version: "8.08.0" }));

app.route("/api/auth", authRoute);
// BUG 1 fix: catalog (public) mounted BEFORE providerPrefs (authed) at the
// same "/api/providers" prefix so the auth guard never shadows /catalog.
app.route("/api/providers", catalogRoute);
app.route("/api/providers", providerPrefsRoute);
app.route("/api/chat", chatRoute);
app.route("/api/broker", brokerRoute);

app.notFound((c) => {
  return c.json({ error_code: ERROR_CODES.NOT_FOUND, message: "not found" }, 404);
});

app.onError((err, c) => {
  console.error("unhandled error:", err.name);
  return c.json({ error_code: ERROR_CODES.INTERNAL_ERROR, message: "internal error" }, 500);
});

export default app;
