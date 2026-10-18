# TRANSFER NOTE — for the agent operating the LIVE deployment

Paste this whole file to the other agent. It is dense on purpose: no grind work, just what is
verified, what is missing, and which mistakes not to repeat.

## 0. Situation

Two builds exist and that is fine — but they are NOT the same code.

- **Live deployment** (e.g. `project-alpha-worker-production.rajotto888.workers.dev`): deployed,
  OAuth working, being debugged via screenshots. Owned by you.
- **Verified reference repo**: **24 test files / 194 tests green** (worker 20/155, web 4/39),
  typecheck clean, web production build ✓, worker `deploy --dry-run` ✓, `bash verify.sh` prints
  ALL CHECKS PASS, and a **125-step** audit log lives in `STATUS_V8.06.md` (read **§15** runbook +
  **§16** live-audit first).

The live build demonstrably does NOT come from this repo — root ping string, provider catalog
(2 vs 6 providers, missing `implemented` flag, missing `gpt-4-turbo`), error-code count, session
TTL, index names, `provider_prefs`/`audit_events` columns and `created_at` encoding all differ.
The reference repo is the spec that was contract-verified; the live one is whatever is deployed.

## 1. SECURITY — do this before anything else

Two live `SESSION_SECRET` values were pasted into plain chat (dev + production). Anyone holding the
production value can forge an `alpha_session` cookie for **any uid** and impersonate a user with no
Google login — the HMAC check is the only gate and session middleware deliberately does not verify
the user exists. Both are compromised.

```bash
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'   # run twice
cd apps/worker
npx wrangler secret put SESSION_SECRET --env dev
npx wrangler secret put SESSION_SECRET --env production
npx wrangler deploy --env production
```

Never paste secret values into chat again. Secrets live only in `wrangler secret` storage and the
gitignored `.dev.vars`.

## 2. What the verified repo has that the live build lacks

| Feature | Where |
|---|---|
| Numeric `token_usage.ptm` on the wire (`stream_options.include_usage`) | `adapters/openaiCompat.ts`, `adapters/ptmFailover.ts` |
| 400-degradation: provider rejects `stream_options` → retry **without** the field, answer still streams | `ptmFailover.ts` (`let includeUsage` hoisted outside the attempt loop) |
| `token_usage.vcm` from the non-streaming completion's `usage.total_tokens` | `adapters/vcm.ts` → `orchestrator/runCommander.ts` |
| 6-provider catalog with `implemented: false` flags for unshipped providers | `providers/catalog.ts`, `routes/catalog.ts:12` |
| 19 canonical `ERROR_CODES` + `assertKnownErrorCode()` at the emitter boundary | `packages/shared/src/error-codes.ts` |

Turn-by-turn contract for the usage feature: usage is reported **iff** `includeUsage` was set —
that flag gates BOTH the request-body key and the `onUsage` callback. Only PTM opts in; the FCM
request body stays byte-identical to canonical. On a degraded run `token_usage.ptm` is **absent**
— never `0`, never `null`.

## 3. Corrections — do NOT re-introduce these (all found by auditing runbooks)

| # | Wrong | Right |
|---|---|---|
| C1 | KV namespace `SESSION_KV` | binding is `OAUTH_KV` in all three toml scopes |
| C2 | live SSE check `meta → chunk → done` | `meta → phase(primary_answer,ptm) → chunk* → phase(verification) → verifier_json → [patch] → done` |
| C3 | `token_usage.vcm: null` when unverified | key is **absent**; `null` belongs to `done.vcm` (a different field) |
| C4 | "7 vs 8 migration statements" — **both are right, it is not a contradiction** | the file holds **7** DDL statements (4 tables + 3 indexes) and Wrangler reports **`8 commands executed successfully`** (the 8th is migration bookkeeping; the DB also gains a `d1_migrations` table). Never use either number as a pass/fail gate — success is exit 0 + that message, or "No migrations to apply!" on a re-run |
| C5 | toml starts with a `#` comment | line 1 is `name = "project-alpha-worker"` |
| C6 | stale step/LOC counts | read the current numbers from the doc, never from memory |
| **C7** | **`chunk.source = "primary_answer"`** | `ChunkSource = "fcm" \| "ptm"` — `primary_answer` is a *phase* name. Checking for it makes every chunk look like a failure |

