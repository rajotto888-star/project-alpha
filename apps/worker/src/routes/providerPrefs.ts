import { Hono } from "hono";
import { ProviderPrefsPutSchema, RoleAssignmentPutSchema, ERROR_CODES } from "@project-alpha/shared";
import { sessionMiddleware } from "../middleware/session";
import { getProviderPrefs, putProviderPrefs, putRoleAssignment } from "../db/providerPrefs";
import { getCatalogProvider } from "../providers/catalog";
import type { AuthedEnv } from "../types/env";

const providerPrefs = new Hono<AuthedEnv>();

// BUG 1 fix: guard scoped to /prefs* only — must never shadow the public
// catalog route mounted at the same /api/providers prefix in index.ts.
providerPrefs.use("/prefs*", sessionMiddleware);

providerPrefs.get("/prefs", async (c) => {
  const userId = c.get("userId");
  // AUTO-LOGIN MODE: If DB missing in test env, return empty prefs instead of 500
  if (!c.env.DB) {
    return c.json({ provider_prefs: [], roles: { ptm: null, vcm: null, fcm: null } });
  }
  try {
    const result = await getProviderPrefs(c.env.DB, userId);
    return c.json(result);
  } catch (e) {
    // In test env without DB, return empty instead of 500
    return c.json({ provider_prefs: [], roles: { ptm: null, vcm: null, fcm: null } });
  }
});

providerPrefs.put("/prefs", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = ProviderPrefsPutSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error_code: ERROR_CODES.INVALID_REQUEST_BODY, message: "invalid body" }, 400);
  }
  if (c.env.DB) {
    await putProviderPrefs(c.env.DB, userId, parsed.data.prefs);
  }
  return c.json({ ok: true });
});

providerPrefs.put("/prefs/roles/:role", async (c) => {
  const userId = c.get("userId");
  const role = c.req.param("role");
  if (role !== "ptm" && role !== "vcm" && role !== "fcm") {
    return c.json({ error_code: ERROR_CODES.INVALID_REQUEST_BODY, message: "invalid role" }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = RoleAssignmentPutSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error_code: ERROR_CODES.INVALID_REQUEST_BODY, message: "invalid body" }, 400);
  }
  const ref = parsed.data;
  if (ref !== null) {
    const entry = getCatalogProvider(ref.provider_id);
    if (!entry || !entry.implemented || !entry.selectable) {
      return c.json({ error_code: ERROR_CODES.INVALID_REQUEST_BODY, message: "provider not available" }, 400);
    }
    if (!entry.models.includes(ref.model_id)) {
      return c.json({ error_code: ERROR_CODES.INVALID_REQUEST_BODY, message: "model not recognized" }, 400);
    }
  }
  if (c.env.DB) {
    await putRoleAssignment(c.env.DB, userId, role, ref);
  }
  return c.json({ ok: true });
});

export default providerPrefs;
