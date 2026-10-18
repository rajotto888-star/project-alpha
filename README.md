# Project Alpha

Cloud-native AI orchestrator. It hosts no models and pays for no compute — inference runs on
your own provider keys (BYOC). The browser is only the client interface and the encrypted key
vault: **no local compute and no local runtime dependency**.

MVP: manual router; selectable = openai, groq + owner-managed private endpoints (BYOE Lite, step 129). User-supplied endpoints remain v1.1+.

## Layout

```
packages/shared   canonical types, constants, error codes, zod schemas, SSE guard
apps/worker       Cloudflare Workers (Modules) + Hono — orchestrator, auth, SSE
apps/web          React + Vite client, IndexedDB AES-GCM vault (PBKDF2 600k)
docs              LOCKED_BEHAVIORS.md — the contract, do not rework without a re-lock
```

## Commands

```bash
pnpm install                 # workspace install (lockfile committed)
pnpm -r typecheck            # shared + worker + web
pnpm -r test                 # vitest — worker (155) + web vault/sseClient/authClient/keysPanel (39)

pnpm --filter @project-alpha/worker migrate:local   # apply D1 migration locally
pnpm --filter @project-alpha/worker dev             # wrangler dev --env dev  (port 8787)
pnpm --filter @project-alpha/web dev                # vite                    (port 5173)
```

## Local development

1. `pnpm install`
2. `pnpm --filter @project-alpha/worker migrate:local` — applies `migrations/0001_init.sql` to
   the simulated local D1 (no Cloudflare account needed).
3. Create `apps/worker/.dev.vars` with a throwaway `SESSION_SECRET=<anything>` so `wrangler dev`
   can sign sessions locally. Google sign-in additionally needs a real `GOOGLE_OAUTH_CLIENT_ID`
   and `GOOGLE_OAUTH_CLIENT_SECRET`; without them `POST /api/auth/google/start` returns
   `500 INTERNAL_ERROR` naming the missing binding (by design — it never emits a URL with
   `client_id=undefined`). The file is gitignored — **never put a real value in it**.
4. `pnpm --filter @project-alpha/worker dev` — worker on `http://127.0.0.1:8787`.
5. `pnpm --filter @project-alpha/web dev` — web on `http://127.0.0.1:5173`; Vite proxies
   relative `/api` calls to the worker, so the browser never calls localhost directly.

Google OAuth callback to register for local dev:
`http://127.0.0.1:8787/api/auth/google/callback`

## Secrets (names only — never commit values)

```bash
pnpm --filter @project-alpha/worker exec wrangler secret put SESSION_SECRET --env dev
pnpm --filter @project-alpha/worker exec wrangler secret put GOOGLE_OAUTH_CLIENT_ID --env dev
pnpm --filter @project-alpha/worker exec wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --env dev
```

Provider API keys are **never** secrets on the server. They travel per request in
`X-EPHEMERAL-KEYS` (or the request body as a fallback) and live only in memory for the duration
of that request.

## Locked behaviours

See [`docs/LOCKED_BEHAVIORS.md`](docs/LOCKED_BEHAVIORS.md). The short version:

- Policy block: `meta -> error(phase="policy", recoverable=false, provider_id=null) -> close`,
  no `done`.
- VCM total failure: recoverable `error(phase="verification")` then
  `done(final_verdict="unverified", vcm=null)`, no `verifier_json`/`patch`.
- PTM retry is allowed only **before** the first successfully emitted chunk; afterwards any
  failure is terminal (`PTM_TERMINAL_MIDSTREAM`), with no retry and no `done`.
- `replace` mode never carries a server-written answer — `corrected_answer` is `null` and the
  client drives a stateless rerun.
- Session auth is cookie-only; `Authorization` is never read for session.
- No server-side persistence of keys, prompts or outputs — guarded by
  `apps/worker/test/secretPersistence.canary.test.ts` and a CI grep guard.

## Runbook notes (folded here on purpose — no extra files to drift)

- **Health probe:** `GET /` returns `{ok, service, version}` — public, touches no binding. Unknown
  routes still answer `404` with `error_code: "NOT_FOUND"`.
- **Audit index:** `migrations/0002_audit_index.sql` adds `idx_audit_events_created`. Verify after
  applying:
  `wrangler d1 execute DB --local --env dev --command "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_events'"`
- **Where provider keys are entered:** the **Keys** tab (`KeysPanel`). Keys are AES-GCM encrypted
  in the browser; Save/Remove re-encrypt the blob only while the vault passphrase is still in
  memory (a status line says so when it is not). Until a key is saved for a referenced provider,
  `POST /api/chat/stream` answers `400 MISSING_CREDENTIALS` — that is the expected empty-vault
  behaviour, not a bug.
- **Create vs Unlock:** `Create new vault` warns first when a blob already exists (a new vault
  starts empty and replaces the saved keys). `Unlock` is the normal path.
- **Orphan session → 500:** a valid HMAC cookie whose `users` row no longer exists fails the first
  write with a FK error → `500 INTERNAL_ERROR`. Documented behaviour, kept deliberately.
- **Token usage is optional:** `token_usage.ptm` is a number only when upstream reported it; the
  client must treat it as absent-safe.
- **`cost_estimate` is a placeholder** (`0`/`null`) until provider pricing lands; the
  `COST_DISCLAIMER` attached to `done()` is the user-facing truth.
- **Health probe (GO-1):** worker serves SPA via `[assets] directory = "../web/dist"` — `GET /` returns SPA HTML, use `GET /api/providers/catalog` as liveness probe. `apps/web/dist` MUST exist before `wrangler dev`/`deploy` (build with `pnpm --filter @project-alpha/web build`).
- **`bash verify.sh` needs only bash + awk + sed + grep** (Python-free) and pins
  **24 files / 194 tests**, 811 Appendix-B lines (128 Appendix-A steps).

## Current status

See [`STATUS_V8.06.md`](STATUS_V8.06.md) for what is implemented, what is verified by which
command, and what remains.