Other locked numbers to sanity-check against: **19** error codes (not 14); session TTL
**2,592,000 s / 30 days** (not 604,800 / 7 days); `users` = `id, oauth_provider, oauth_sub, email,
created_at`; `audit_events` = 12 columns; `created_at` is INTEGER epoch.

## 4. Locked behaviours that must survive any edit (short form)

- Policy block: `meta → error(phase="policy", recoverable=false, provider_id=null) → close`.
  NO `done`, no upstream fetch.
- PTM: retry only *before* the first emitted chunk. After it — 1 fetch, terminal
  `PTM_TERMINAL_MIDSTREAM`, no `done`, no VCM.
- VCM all-attempts-failed: `error(phase="verification", recoverable=true)` then
  `done(unverified, vcm:null)` — no `verifier_json`, no `patch`.
- `phase:"merge"` must never exist.
- Replace mode: `corrected_answer === null`; the server never fabricates corrected text.
- Cookie-only session auth; `Authorization: Bearer` is never read for session.
- No secret persistence server-side, ever (audit rows are metadata-only).

## 6. EXACT WIRE SHAPES — mixing builds is what caused every repeat bug

Captured from a live `wrangler dev --env dev` on this repo. **Copy these verbatim into any mock,
test, or rewrite.** If your build disagrees with these, your build is the one that is wrong unless
you deliberately re-lock the contract.

**GET /api/providers/catalog** (public — 200 without a cookie):

```json
{"providers":[
 {"id":"openai","models":["gpt-4o","gpt-4o-mini","gpt-4-turbo"],"implemented":true,"selectable":true},
 {"id":"groq","models":["llama-3.3-70b-versatile","llama-3.1-8b-instant"],"implemented":true,"selectable":true},
 {"id":"gemini","models":[],"implemented":false,"selectable":false},
 {"id":"anthropic","models":[],"implemented":false,"selectable":false},
 {"id":"deepseek","models":[],"implemented":false,"selectable":false},
 {"id":"mistral","models":[],"implemented":false,"selectable":false}]}
```

- `models` is an array of **strings**. NOT `[{"id":"gpt-4o","name":"GPT-4o"}]`. Rendering an object
  as a React child is `ERR-08` in the other agent's log.
- `selectable` is **always present**. The web client filters `p.implemented && p.selectable`, which
  must yield exactly `openai` + `groq`; if your payload omits `selectable` you get zero providers
  (`ERR-03`).
- No `baseUrl`, no upstream host, ever — pinned by `test/catalog.shape.test.ts` (5 tests).

**GET /api/providers/prefs** — no cookie: `401 {"error_code":"UNAUTHENTICATED","message":"not authenticated"}`.
With a valid cookie: `200 {"provider_prefs":[],"roles":{"fcm":null,"ptm":null,"vcm":null}}`.

**PUT /api/providers/prefs/roles/:role** — body is either
`{"provider_id":"groq","model_id":"llama-3.3-70b-versatile"}` or the bare literal `null` (deletes).
Never send `{"provider_id":null}`.

**POST /api/chat/stream** — requires the session cookie. SSE `chunk.source` ∈ `"ptm" | "fcm"`
(**C7**: never `"primary_answer"`). `done.token_usage` is `Record<string, number>`; keys may be
**absent**, never `null`.

## 7. Windows / local-dev rules (each one cost the other agent a session)

1. **Open the app at exactly one origin**: `http://127.0.0.1:5173` (matches dev `APP_ORIGIN`).
   Vite proxies `/api` → `127.0.0.1:8787`, so all API calls are same-origin. `localhost:5173` and
   `127.0.0.1:5173` are *different* IndexedDB origins — the vault looks "lost" if you switch.
