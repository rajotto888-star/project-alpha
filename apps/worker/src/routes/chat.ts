import { Hono } from "hono";
import { ChatStreamRequestSchema, ERROR_CODES } from "@project-alpha/shared";
import { sessionMiddleware } from "../middleware/session";
import { validateManualProviders, type PrefsLookup, ManualProviderValidationError } from "../providers/catalog";
import { extractEphemeralKeys, MissingCredentialsError, InvalidEphemeralHeaderError } from "../lib/ephemeralKeys";
import { getProviderPrefs } from "../db/providerPrefs";
import { SSEEmitter } from "../orchestrator/emitter";
import { runCommander } from "../orchestrator/runCommander";
import type { AuthedEnv } from "../types/env";

const chat = new Hono<AuthedEnv>();

chat.use("*", sessionMiddleware);

chat.post("/stream", async (c) => {
  const userId = c.get("userId");
  const rawBody = await c.req.json().catch(() => null);
  const parsed = ChatStreamRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error_code: ERROR_CODES.INVALID_REQUEST_BODY, message: "invalid request body" }, 400);
  }
  const payload = parsed.data;

  const prefsResult = await getProviderPrefs(c.env.DB, userId);
  const disabled = new Set(prefsResult.provider_prefs.filter((p) => !p.enabled).map((p) => p.provider_id));
  const prefsLookup: PrefsLookup = { isDisabled: (id) => disabled.has(id) };

  try {
    validateManualProviders(payload.manual_providers, prefsLookup);
  } catch (err) {
    if (err instanceof ManualProviderValidationError) {
      return c.json({ error_code: ERROR_CODES.INVALID_REQUEST_BODY, message: err.message }, 400);
    }
    throw err;
  }

  let ephemeralKeys: Record<string, string>;
  try {
    const headerValue = c.req.header("X-EPHEMERAL-KEYS");
    ephemeralKeys = extractEphemeralKeys(headerValue, payload.ephemeral_keys);
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      return c.json({ error_code: ERROR_CODES.MISSING_CREDENTIALS, message: "missing ephemeral keys" }, 400);
    }
    if (err instanceof InvalidEphemeralHeaderError) {
      return c.json({ error_code: ERROR_CODES.INVALID_EPHEMERAL_KEYS_HEADER, message: err.message }, 400);
    }
    throw err;
  }

  // A3 LOCKED: every selected role must have a matching ephemeral key before
  // the SSE stream opens — fail fast with HTTP 400, never mid-stream.
  const requiredRoles = [
    payload.manual_providers.ptm,
    payload.manual_providers.vcm,
    ...(payload.manual_providers.fcm ? [payload.manual_providers.fcm] : []),
  ];
  for (const ref of requiredRoles) {
    if (!ephemeralKeys[ref.provider_id]) {
      return c.json(
        { error_code: ERROR_CODES.MISSING_CREDENTIALS, message: `missing ephemeral key for ${ref.provider_id}` },
        400,
      );
    }
  }

  const abortController = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emitter = new SSEEmitter(controller);
      runCommander({
        emitter,
        payload,
        ephemeralKeys,
        userId,
        db: c.env.DB,
        signal: abortController.signal,
      })
        .catch(() => {
          // runCommander owns all emitter.error/done handling; this exists
          // only to prevent an unhandled rejection from crashing the isolate.
        })
        .finally(() => {
          emitter.close();
        });
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

export default chat;