2. **Two terminals, correct folders**:
   - `cd project-alpha\apps\worker` → `npx wrangler dev --env dev --port 8787`
   - `cd project-alpha` → `npx pnpm@9 --filter @project-alpha/web dev`
3. **One Wrangler version only.** Run `wrangler` from `apps/worker` so the local install
   (3.114.17, pinned in the lockfile) is used. `npx wrangler` in a folder *without* a local install
   silently downloads Wrangler 4 — the 3.x/4.x mix is what produced ERR-04/ERR-05 confusion.
4. **Never paste code into PowerShell** (`{`, `}`, `|`, `>` get mangled). Use an editor
   (`notepad file` / VS Code), save, then restart the dev server.
5. **Migrate the LOCAL D1 before local dev** — local is a simulated DB, empty until you seed it:
   `npx pnpm@9 --filter @project-alpha/worker migrate:dev` (idempotent; safe to re-run).
   Local mode has no production rows; to exercise the real user use `--remote`.
6. **Local secrets belong in `apps/worker/.dev.vars`** (gitignored) — `SESSION_SECRET` plus the
   Google client id/secret. Non-secret vars come from `[env.dev.vars]` in `wrangler.toml`. Miniflare
   does *not* read remote secrets (ERR-07). Never paste the values into chat.
7. **Local mode ≠ remote mode.** Prefer local (`--persist-to` optional). If you must use
   `wrangler dev --remote` on Wrangler 3.x, `[env.dev]` now ships `preview_database_id` +
   `preview_id` placeholders — fill them, because remote dev refuses to run against the
   production KV namespace.

## 9. AUTH ROUTES — the shape a pasted runbook got wrong twice

Canonical (`apps/worker/src/routes/auth.ts`):

| Route | Method | Response |
|---|---|---|
| `/api/auth/google/start` | **POST** | `200 {"url":"https://accounts.google.com/…"}` — NOT a 302 |
| `/api/auth/google/callback` | GET | sets `alpha_session`, redirects to `APP_ORIGIN` |
| `/api/auth/logout` | POST | `200 {"ok":true}` |

- There is **no `/api/auth/google/login`**. A GET on `…/google/start` or `…/google/login` is a 404.
  Checking OAuth that way reports a false failure on a healthy worker.
- Why JSON and not a 302: the state + PKCE verifier must be committed to KV *before* the browser
  leaves the origin; the client reads `url` and navigates itself.
- Browser flow: unlock the vault → **Sign in with Google** (button added in step 113; the canonical
  client previously had NO sign-in affordance, which made the documented E2E flow impossible) →
  Google consent → callback sets the cookie → `GET /api/providers/prefs` returns 200.
- DevTools check: the cookie is `alpha_session` with `HttpOnly`, `SameSite=Lax`, `Path=/`,
  `Max-Age=2592000` (30 days), and `Secure` only when `COOKIE_SECURE=true` / https.
- Google Console redirect URI must be exactly `<APP_URL>/api/auth/google/callback`
  (dev: `http://127.0.0.1:8787/api/auth/google/callback`).

**ERR-07 decoded (measured, then fixed):** with `GOOGLE_OAUTH_CLIENT_ID` missing, the old worker
returned `200 {"url":"...&client_id=undefined&..."}` — the browser then hit Google, which said
*"Access blocked: Missing required parameter: client_id"*. That is why the fix looked like a Google
Console problem. It is now a **500** whose message names the missing binding:

```
POST /api/auth/google/start
500 {"error_code":"INTERNAL_ERROR","message":"Google OAuth is not configured: GOOGLE_OAUTH_CLIENT_ID missing or blank"}
```

So: if you see that 500, fix `apps/worker/.dev.vars` and restart `wrangler dev`. If you see
`client_id=undefined` anywhere, you are running the OLD build.

## 8. Fixed in the canonical repo after this session's report

| # | Gap | Fix |
|---|---|---|
| 1 | `migrate:dev` used `d1 execute --file` → second run died with `table users already exists` | now `wrangler d1 migrations apply DB --local --env dev` (verified: `8 commands executed`, re-run `No migrations to apply!`) |
| 2 | `[env.dev]` had no `preview_database_id` / `preview_id` → `wrangler dev --remote` refused to start | both added with comments |
| 3 | no test guarded the catalog payload (the one cross-package contract) | `apps/worker/test/catalog.shape.test.ts` — 5 tests |
| 4 | no sign-in affordance anywhere in `apps/web` | `src/lib/authClient.ts` + header buttons + `test/authClient.test.ts` (7 tests) |
| 5 | runbooks claimed `GET /api/auth/google/login` returns 302 | §9 above; canonical is `POST /google/start` → JSON `{url}` |
| 6 | missing Google client id produced `200` + `client_id=undefined` (ERR-07's real cause) | `GoogleOAuthConfigError` guard + `test/authConfig.guard.test.ts` (9 tests); live re-probe = 500 with a named binding |

## 5. Decide one canonical build

- **If the reference repo is canonical** → deploy it: `cd apps/worker && npx wrangler deploy --env production`,
  then run the live checklist in `STATUS_V8.06.md` §15 (with a real provider key) to confirm a numeric
  `token_usage.ptm` on the wire.
- **If the live build is canonical** → port §2 above from the reference repo and re-verify with
  `bash verify.sh` in the reference repo plus a live SSE capture.

Either way: do not claim a lock is "certified live" unless it was observed on the wire.

## 10. Keys UI + runbook notes (V8.07 delta, steps 118–125)

- The reference repo now HAS a **Keys** tab (`KeysPanel.tsx`): the provider dropdown is fetched from
  `GET /api/providers/catalog` and filtered to `selectable === true` (openai, groq). Save/Remove
  encrypt to the IndexedDB blob only while the vault passphrase is in memory. **This is what makes
  P5 possible** — before it, `/api/chat/stream` could only ever answer `400 MISSING_CREDENTIALS`.
- `GET /` is a public health probe `{ok, service, version}`; unknown routes still 404. Once the worker also
  serves the SPA (`[assets]`, step 128), `GET /` returns the SPA — use `GET /api/providers/catalog` as the liveness probe.
- Migration `0002_audit_index.sql` adds `idx_audit_events_created` (metadata-only).
- `Create new vault` now warns when a blob already exists (`hasVault()` probe) instead of silently
  replacing saved keys.
- See README → "Runbook notes" for the orphan-session 500, optional `token_usage`, the
  `cost_estimate` placeholder, and the Python-free `verify.sh`.


## 11. BYOE Lite — owner-managed private endpoints (V8.08, step 129)

- Catalog now 8 providers: 6 + private-llama + private-smollm, selectable 4 (openai, groq, private-llama, private-smollm).
- `baseUrl` remains server-side only, never leaks to `GET /api/providers/catalog` (pinned by 2 defensive asserts).
- Model ids must EXACTLY match gateway's accepted ids, else `400 MODEL_NOT_RECOGNIZED` (catalog.ts:54 check).
- Keys: user saves key in Keys tab per provider; gateway reads Bearer from `X-EPHEMERAL-KEYS` (header-first).
- FCM: default `fcm: null` (PTM+VCM only). To enable: `fcm: {private-smollm, smollm2-1.7b}` → needs extra key + extra call, deadline 500ms.
- Smoke: browser → Keys tab shows 4 rows → save private-llama key → Chat → /api/chat/stream SSE meta→phase(ptm)→chunk*→phase(verification)→verifier_json→done. D1 audit row shows provider_id=private-llama.
- Rollback: `wrangler deployments list --env production` → `wrangler rollback --name project-alpha-worker-production -m "revert BYOE Lite" -y` → catalog back to 6.

