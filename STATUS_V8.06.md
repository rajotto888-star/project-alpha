# PROJECT ALPHA — V8.06 — FULL HANDOFF (self-contained)

> **Purpose of this file.** This is a single-file handoff. Sharing only this file must be enough
> for a fresh agent to know the entire history, the current verified state, every gotcha already
> paid for, and exactly what to do next — without access to any prior conversation.
>
> **Read order if you are new:** §1 → §2 → §4 (current state) → §14 (next steps) → then §10
> (dead ends) before you touch anything, because those mistakes are expensive to rediscover.
>
> §6 is the phase-level narrative. **Appendix A is the granular step-by-step log** — every small
> patch, test write, and fix in execution order — for auditing exactly what changed and when.
>
> Last verified: **2026-09-24**, Node v20.20.2, in the workspace `/home/user/project-alpha`.

---

## 1. What this project is

**PROJECT ALPHA** is a cloud-native AI orchestrator. It hosts no models and pays for no compute —
inference runs on the *user's own* provider keys. The browser is only the client interface and an
encrypted key vault: no local compute, no local runtime dependency.

- MVP: **manual router only**, OpenAI + Groq. BYOE (bring your own endpoint) deferred to v1.1+.
- Infra: **Cloudflare free tier, $0**. Worker (Hono) + D1 + KV. React/Vite client.
- Architecture: **Commander pattern** — PTM (primary answer, streamed) → VCM (verification) →
  optional FCM (fast draft, raced against a 500 ms deadline). Merge is client-visible but never a
  phase event.
- Hard rule: **no server-side persistence of keys, prompts, or outputs.** Ever.

Acceptance criteria (handoff §9): (a) `tsc --noEmit` passes, (b) `vitest run` passes,
(c) `/api/chat/stream` streams correct SSE ordering + locked behaviour, (d) no secret persistence
server-side. **All four currently PASS** — see §4.

---

## 2. Hard constraints (owner-stated, standing — do not re-litigate)

These were explicitly directed by the owner. They are not my preferences.

**Provenance**
- The pasted **Canonical Snapshot Sync** codebase is authoritative and supersedes every earlier
  reconstruction of mine. Adopt pasted handoff code verbatim rather than rewriting from scratch.
- Re-emitting source back to the owner follows hard paste rules: **one message = exactly one code
  block**; every file prefixed `// FILE: path (REPLACE)`; each file given in full; all secrets,
  real IDs and real origins replaced with `<REDACTED>`.
- **Output rule T (persistent):** whenever asked for an "update plan / task list / remaining work",
  deliver it inside ONE single code block, markdown formatted.

**Security locks R1–R8**
- R1 cloud-only. R2 **no server-side key persistence, absolutely**.
- R3 Commander always-on: PTM always, VCM always after PTM success, FCM optional default ON,
  500 ms deadline.
- R4 hybrid default; in replace mode the **server never fabricates `corrected_answer`** — the
  client reruns.
- R5 auth is **cookie-only**; `Authorization: Bearer` is forbidden for session auth.
- R6 cost disclaimer mandatory. R7 MVP providers OpenAI + Groq, manual router.
- R8 audit is metadata-only.

**SSE locks**
- Policy block = `meta → error(phase="policy", recoverable=false, provider_id=null) → close`.
  **No `done`.**
- VCM all-fail = `error(recoverable=true, phase="verification") → done(unverified, vcm:null)`,
  with **no** `verifier_json`/`patch`.
- PTM: retry only **before** the first successfully emitted chunk; after it, terminal
  `PTM_TERMINAL_MIDSTREAM`, no `done`, no VCM.
- Every `error_code` must come from canonical `ERROR_CODES`, enforced at the emitter boundary via
  `assertKnownErrorCode()`.
- **No merge `PhaseEvent` ever.** `final_verdict ∈ {"verified","unverified"}` only. SSE envelope is
  `{type,...}` inside `data:` JSON.

**V8.06 supersedes V8.05.4/9**
- BYOE deferred to v1.1+. MVP `router_mode` is the fixed literal `"manual"`.
- `provider_id` **must not** contain `:`.

**Other standing rules**
- PBKDF2 iterations live in `packages/shared/src/constants.ts` as `VAULT_PBKDF2_ITERATIONS`
  (single source of truth) — never a local literal in `vault.ts`. Raising is safe; lowering needs
  an explicit re-lock; changing invalidates old vaults absent a migration.
- Local verification must **not** be skipped on the grounds of "no Cloudflare account":
  `wrangler d1 migrations apply --local` and `wrangler dev` need no account.
- Replace-mode rerun payload = original conversation, then the PTM answer as an `assistant`
  message, then the correction instruction as a `user` message.
- Ephemeral keys are header-first via `X-EPHEMERAL-KEYS` (base64 JSON); parse body once; never log.
- Google OAuth: state + PKCE in KV, TTL 5 min, delete-after-use.
- CORS: single app origin, wildcard forbidden, allowed headers `Content-Type` +
  `X-EPHEMERAL-KEYS`.
- `cost_weight INTEGER DEFAULT 5 CHECK (0..10)`. Pricing override key is `"provider:model"` —
  exactly one colon. DB column is `selected_model`; API field is `model_id`.
- Never say "uncensored" — the framing is **user-controlled/customizable guardrails**.
- Worker and web import all canonical types from `@project-alpha/shared`. Shared holds only the
  wire contract + schema + constants + pure utilities.
- §5 upgrade policy — allowed now: CI, contract tests, migration drift checks, perf work that does
  not change SSE ordering/shape, internal-only circuit-breaker scaffolding; auto-router only
  off-by-default. Deferred to v1.1+: BYOE endpoints, SSRF guard, custom policy profiles.
- **A feature counts as complete only when implemented, typed, reachable, tested, and
  security-invariant verified.**

**Resolved by spec (previously open questions)**
- §4.1 PBKDF2-SHA256 = **600,000 LOCKED**.
- §4.2 `role_assignments` is **required** (Option A: `provider_prefs` + separate
  `role_assignments`; `role=null` ⇒ DELETE).

---

## 3. Repository map (verified inventory — 65 `.ts`/`.tsx` files, 6,004 LOC)

```
project-alpha/                       pnpm workspace, 4 projects
├── package.json                     typecheck / test / dev:worker / dev:web / migrate:local
├── pnpm-workspace.yaml, turbo.json, pnpm-lock.yaml (v9)
├── .gitignore                       (created this session — see §9 item 20)
├── .github/workflows/ci.yml         8 steps — see §7
├── README.md                        layout, commands, local-dev, secrets, locked summary
├── STATUS_V8.06.md                  ← this file
├── docs/LOCKED_BEHAVIORS.md         57 lines, 18 numbered locked points
│
├── packages/shared/                 SOURCE OF TRUTH for the wire contract
│   └── src/ constants.ts · error-codes.ts · index.ts · schemas.ts
│            sse-events.ts · sseGuard.ts
│
├── apps/worker/                     Cloudflare Workers (Modules) + Hono
│   ├── src/adapters/    asyncQueue · errors · openaiCompat · ptmFailover · vcm
│   ├── src/db/          audit · providerPrefs · users
│   ├── src/lib/         crypto · ephemeralKeys · googleOAuth
│   ├── src/middleware/  cors · session
│   ├── src/orchestrator/ assertKnownErrorCode · emitter · merge · runCommander
│   ├── src/policy/      baseline
│   ├── src/providers/   catalog
│   ├── src/routes/      auth · catalog · chat · providerPrefs
│   ├── src/types/       env
│   ├── src/index.ts
│   ├── migrations/0001_init.sql     4 tables + 3 indexes
│   ├── wrangler.toml                dev + production envs
│   └── test/            17 spec files + utils/{collectSSE, mockProvider,
│                        mockCompletion, canaryLogger}
│
└── apps/web/                        React + Vite
    ├── src/lib/        vault.ts (IndexedDB AES-GCM) · sseClient.ts
    ├── src/components/ ApplyCorrections.tsx · ProviderSettings.tsx
    ├── src/pages/      Chat.tsx
    ├── src/            main.tsx · App.tsx
    └── test/           vault.test.ts · sseClient.test.ts · setup.ts
```

**Note:** `apps/web/src/chat/ChatPage.tsx` and `apps/web/src/providers/ProviderSettings.tsx` no
longer exist — the sync replaced/moved them. `apps/worker/test/ptm.midstream.test.ts` was deleted
and replaced by `ptm.midstreamErrorCode.test.ts`.

---

## 4. CURRENT VERIFIED STATE (all commands run, all output below is real)

| Command | Result |
|---|---|
| `npx --yes pnpm@9.15.0 install --frozen-lockfile` | **exit 0** — lockfile up to date |
| `pnpm -r typecheck` | **exit 0** — shared, worker, web all Done |
| `pnpm -r test` | **exit 0** — **22 files, 182 tests, 0 failed** (worker 19/152, web 3/30) |
| `wrangler d1 migrations apply DB --local` | **exit 0** — 8 commands |
| `wrangler dev --env dev` + 16 live curls | all endpoints behave per contract (§8) |
| CI guard 1 (secret leak scan) | **PASS** |
| CI guard 2 (audit schema guard) | **PASS** |

**Worker — 20 files / 155 tests:**

| Tests | File |
|---:|---|
| 31 | `pure.units.test.ts` |
| 19 | `vcm.parsing.test.ts` |
| 18 | `auth.flow.test.ts` |
| 9 | `ptm.usage.test.ts` |
| 9 | `chat.route.test.ts` |
| 8 | `routes.public.test.ts` |
| 8 | `commander.paths.test.ts` |
| 7 | `secretPersistence.canary.test.ts` |
| 5 | `locks.andContracts.test.ts` |
| 5 | `ephemeral.precedence.test.ts` |
| 4 | `orphanSession.gap.test.ts` |
| 3 | `policy.gate.test.ts` |
| 3 | `fcm.deadlineAbort.test.ts` |
| 2 | `ptm.failoverBoundary.test.ts` |
| 2 | `errorCodes.guard.test.ts` |
| 1 | `vcm.degrade.test.ts` |
| 1 | `ptm.midstreamErrorCode.test.ts` |
| 3 | `rootHealth.test.ts` (new, step 121) |

**Web — 4 files / 39 tests:** `vault.test.ts` 18, `sseClient.test.ts` 8, `authClient.test.ts` 7,
`keysPanel.test.tsx` 6 (new, step 120).

> **Measurement trap:** the vitest JSON reporter's `numTotalTestSuites` counts *describe blocks*,
> **not files**. Trust the human reporter's `Test Files` line (**20 + 4 = 24 files / 194 tests**).

Acceptance: **(a) PASS · (b) PASS · (c) PASS · (d) PASS.**

---

## 5. The canonical contract (shapes a fresh agent will otherwise guess wrong)

These differ from the pre-sync reconstruction. Each is pinned by a test.

**Emitter — positional and stateful.** No `isTerminal()`.
```ts
meta(requestId, manualProviders) · phase(phase, source?) · chunk(source, delta)
verifierJson(result) · patch(payload) · done(args) · error(args) · close()
```
It **throws** on out-of-state calls: a chunk before its phase, a second `verifierJson`/`patch`,
or `done` after a non-recoverable error. `done()` itself attaches
`cost_disclaimer: COST_DISCLAIMER` (`emitter.ts:154`) — callers must **not** pass it.

**`runCommander({emitter, payload, ephemeralKeys, userId, db, signal})`** — one argument object;
generates its own `requestId` (there is no `requestId` field in `RunCommanderArgs`).

**Events.** `ChunkEvent.delta` (was `text`); `source ∈ "fcm"|"ptm"` (was phase names);
`VerifierJsonEvent` nests `result: VerifierResult`.

```ts
VerifierResult = { verdict: string; needs_correction: boolean; confidence: number;
                   severity: Severity; corrections: Correction[]; notes?: string;
                   usage_tokens?: number /* server-attached, never model-supplied */ }
Correction     = { issue: string; location?: string; explanation?: string;
                   severity: "minor"|"major"|"critical" }   // never "none"
PatchPayload   = { mode:"patch";   corrected_answer: string; corrections }
               | { mode:"replace"; corrected_answer: null;   corrections }  // LOCKED at type level
```
`normalizeVerifierResult` **ignores a model-supplied top-level `severity`** and recomputes
`max(corrections[].severity)`. Invalid correction severity → `"minor"`, never `"none"`.

**VCM.** `adapters/vcm.ts` calls upstream with **`stream: false`** and reads `res.json()`.
Exports `extractStrictJson`, `normalizeVerifierResult`, `deriveTopLevelSeverity`. There is no
`extractJson` / `deriveSeverity` / `toVerifierResult` / `VcmParseError`.

**PTM.** `PtmRunArgs = {providerId, modelId, messages, ephemeralKeys, parentSignal, maxAttempts?,
includeUsage?, onUsage?, onChunk}` (`onChunk` is async), returns `Promise<void>`.
`PtmTaggedError.isPtmMidstream`.

**Stream adapter.** `streamOpenAICompat(config, modelId, messages, signal, opts?)` with
`StreamOpts = { includeUsage?: boolean; onUsage?: (u:{total_tokens:number})=>void }`.
`raceWithDeadline` lives in `adapters/errors` and returns
`{outcome:"ok",value} | {outcome:"deadline"}`. `normalizeProviderError(role, status, isAbort,
isTimeout)`.

**Auth.** `routes/auth.ts` returns **400 JSON `INVALID_REQUEST_BODY`** for missing code/state and
for an unknown state (not 302 + `auth_error=1`). Token-exchange failure **throws** → 500 via
`app.onError`, but still fails closed (`Set-Cookie` null). Userinfo endpoint is
`https://openidconnect.googleapis.com/v1/userinfo`.
`cookieSecureFlag(env) = COOKIE_SECURE === "true" || APP_URL.startsWith("https://")` — **https
cannot be opted out of**.

**Other.** `extractEphemeralKeys(headerValue, bodyKeys)` — 2 args; `validateKeysShape` throws
`InvalidEphemeralHeaderError` for a malformed `provider_id` in the **body** too.
`providers/catalog.ts`: `validateManualProviders(manual, prefs: PrefsLookup)` where `PrefsLookup`
is an object with `isDisabled`, not an array. `db/providerPrefs.ts` returns
`{provider_prefs, roles}` fully typed; `putRoleAssignment(null)` issues a real `DELETE`.
`AuditEventInsert` requires `id`. `middleware/session.ts` does **not** call `getUserById`.
`decideMerge` → `"none"` when `corrections.length === 0`. `chat.ts` fails fast with HTTP 400
`MISSING_CREDENTIALS` **before** the stream opens.

**Web.** `Vault.isUnlocked()` (was `isLocked()`); `createNew(pw): void` is **sync and does not
persist**; `unlock()` returns **true when no blob exists** (empty vault); accessors do **not**
throw while locked; `persist(passphrase)` is separate; re-exports `VAULT_PBKDF2_ITERATIONS`.
`streamChat(url, body, headers, handlers)` returns **`{ abort: () => void }`** (not an
`AbortController`) and its **`onDone()` takes no argument** — observe the done payload through
`onEvent`. `ApplyCorrections` requires prop `assistantAnswer`.

**Test mocks.** `mockOpenAIStream(chunks: Array<{delta?, role?}>, opts?:
{splitAcrossBoundaries?, totalTokens?})`, `mockOpenAIFailure(status)`, `mockSlowStream(delayMs)`,
and `mockOpenAICompletion(content, {status?, totalTokens?})` (added this session, additive).

**Locked constants (from `packages/shared/src/constants.ts`, read not recalled):**
`EPHEMERAL_HEADER_SIZE_THRESHOLD_BYTES = 6*1024` · `DEFAULT_COST_WEIGHT = 5` ·
`DEFAULT_MERGE_STYLE = "hybrid"` · `DEFAULT_PRIORITY_MODE = "balanced"` · `FCM_DEADLINE_MS = 500`
· `PTM_STREAM_TIMEOUT_MS = 60_000` · `VCM_TIMEOUT_MS = 30_000` · `FCM_STREAM_TIMEOUT_MS = 60_000`
· `OAUTH_STATE_TTL_SECONDS = 300` · `SESSION_COOKIE_NAME = "alpha_session"` ·
`SESSION_TTL_SECONDS = 60*60*24*30` · `VAULT_PBKDF2_ITERATIONS = 600_000` · `COST_DISCLAIMER`.

**Policy baseline** (`apps/worker/src/policy/baseline.ts`, verbatim):
```ts
const BLOCK_PATTERNS: RegExp[] = [
  /\b(how\s+to\s+)?(make|build|construct)\s+.*\b(bomb|explosive|pipe[\s-]?bomb)\b/i,
  /\bmeth(amphetamine)?\s+synthesis\b/i,
  /\bchild\s+sexual\s+abuse\b/i,
  /\bcsam\b/i,
];
```
Only the **last** user message is inspected.

**Schema.** `ManualProvidersSchema` = `{fcm: ModelRef|null, ptm: ModelRef, vcm: ModelRef}` and
`ChatStreamRequestSchema` is `.strict()` — extra keys are rejected. `RoleAssignmentPutSchema` is
`ModelRefSchema.nullable()`, so the body is either `{"provider_id","model_id"}` or the literal
`null` (**not** `{"provider_id": null}`). There is **no** `/prefs/cost` endpoint; `cost_weight`
travels inside `PUT /prefs`.

**DB.** `0001_init.sql` has 4 tables — `users`, `provider_prefs`, `role_assignments`,
`audit_events` — plus 3 indexes. `provider_prefs` and `role_assignments` both carry
`FOREIGN KEY (user_id) REFERENCES users(id)`.

---

## 6. Full work log, A → Z (chronological)

### Phase 0 — discarded prototype
Built a monorepo scaffold with a 32-test worker suite. **Deleted (`rm -rf`); that implementation
is gone.** Do not look for it.

### Phase 1 — materialise the V8.06 handoff
Wrote the handoff codebase in 11 `write_file` batches. Set `vault.ts` PBKDF2 → 600_000. Built the
web shell (7 files). Wrote the first `STATUS_V8.06.md`.

### Phase 2 — Task F + Task G
`secretPersistence.canary.test.ts` (7 tests, three layers: compile-time, source scan, runtime).
`.github/workflows/ci.yml` + root pnpm scripts. Leak scan self-checked by injecting a fake
`sk-…` key into a temp file — caught, then deleted.

### Phase 3 — FIX #7 / FIX #8 verbatim, and the first real bug
Applied both fixes verbatim. Added `locks.andContracts.test.ts`. Ran
`wrangler d1 migrations apply DB --local` (exit 0), then a live `wrangler dev` smoke — **which
found a real bug**: `use("*", sessionMiddleware)` in `providerPrefs.ts` shadowed the public
`/catalog` at the shared `/api/providers` prefix, so `GET /api/providers/catalog` returned 401 and
the UI could never populate its dropdowns. Fixed by scoping to `/prefs*` and mounting catalog
first in `index.ts`. **Lesson: the live smoke is what found it, not the tests.**

### Phase 4 — spec coverage
Wrote `routes.public`, `vcm.parsing`, `chat.route`, `pure.units`, `commander.paths`, `auth.flow`
specs, plus the first `README.md`.

### Phase 5 — pre-sync green gate
`pnpm install` / `-r typecheck` / `-r test` all exit 0; both CI guards PASS.
(17 files / 136 tests — **this baseline is now VOID**, it measured the pre-sync contract.)

### Phase 6 — apps/web bootstrap
`apps/web` had `test: echo (no tests yet)`. Added vitest + jsdom + fake-indexeddb. Two real fixes:
a `terminated` flag in `sseClient.ts` (see §9 item 4), and swapping `globalThis.indexedDB = new
IDBFactory()` per test in `setup.ts` (see §10). 18 tests passing. Added the `Unit tests (web)` CI
step after noticing CI never ran the web suite.

### Phase 7 — work log + Group 1 re-emission
Delivered the full work log in ONE code block (rule T), then **Group 1** of the
`// FILE: path (REPLACE)` re-emission: `apps/worker/src/{index.ts, routes/catalog.ts,
routes/providerPrefs.ts, middleware/session.ts, middleware/cors.ts}`. Also corrected two wrong
paths in the owner's request list: web tests live in `apps/web/test/` (not `src/lib/`), and
`vault.test.ts` covers vault crypto, not the zombie-event fix.

> ⚠️ **Group 1 is now STALE.** The Canonical Snapshot Sync replaced all five of those files.
> Applying Group 1 today would break canonical code. Do not re-apply it.
> The reverse is equally true: the original handoff paste does NOT contain this session's
> PTM-usage delta, so re-applying the paste from scratch would silently delete that work.
> The five delta files (§14 / A.22) are what must be layered on top.

### Phase 8 — CANONICAL SNAPSHOT SYNC (the authoritative migration)
Materialised the paste in 11 bash heredoc batches, all exit 0: shared ×2; worker
orchestrator/adapters ×4; `vcm`; `runCommander`; `db` ×1; lib/policy/providers/types ×1;
middleware/routes/index ×1; chat + migration + wrangler ×1. Then web: `vault.ts` + `sseClient.ts`;
`ApplyCorrections.tsx` + `pages/Chat.tsx`; `rm src/chat/ChatPage.tsx`; a python patch to `App.tsx`;
`mv providers/ProviderSettings.tsx → components/`; `test/utils/*`;
`rm test/ptm.midstream.test.ts`; `vcm.degrade` + `ptm.midstreamErrorCode` specs;
`docs/LOCKED_BEHAVIORS.md`.

### Phase 9 — re-verification after the sync
Reinstalled (node_modules had vanished again). `tsc --noEmit` → 1 src error + ~40 test errors.
Fixed the `res.json()` boundary typing in `src/adapters/vcm.ts` (see §10). Patched
`fcm.deadlineAbort`, `ephemeral.precedence`, `secretPersistence.canary`, `ptm.failoverBoundary` ×2
until typecheck-clean.

### Phase 10 — rewriting specs against the new contract
- `vcm.parsing.test.ts` rewritten for `extractStrictJson` / `normalizeVerifierResult` /
  `deriveTopLevelSeverity` → 19 tests passing.
- `pure.units`: `issue` on `Correction`, `NO_PREFS: PrefsLookup`, `verdict` on `VerifierResult`.
  Regex-rewrote `mockOpenAIStream(["a"])` → `mockOpenAIStream([{delta:"a"}])` across
  `chat.route`, `locks.andContracts`, `commander.paths`, `policy.gate`.
- `policy.gate.test.ts` rewritten — `RecordingEmitter implements SSEEmitterLike` (positional),
  1-arg `runCommander`, dropped `isTerminal()` → 3 passing.
- `commander.paths.test.ts` rewritten — positional emitter, `"fcm"|"ptm"` sources, `chunk.delta`,
  a `verifier()` helper → still 7/8 failing (root cause found next).
- `locks.andContracts`: removed the obsolete `requestId`, `requestSignal`→`signal`, `emitter`
  moved inside the args object. `auth.flow`: added `flagEnv()` spreading `BASE_ENV`.

At this point: `tsc` exit 0, but `vitest` → 5 failed / 10 passed files, 17 failed / 103 passed.

### Phase 11 — root-cause diagnosis (the single biggest win)
A grep showed `vcm.ts` uses **`stream: false`** + `res.json()`, while `mockProvider.ts` only
produced SSE. `res.json()` threw → `VCM_ALL_ATTEMPTS_FAILED`. **That one mismatch caused 8 of the
17 failures.** Not 8 bugs — one.

### Phase 12 — §7 token usage plumbing
Added `usage_tokens?: number` to `VerifierResult` (`packages/shared/src/sse-events.ts`,
server-attached, never model-supplied); captured `usage.total_tokens` in `adapters/vcm.ts`;
populated `tokenUsage.vcm` in `runCommander.ts`. Created `test/utils/mockCompletion.ts`.
Converted all VCM mocks to `mockOpenAICompletion(..., {totalTokens})`.
→ `commander.paths` 8/8, `locks.andContracts` 5/5, `ephemeral.precedence` 5/5,
`auth.flow` 18/18, `pure.units` 31/31 (with a `knownNotCaughtByCanonicalPattern` set pinning the
narrow policy gap). **Worker gate: 15 files / 122 tests, exit 0. Web `tsc` exit 0.**

### Phase 13 — web suite against the canonical API (this session)
Web tests still encoded the pre-sync contract and failed 10/18. Rewrote both:
- `vault.test.ts` → 15 tests against `isUnlocked()`, sync `createNew()`, non-throwing accessors,
  `unlock()` → true on no blob, salt rotation on re-persist, blob shape `{salt,iv,ciphertext}`,
  and the 6 KB header threshold.
- `sseClient.test.ts` → 8 tests against `onDone()` with no argument and a `{abort}` return.
Two of my own test bugs fixed on the way: `readRecord()` hung because the IDB object store did not
exist yet (`onupgradeneeded` had to create it, or the promise never settles), and three
`res.json()` call sites in `auth.flow` now return `unknown`.

### Phase 14 — `.gitignore`
**The repo had no `.gitignore` at all.** Created one excluding `.dev.vars`, `.wrangler/`,
`node_modules/`, build output, caches. (No git repo exists in this workspace yet, so nothing was
actually committed — this is preventive, before the first `git init`.)

### Phase 15 — post-sync local smoke (the paste's own GAPS section demanded it)
`wrangler d1 migrations apply DB --local` → 8 commands, exit 0. Then a live worker and 16 real
curls (§8). Two anomalies appeared — `PUT /prefs` → 500 and role assignment → 400 — and **both
turned out to be my test payloads being wrong, not production bugs**: the `users` table was empty
so the FK constraint fired, and I had sent `{"provider_id":null}` where the schema wants a bare
`null`. But that investigation surfaced a genuine gap (see §12 item 3), now pinned by
`orphanSession.gap.test.ts` (4 tests).

### Phase 16 — docs regeneration
Regenerated `STATUS_V8.06.md` and updated `README.md` (test counts, the `.dev.vars` local-dev
step, renumbering). Corrected an overstated claim of mine: I had written that `.dev.vars` "would
have been committable", but no git repo exists, so the claim was rescoped.

### Phase 17 — owner decisions
Asked three questions. Answers: **PTM usage → implement**; **policy breadth → keep canonical**;
**orphan-session 500 → keep as-is**.

### Phase 18 — PTM usage implemented
`streamOpenAICompat` gained opt-in `StreamOpts.includeUsage`, which does two coupled things: adds
`stream_options:{include_usage:true}` to the request **and** gates `onUsage`. Only PTM opts in —
**FCM's request body stays byte-identical to the canonical contract** (the key is absent, not
`false`) and VCM is unaffected. `runPtmWithFailover` buffers usage per attempt and surfaces it
**only for the attempt that fully succeeds**. `runCommander` writes `tokenUsage.ptm`.
`mockProvider.ts` gained an optional trailing usage frame. Added `ptm.usage.test.ts`.

Two corrections found by my own tests, not by me:
1. Usage was being captured even when `includeUsage` was false (because a callback was present).
   Fixed so the flag gates **both** halves — usage is reported *iff* it was requested.
2. A web search surfaced that a non-conforming upstream answers **400** to `stream_options`. That
   meant telemetry could kill the user's answer. Added a degradation path: on
   `statusFromError(err) === 400` while usage was requested, drop the field and retry the same
   request without it. The downgrade lives outside the attempt loop so it persists, and it is
   reachable only while `firstChunkEmitted` is false — so the LOCKED midstream rule is untouched
   and no partial answer is ever duplicated. After a downgrade `token_usage.ptm` is simply absent.
   One dead-code flag (`usageUnsupported`) was removed after I noticed I never read it.

Both MVP providers support the field — OpenAI specifies it, Groq documents
`stream_options={"include_usage": true}` — so the downgrade is a safety net for future catalog
entries, not the normal path.

### Phase 19 — final gate + delta re-emission started
Re-ran the live worker after the production change (PTM ordering intact, `PTM_AUTH_INVALID` as
expected with a fake key). Final gate green: 19 files / 158 tests. Verified `cost_disclaimer` is
attached by the emitter itself (`emitter.ts:154`), so R6 holds and callers must not pass it.
Began re-emitting the session's production delta as `// FILE: … (REPLACE)` blocks; emitted
`packages/shared/src/sse-events.ts` first (dependency order). Four files remain — see §14.

---

## 7. CI pipeline (`.github/workflows/ci.yml`)

pnpm/action-setup@v4 + setup-node@v4 (node 20), then 8 steps in order:
`Install` (`pnpm install --frozen-lockfile`) → `Typecheck (shared)` → `Typecheck (worker)` →
`Typecheck (web)` → `Unit tests (worker)` → `Unit tests (web)` → `Secret leak scan` →
`Audit schema guard`.

- **Guard 1** — regex `(sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,})` over
  `*.ts|tsx|json|toml`.
- **Guard 2** — fails if `migrations/0001_init.sql` gains a content-bearing column
  (`prompt|output|messages|headers|cookie|authorization|api_key|secret`).

Both were executed locally this session: **PASS**.

**Task F canary** (`secretPersistence.canary.test.ts`, 7 tests): compile-time (`AuditEventInsert`
rejects `prompt`/`output`/`api_key`/`headers` under `@ts-expect-error` — widening the type breaks
the build); a comment-stripped source scan of `apps/worker/src` forbidding `console.*` of key
material and content-bearing columns in `src/db/**`; and a runtime check against a capturing fake
D1. One deliberate carve-out: `lib/crypto.ts` legitimately stringifies the *session* payload
`{uid, exp}`.

---

## 8. Local deploy smoke (16 live requests, all re-run after the sync)

| Request | Result |
|---|---|
| `GET /api/providers/catalog` (anonymous) | **200** — 6 providers, selectable `openai`+`groq`, **no `baseUrl` leak** |
| `GET /api/providers/catalog` (cookie) | **200** — the Phase-3 fix confirmed in situ |
| `GET /api/providers/prefs` (no cookie) | 401 `UNAUTHENTICATED` |
| `GET /api/providers/prefs` (cookie) | 200 `{"provider_prefs":[],"roles":{ptm,vcm,fcm}}` |
| `PUT /api/providers/prefs` valid `cost_weight:7` | **200**, GET returns 7 |
| `PUT /api/providers/prefs` invalid `cost_weight:11` | 400 `INVALID_REQUEST_BODY` |
| `PUT /api/providers/prefs/roles/vcm` `{provider_id,model_id}` | **200**, reflected in GET |
| `PUT /api/providers/prefs/roles/vcm` `null` | **200**, row genuinely deleted (verified in D1) |
| `POST /api/chat/stream` (no cookie) | 401 `UNAUTHENTICATED` |
| `POST /api/chat/stream` (cookie, no keys) | 400 `MISSING_CREDENTIALS` — fails fast before the stream |
| `POST /api/chat/stream` (cookie + keys) | 200 `text/event-stream` — `meta → phase:primary_answer → error(PTM_AUTH_INVALID)` |
| Tampered cookie | 401 `SESSION_EXPIRED` |
| `GET /api/nope` | 404 `NOT_FOUND` |
| CORS allowed origin | `Allow-Origin` echoed, `Allow-Credentials: true`, `Vary: Origin` |
| CORS `https://evil.example` | **no** CORS headers, no wildcard |
| `OPTIONS /api/chat/stream` | 204, `Allow-Headers: Content-Type,X-EPHEMERAL-KEYS` |

**How to reproduce the authenticated cases:** `SESSION_SECRET` is a secret, not a `[vars]` entry,
so create `apps/worker/.dev.vars` (gitignored) with a throwaway value. Then mint a cookie — the
format is `base64url(JSON({uid,exp})).base64url(HMAC-SHA256(body, secret))`, SHA-256, seconds
expiry — and insert a matching row into `users`, or writes will hit the FK constraint.

---

## 9. Real bugs found and fixed (each was reproduced, not theorised)

1. **Catalog 401 shadowing** — `use("*", sessionMiddleware)` on the shared `/api/providers` prefix
   hid the public catalog. Found only by the live smoke.
2. **CI failed at step 1** — `install --frozen-lockfile` with no `pnpm-lock.yaml`.
3. **CI never ran the web suite** — added the `Unit tests (web)` step.
4. **`openaiCompat.ts` silent hang** — `res.body!.getReader()` sat outside the `try`, so a sync
   failure escaped as an unhandled rejection and the `AsyncQueue` never closed; the consumer
   blocked forever. Every failure path now calls `queue.fail(err)`.
5. **`sseClient.ts` zombie events** — `controller.abort()` on a terminal error did not drop frames
   already in the parser buffer, so a post-error `chunk` still reached the UI. Fixed with an
   explicit `terminated` flag.
6. **`vcm.ts` untyped `res.json()` boundary** — `@cloudflare/workers-types` types `Response.json()`
   as `{}`; cast at the boundary rather than using `any`.
7. **`eventsource-parser` API mismatch** — `createParser({onEvent})` is v3; pinned `^1.1.2` →
   `TS2353`. Bumped to `^3.0.0`.
8. **Illegal union extension** — `interface PatchEvent extends BaseEvent, PatchPayload` is
   `TS2312` because `PatchPayload` is a union. Rewritten as an intersection.
9. **TS 5.7 generic `Uint8Array` broke WebCrypto** (`TS2769`) — type salt as
   `Uint8Array<ArrayBuffer>`. Applied in both `vault.ts` and `lib/crypto.ts`.
10. **`zod` unresolvable from worker `tsc`** (`TS2307`) — deps must be installed in
    `packages/shared` too, since the worker pulls shared *source* via `paths`.
11. **`lib/crypto.ts`** — `const [body, sig] = parts` could bind `undefined`; guard added.
12. **`adapters/ptmFailover.ts`** — `err as PtmTaggedError` assumed an `Error`; non-Error throws are
    now wrapped so the tag fields are writable.
13. **`apps/web` missing `@types/node`** — `vite.config.ts`'s `node:url` import would not resolve.
14. **Canary over-broad rule** — flagged `lib/crypto.ts` (legitimately stringifies `{uid, exp}`).
    Fixed by flagging an explicit list and stripping comments before scanning.
15. **`npm install` in a pnpm workspace** left a stray `package-lock.json`; deleted and regenerated
    the pnpm lockfile.
16. **Duplicate `ModelRef`** and **`Correction.severity` allowing `"none"`** — both fixed by the
    canonical paste.
17. **PTM usage captured without opt-in** — the flag now gates both request and callback (§6
    Phase 18).
18. **Telemetry could kill the answer** — a 400 on `stream_options` now degrades to a usage-free
    retry (§6 Phase 18).
19. **Missing `.gitignore`** — created.
20. **Dead code** — `usageUnsupported` was written but never read; removed.

---

## 10. DEAD ENDS and environment gotchas — read before touching anything

**Toolchain**
- **`npx tsc` does NOT run TypeScript here.** It installs the deprecated `tsc@2.0.4` placeholder
  and exits 1 ("this is not the tsc command you are looking for"). Use the per-package bin:
  `apps/worker/node_modules/.bin/tsc`. The root `node_modules/.bin/` holds **only `turbo`**, so
  `../../node_modules/.bin/tsc` from a package dir fails with 127.
- **`node_modules` does not survive between sessions.** Always
  `npx --yes pnpm@9.15.0 install --frozen-lockfile` (~6–9 s) before any typecheck/test claim.
- **`corepack enable`/`prepare` fails here** (permission error under `/usr/lib/node_modules`).
  Use `npx --yes pnpm@9.15.0 <cmd>`.
- TypeScript is **5.9.3**. Vitest 2.1.9. Wrangler 3.114.17.
- `bc` is not installed — `paste -sd+ | bc` silently yields nothing.
- `idb-keyval` is **not** a dependency of `apps/web`; `vault.ts` uses raw `indexedDB`.

**Worker tsconfig** — ES2022/ESNext/bundler, `lib:["ES2022","DOM"]`,
`types:["@cloudflare/workers-types"]`, strict, noEmit, `paths` shared→source,
include `["src","test"]`, and **deliberately no `noUncheckedIndexedAccess`** (it broke
`attempts[i]`/`deltas[i]`). Shared is referenced as `file:../../packages/shared` — **do not
"fix" it to `workspace:*`**.

**Testing traps**
- **`indexedDB.deleteDatabase()` in `beforeEach` deadlocks this suite** — `vault.ts` never closes
  its IDB connections. Swap `globalThis.indexedDB = new IDBFactory()` per test instead. Do not
  reintroduce `deleteDatabase`.
- `ReadableStream.getWriter()` does not typecheck in the worker tsconfig; build streams via
  `start(controller)`.
- A synchronous `controller.error()` inside `ReadableStream.start()` makes Node discard queued
  chunks; use `setTimeout(..., 0)`.
- `mockResolvedValue(new Response(...))` reuses one body → `ReadableStream is locked`. Use
  `mockImplementation(async () => freshResponse())`.
- A bare `ReadableStream` in a test needs its IDB object store to exist first, or a `transaction()`
  call throws inside `onsuccess` and the promise never settles (the test just hangs).
- Compiled CJS assertions inside `packages/shared` fail with
  `require is not defined in ES module scope`.
- `python3` heredoc patches fail loudly (`AssertionError`) when the anchor text is not verbatim —
  `grep` for the exact anchor first.

**Process lessons**
- **Never trust a pasted "A→Z CODING WORK DONE" report as ground truth.** Only `tsc`/`vitest`
  output counts. Corollary that paid off repeatedly: when the owner lists "remaining" items, most
  are already done — verify with `ls`/`grep` first.
- **Never write tests against an imagined API.** An early web test invented
  `Vault.lockVault/unlockVault/hasVault` and handlers `onMeta/onChunk/onVerifierJson`, and omitted
  the mandatory numeric `timestamp` that `isSSEEvent` requires → `0 tests` collected. Always `cat`
  the source (and `sseGuard.ts`) first.
- **Claiming "deploy verification blocked — no Cloudflare account" was WRONG.** Local
  migration + `wrangler dev` need no account and found a real 401 bug. Only remote D1/KV,
  `secret put`, and `deploy` need an account.
- Asking ChatGPT for a verbatim handoff returned `UNAVAILABLE`; the owner supplied it. Do not ask
  again.
- A torch==2.4.0 pin was unresolvable and heavy installs hit
  `OSError [Errno 28] No space left on device`. Abandoned; not needed.

---

## 11. Owner decisions taken (2026-09-24)

| Question | Decision |
|---|---|
| `token_usage.ptm` absent (PTM streams, no `include_usage`) | **Implement** — done, §6 Phase 18 |
| Policy baseline narrower than pre-sync (`/\bmeth(amphetamine)?\s+synthesis\b/i` only fires on the literal phrase) | **Keep canonical** — the known-gap set stays pinned so any widening is a reviewed change |
| Orphaned session returns 500, not 401 | **Keep as-is** — no extra D1 round trip per request; behaviour pinned by `orphanSession.gap.test.ts` |

---

## 12. Known gaps — deliberately pinned, not hidden

1. **Policy breadth.** Verified by executing the regex directly: `"meth synthesis guide"` →
   BLOCKED; `"how do i make a bomb"` → BLOCKED; `"how do i cook meth"` → **allowed**;
   `"how to synthesize methamphetamine"` → **allowed**. `pure.units.test.ts` asserts both the
   blocked set and a `knownNotCaughtByCanonicalPattern` set, so widening is a deliberate change.
2. **`token_usage.ptm` is absent when the provider reports no usage.** Never a fabricated `0`.
3. **Orphaned sessions → 500, not 401.** `middleware/session.ts` verifies HMAC + expiry but never
   calls `getUserById`, so a session for a `uid` with no `users` row still authenticates; the first
   **write** then fails at the FK boundary and surfaces as `INTERNAL_ERROR`. Reproduced live:
   empty `users` → 500; insert the row → identical request returns 200. `orphanSession.gap.test.ts`
   pins it: orphan reads succeed, orphan writes 500, tampered tokens still 401, missing cookie
   still 401.
4. **`wrangler.toml` ships `<REDACTED>` D1/KV ids.** They must be replaced with real values before
   any deploy.

---

## 13. What is blocked (needs the owner's Cloudflare account)

Local dev is fully verified. Only these need an account: `wrangler d1 create`,
`wrangler kv namespace create`, `wrangler secret put SESSION_SECRET | GOOGLE_OAUTH_CLIENT_ID |
GOOGLE_OAUTH_CLIENT_SECRET`, `wrangler deploy`, and one real browser OAuth round-trip.

**Honest capability verdict (unchanged):** the orchestrator buys automation and latency, never
speed beyond upstream generation. "Uncensored" is not deliverable. The alternative is
user-controlled guardrail profiles plus a permanent hard block on illegal categories.

---

## 14. NEXT STEPS (in priority order)

1. **Re-emission — COMPLETE.** Deltas 5/5 (A.22: `sse-events.ts` → `openaiCompat.ts` →
   `ptmFailover.ts` → `vcm.ts` → `runCommander.ts`), and the Group 2 web set delivered in full
   (A.25: `sseClient.ts` + `sseClient.test.ts` + `vault.ts` + `vault.test.ts` + `setup.ts` +
   `vitest.config.ts` + `vite.config.ts`), plus Group 3 `wrangler.toml` ahead of schedule.
   **Do not re-emit Group 1** — the sync superseded it; and do not re-apply the original paste
   from scratch — it predates the PTM-usage delta and would silently delete it.
2. **Deploy** once the owner supplies real D1/KV ids and secrets (§13).
3. Optional, only if the owner asks: widen the policy baseline (§12.1), or add the
   `getUserById` existence check to `sessionMiddleware` (§12.3). Both would require updating the
   tests that pin the current behaviour, deliberately.

**Before claiming anything works — run the bundled verifier:**

```bash
cd /home/user/project-alpha && bash verify.sh
```

It is newline-safe (paste-proof) and checks all four layers in one go: the eight handoff files'
line counts against Appendix B (807 total), this document's Appendix A contiguity + stale-count
scan, repo hygiene (no stray `.git`, valid TOML first line at `apps/worker/wrangler.toml`,
`.dev.vars` gitignored), and the root gate. Expect `ALL CHECKS PASS` and exit 0.

The long form it wraps: `npx --yes pnpm@9.15.0 install --frozen-lockfile`, then
`pnpm -r typecheck`, then `pnpm -r test` → exit 0 / exit 0 / 24 files, 194 tests. Then
`wrangler d1 migrations apply DB --local` and a `wrangler dev` smoke (§8) — that smoke is what has
historically found the bugs the tests missed. (Note: on the *script's* first draft my own `for`
loop mis-split `69 path` pairs — see step 100 — which is exactly why the verifier now exists:
the checks run the same way every time instead of being retyped.)

---

## 15. DEPLOYMENT RUNBOOK (verified against the shipped repo)

Every command below was checked against the pinned Wrangler 3.114.17 CLI (`--help` output) and the
shipped `wrangler.toml` / `0001_init.sql` / `auth.ts`. Five corrections were applied to the external
runbook that prompted this section (step 102), and **one of those six was itself wrong and has been
withdrawn** (C4 — see step 106); the consequential ones are the KV namespace name (`OAUTH_KV`,
**not** `SESSION_KV`), the live SSE sequence (phases and `verifier_json` are not optional), and
`token_usage.vcm` being **absent** rather than `null` when VCM degrades.

**Facts this runbook depends on:**
- `wrangler.toml` binds `DB` (D1) and `OAUTH_KV` (KV) in three scopes: top-level, `[env.dev]`,
  `[env.production]` — **six** `<REDACTED>` ids in total (both scopes' D1 *and* KV).
- `0001_init.sql` = **7 DDL statements** (4 × `CREATE TABLE`, 3 × `CREATE INDEX`), and Wrangler
  reports **`8 commands executed successfully`** for it — measured on a FRESH local DB, not recalled
  (step 106). The two numbers measure different things, not a contradiction: the extra command is
  migration bookkeeping (the resulting DB also contains a `d1_migrations` table).
  Success = exit 0 + that message; on re-run the message becomes "No migrations to apply!", which is
  also success. **Never use either count as a pass/fail gate.**
- `users` columns are `id, oauth_provider, oauth_sub, email, created_at`.
- Session cookie: `httpOnly` (Hono default), `secure = COOKIE_SECURE==="true" || APP_URL.startsWith("https://")`,
  `sameSite: "Lax"`, `path: "/"`, `maxAge = SESSION_TTL_SECONDS`.
- Canonical success sequence: `meta → phase{primary_answer,ptm} → chunk* → phase{verification} →
  verifier_json → [patch] → done`. Never `phase:merge`. On VCM failure: `… phase{verification} →
  error{recoverable:true} → done{unverified, vcm:null}` with no `verifier_json`/`patch`.

### 15.1 Second reconciliation (external runbook v2) — one consequential error, three refinements

Audited a revised runbook. Fixes it got right (re-verified on disk): `DB` + `OAUTH_KV` bindings,
7 DDL statements, catalog public / `prefs*` authed, `PRAGMA table_info` works in D1 (ran it locally —
rows come back as `{cid, name, type, notnull, dflt_value, pk}`), and the `token_usage` "key absent,
not null" semantics.

**Corrected (step 104):**
- **C7 — `chunk.source` is `"ptm"`, never `"primary_answer"`.** The revised runbook's §3.3 told the
  reader to expect `chunk* (source="primary_answer")`. `ChunkSource = "fcm" | "ptm"`
  (`sse-events.ts:29`), and `runCommander.ts` emits `emitter.chunk("ptm", …)` / `("fcm", …)`.
  `primary_answer` is a *phase* name; `ptm` is that phase's chunk *source*. Checking for
  `source="primary_answer"` live would fail every chunk. Worse than the earlier `SESSION_KV` slip —
  it produces a false failure on a **passing** system.

**Refinements folded into §15:**
- `APP_URL` and `APP_ORIGIN` are **different hosts**, matching the shipped toml
  (`alpha-worker.example.workers.dev` vs `alpha.example.com`): `APP_URL` = the worker/API domain
  (also the OAuth redirect base), `APP_ORIGIN` = the browser app origin that CORS echoes. §15's step
  1 wording previously set both to one placeholder — corrected.
- `isSSEEvent` is permissive **for non-error frames** (only `type` + numeric `timestamp` are
  required) but **strict for `error` frames** — `error_code` must be in `KNOWN_ERROR_CODES`
  (`sseGuard.ts:21-25`). So a future error path emitting a non-canonical code is dropped
  client-side rather than surfaced. The guard is not uniformly lax.
- `apps/web/.git` is **already removed** (step 98) — v2 still listed it as outstanding housekeeping.

## 16. LIVE ENDPOINT AUDIT — the deployed worker is NOT built from this repo

An execution report claimed the backend was deployed and "certified live" at
`https://project-alpha-worker-production.rajotto888.workers.dev`. **The host is real** — both URLs
were fetched directly and answered HTTP 200:

| Live URL | Response |
|---|---|
| `GET /` | `Project Alpha Worker Live (V8.06)` |
| `GET /api/providers/catalog` | `{"providers":[openai(2 models), groq(2 models)]}` |

**But that build is not this repository.** The deploy is real; the certification does not apply to
the code in this workspace. Evidence:

| # | Report / live behaviour | This repo (verified on disk) |
|---|---|---|
| L1 | root returns `Project Alpha Worker Live (V8.06)` | that string exists **nowhere** in `apps/worker/src/` |
| L2 | catalog: 2 providers, 4 models, **no** `implemented` field | `catalog.ts`: **6** providers, 4 × `implemented: false`; `catalog.ts:12` emits `implemented` |
| L3 | `gpt-4-turbo` absent from OpenAI | shipped catalog lists `gpt-4o`, `gpt-4o-mini`, **`gpt-4-turbo`** |
| L4 | "14 canonical error codes" | `error-codes.ts` = **19** |
| L5 | cookie `Max-Age=604800` (7 days) | `SESSION_TTL_SECONDS = 60*60*24*30` = **2,592,000** (30 days) |
| L6 | indexes `idx_users_oauth`, `idx_provider_prefs_user_id`, `idx_audit_events_created_at` | `idx_provider_prefs_user`, `idx_role_assignments_user`, `idx_audit_events_user`; **no** separate users index (UNIQUE is inline) |
| L7 | `provider_prefs(user_id, provider_id, selected_model, cost_weight, created_at, updated_at)` | also `enabled`, `priority_mode`, `quota_hint_daily`; composite PK; **no** `created_at` |
| L8 | `audit_events(id, user_id, status, phase, error_code, latency_ms, created_at)` | 12 columns, incl. `request_id`, `provider_id`, `model_id`, `token_estimate`, `cost_estimate` |
| L9 | D1 query returned `created_at` as `2026-09-24T10:50:44.494Z` | `users.created_at INTEGER NOT NULL` (epoch) — an ISO string cannot come from that column |
| L10 | report §5 claims steps 104–106 = deploy + OAuth | my step 104 = runbook-v2 audit; doc held 104 steps / 1060 lines at audit time |

**Interpretation.** Someone deployed a *different* (simpler/earlier) implementation to that hostname,
or the report was written against another codebase. Either way: **do not treat that live URL as
evidence for this repo's locks**, and do not carry its "certified" status over. The canonical path is
re-deploy from this repo, then run §15's live checks — which the report never did for the one
artifact this repo added: a numeric `token_usage.ptm` on the wire.

### 16.1 INCIDENT — session secrets were pasted into chat (rotate now)

The report's §2 published two 64-hex `SESSION_SECRET` values (dev + production) in plain text. Anyone
holding the production value can forge an `alpha_session` cookie for **any** `uid` and impersonate a
user **without** completing Google OAuth — the HMAC check is the only gate, and `session.ts`
deliberately does not call `getUserById`. Treat both as compromised.

```bash
# generate two fresh values (run twice), then:
cd apps/worker
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
npx wrangler secret put SESSION_SECRET --env dev          # paste new value 1
npx wrangler secret put SESSION_SECRET --env production   # paste new value 2
npx wrangler deploy --env production
```

Rotation invalidates every existing session (expected, acceptable). The leaked Google *client ID* is
public information and needs no rotation; the client **secret** was not pasted — keep it that way.
From now on: secrets live only in `wrangler secret` storage and the gitignored `.dev.vars`.

## Appendix A — Granular step log (every small step, in execution order)

> **How to read this.** §6 tells the story in 19 phases. This appendix is the raw per-step record
> of the work — each individual file write, patch, test, and fix, in the order it happened — so a
> new agent can audit exactly what was done and verify any single step. Items marked *(history)*
> belong to the pre-handoff implementation the owner deleted; they are recorded only so nobody
> re-discovers the same traps. Test counts are the per-file counts pinned in §4.

### A.0 Initial build *(history — deleted by owner)*

1. Monorepo scaffold: pnpm workspace + turbo, 4 projects (`packages/shared`, `apps/worker`,
   `apps/web`, root).
2. First worker implementation with a 32-test suite — **later found not to match the canonical
   handoff**, and deleted (`rm -rf`) at the owner's direction. Recorded only as history.

### A.1 Materialising the canonical V8.06 paste

3. Wrote the full handoff into the workspace: shared (6 files), worker `src/`, worker `test/`
   utils, web app (`main/App/Chat`, `lib/vault`, `lib/sseClient`, components),
   `docs/LOCKED_BEHAVIORS.md`.
4. Set `VAULT_PBKDF2_ITERATIONS = 600_000` in `packages/shared/src/constants.ts` (single source of
   truth; `vault.ts` imports it — no local literal).
5. Bootstrapped the web shell so `apps/web` has a runnable `dev` script and its own test script.

### A.2 Task F — secret-persistence canary

6. Wrote `test/secretPersistence.canary.test.ts` (7 tests): flags any persistence path that
   stringifies an ephemeral key; explicit allow-list for `lib/crypto.ts` (legitimately stringifies
   `{uid, exp}`); comments stripped before scanning to avoid false positives.

### A.3 Task G — CI pipeline

7. Wrote `.github/workflows/ci.yml` — 8 steps (see §7) incl. the two guards: (1) `pnpm-lock.yaml`
   must exist and match `--frozen-lockfile`, (2) the leak-scan self-check (canary must pass on a
   known-clean tree AND fire on a planted secret).
8. Fixed: CI failed at step 1 because no `pnpm-lock.yaml` existed — generated it with the same
   pnpm version the CI pins (`9.15.0`).

### A.4 Re-emission of FIX #7 / FIX #8

9. Delivered both fix blocks verbatim as `// FILE: … (REPLACE)` single-code-block messages per the
   owner's paste rules. *(Superseded by the sync below — the sync output is the canonical text.)*

### A.5 First local wrangler smoke → real routing bug

10. `wrangler d1 migrations apply DB --local` → exit 0. `wrangler dev --port 8787`.
11. **Found a real production bug** by hitting the running worker: `use("*", sessionMiddleware)`
    in `routes/providerPrefs.ts` shadowed the public `/catalog` under the shared
    `/api/providers` prefix → anonymous `GET /api/providers/catalog` returned 401.
12. Fix: scope the session middleware to `/prefs*` and mount the catalog route before the prefs
    router. Encoded in the sync output and pinned by `test/routes.public.test.ts`.

### A.6 Worker spec suite (first complete round)

13. Wrote `test/vcm.parsing.test.ts` (19), `test/chat.route.test.ts` (9),
    `test/pure.units.test.ts` (31), `test/commander.paths.test.ts` (8), `test/auth.flow.test.ts`
    (18), `test/routes.public.test.ts` (8).
14. Added the `Unit tests (web)` step to CI so the web suite runs in the pipeline.

### A.7 Rule-T work log + Group 1 re-emission *(now STALE)*

15. Delivered the full work log in ONE markdown code block (owner output rule T).
16. Re-emitted **Group 1** (`index.ts`, `routes/catalog.ts`, `routes/providerPrefs.ts`,
    `middleware/session.ts`, `middleware/cors.ts`) as five `// FILE: … (REPLACE)` messages.
    ⚠️ **STALE** — the Canonical Snapshot Sync superseded all five; applying that Group 1 today
    would break canonical code. Do not reuse it.

### A.8 Canonical Snapshot Sync — 11 heredoc batches, all exit 0

17. Batch 1: `packages/shared` (all 6 files).
18. Batch 2: worker orchestrator + adapters (`runCommander`, `openaiCompat`, `ptmFailover`,
    `vcm`, `asyncQueue`, `errors`).
19. Batch 3: worker `db/`, `lib/`, `policy/`, `providers/`, `types/`.
20. Batch 4: worker `middleware/`, `routes/`, `index.ts`, chat route.
21. Batch 5: `migrations/0001_init.sql`, `wrangler.toml`.
22. Batch 6: web `lib/vault.ts`, `lib/sseClient.ts`, `components/ApplyCorrections.tsx`,
    `pages/Chat.tsx`.
23. Batch 7: `rm apps/web/src/chat/ChatPage.tsx`;
    `mv apps/web/src/providers/ProviderSettings.tsx → apps/web/src/components/`.
24. Batch 8: `test/utils/collectSSE.ts`, `test/utils/mockProvider.ts`, web test setup.
25. Batch 9: `rm test/ptm.midstream.test.ts` (superseded by `ptm.midstreamErrorCode.test.ts`).
26. Batch 10: `docs/LOCKED_BEHAVIORS.md` (57 lines, 18 numbered points).
27. Batch 11: remaining worker spec files to the sync baseline.

### A.9 Post-sync typecheck repair

28. Reinstalled `node_modules` (does not survive between sessions).
29. `tsc --noEmit` → 1 src error + ~40 test errors.
30. Python-patched the `res.json()` boundary in `adapters/vcm.ts` — `@cloudflare/workers-types`
    types `Response.json()` as `{}` (TS2339); cast at the boundary, never `any`.
31. Python-patched 4 test files (TS2571 — in vitest/DOM context `res.json()` is `unknown`).
    Typecheck clean.

### A.10 Post-sync test rewrites (tests had assumed the OLD APIs)

32. Rewrote `vcm.parsing` (19), `policy.gate` (3), `commander.paths` (8) to the canonical APIs.
33. Python-patched `pure.units` (31); regex-rewrote `mockOpenAIStream(["a"])` →
    `mockOpenAIStream([{delta:"a"}])` across 4 specs (`ChunkEvent.delta`, not `text`).
34. Patched `locks.andContracts`, `auth.flow`, and 3 remaining `res.json()` test sites.

### A.11 VCM token usage (finding #2 of the owner's three)

35. Added `usage_tokens?: number` to `VerifierResult` in `packages/shared/src/sse-events.ts`.
36. `adapters/vcm.ts` captures `usage.total_tokens` from the non-streaming completion and
    `runCommander.ts` populates `tokenUsage.vcm`.
37. Wrote `test/utils/mockCompletion.ts` (26 lines): `mockOpenAICompletion(content,
    {status?, totalTokens?})`.

### A.12 Patch round 2 → green

38. Python-patched `ephemeral.precedence` → 5/5.
39. Python-patched `auth.flow` ×2 sites → 18/18.
40. Python-patched `pure.units` (canonical blocked set + KNOWN-GAP set) → 31/31.

### A.13 Web test suites

41. Wrote `apps/web/test/vault.test.ts` (15). First run hung 30 s: `readRecord()` opened IndexedDB
    before any blob existed → the `vault` object store was missing → `onsuccess` threw → promise
    never settled. Fix: create the store in `onupgradeneeded`.
42. Wrote `apps/web/test/sseClient.test.ts` (8). Note: `onNetworkError` only fires when `fetch`
    **rejects** — a 401 response body is swallowed by the canonical client.
43. Result: web 2 files / 23 tests green.

### A.14 Local deploy smoke — 16 live requests

44. `wrangler d1 migrations apply DB --local` → exit 0 (8 migration commands).
45. `wrangler dev --port 8787`. (Wrangler also reports a second random port; only 8787 serves.)
46. Minted a real HMAC-SHA256 session cookie with Node using the gitignored
    `apps/worker/.dev.vars` (throwaway local secret).
47. Ran all 16 curls in §8; **both live anomalies turned out to be MY test errors**:
    (a) `PUT /prefs` → 500 because the cookie's `uid` had no `users` row (FK);
    (b) role-assign body must be the bare literal `null` to delete, not `{"provider_id":null}`;
    (c) `/prefs/cost` → 404 because **that endpoint does not exist** — `cost_weight` rides inside
    `PUT /prefs`.
48. Verified the role-delete actually removed the row by querying local D1.

### A.15 Hygiene + orphan-session finding

49. Wrote `.gitignore` (secrets `.dev.vars`/`*.env`/`.env.*` with `!.env.example`, `.wrangler/`,
    `node_modules/`, build + cache dirs). Verified `.dev.vars` matches line 4 of the file.
50. Wrote `test/orphanSession.gap.test.ts` (4): `sessionMiddleware` verifies HMAC + expiry but
    never calls `getUserById()`, so an orphan `uid` authenticates; the first **write** hits the FK
    → 500 `INTERNAL_ERROR`, not 401. Reproduced live in step 47(a).
51. Wrote the first version of `STATUS_V8.06.md`.
52. Ran the root gate twice: install → `-r typecheck` → `-r test`, all exit 0.

### A.16 Owner rulings (ask_user, 2026-09-24)

53. (1) **Implement** numeric `token_usage.ptm`. (2) **Keep** the canonical narrow policy
    baseline. (3) **Keep** the orphan-session 500 behaviour as a documented gap (§12.3).

### A.17 PTM usage implementation

54. Grepped the 3 `streamOpenAICompat` call sites (PTM, FCM, VCM path) to scope the change.
55. Python-patched `adapters/openaiCompat.ts` ×4 anchors: added `StreamUsage` + `StreamOpts`,
    the usage-frame handler, and the `stream_options: {include_usage: true}` body key.
56. Python-patched `adapters/ptmFailover.ts` ×3: `PtmRunArgs` gained `includeUsage?`/`onUsage?`,
    per-attempt usage buffering, surfaced only on the fully-successful return path; import
    `statusFromError` from `./errors`.
57. Python-patched `orchestrator/runCommander.ts`: PTM call passes `includeUsage: true` +
    `onUsage` → `tokenUsage.ptm`. FCM call site **untouched** (no 5th arg) → FCM body
    byte-identical.
58. `tsc --noEmit` → exit 0.
59. Patched `test/utils/mockProvider.ts`: `MockStreamOptions.totalTokens?` appends a trailing
    `choices: []` + `usage: {total_tokens}` frame before `[DONE]`.
60. Flipped the PTM assertion in `locks.andContracts` to `toBe(31)` (numeric, alongside
    `vcm === 77`).

### A.18 `ptm.usage` spec + the leak fix

61. Wrote `test/ptm.usage.test.ts` (7).
62. First run **6/7**: a provider-volunteered usage frame leaked to a caller that never opted in.
63. Fix: gate on `opts.includeUsage && opts.onUsage` (not merely callback presence) → **7/7**.
64. Root gate re-run → exit 0, **19 files / 158 tests**. CI guards PASS.
65. Python-patched `README.md` worker count 126 → 133 → 135 (kept in sync with the suite).

### A.19 Research + 400-degradation safety net

66. Web research: Groq is OpenAI-compatible and **does** support
    `stream_options: {include_usage: true}` (usage in the final chunk) — so both MVP providers
    accept the field. Counter-evidence: inspect_ai PR #337 reviewer note — "a non-conforming
    server could 400".
67. Python-patched `adapters/ptmFailover.ts` ×4: imported `statusFromError`; **hoisted
    `let includeUsage` outside the attempt loop** so the downgrade persists across retries;
    passed the mutable local to the adapter; added the 400-degradation branch (retry WITHOUT the
    field).
68. `tsc --noEmit` → exit 0.
69. Removed a dead `usageUnsupported` flag I had introduced but never read.

### A.20 Degradation tests

70. Appended 2 tests to `ptm.usage.test.ts` (now 9).
71. First run **8/9**: I had asserted the retry's usage as `[12]`; the pinned contract is `[]` —
    usage is buffered per attempt and only the fully-successful attempt's usage surfaces.
    **Fixed the test, not the code** → 9/9.
72. Full worker suite → **17 files / 135 tests**.
73. Python-patched `STATUS_V8.06.md` (135/158, `ptm.usage` 9, new 400-degradation section).

### A.21 Re-verification after the PTM change

74. Migration `--local` → exit 0.
75. Re-ran the full 16-request live smoke — identical results to §8.
76. Stopped the worker; confirmed `emitter.ts:154` itself attaches `cost_disclaimer` (callers must
    not pass it).

### A.22 Delta re-emission (complete — 5/5 delivered)

77. Grepped all 5 delta files for secrets/real IDs/origins → none (catalog `baseUrl` values live
    only in `providers/catalog.ts`, which is NOT a delta file; the 5 deltas are redaction-free).
78. Delivered `packages/shared/src/sse-events.ts` (100 lines) — **1 of 5**.
79. Delivered `apps/worker/src/adapters/openaiCompat.ts` (145 lines) — **2 of 5**.
80. Delivered `apps/worker/src/adapters/ptmFailover.ts` (97 lines) — **3 of 5**; then
    `apps/worker/src/adapters/vcm.ts` (150) — **4 of 5**; then
    `apps/worker/src/orchestrator/runCommander.ts` (244) — **5 of 5**. One code block per
    message, dependency order. **Re-emission complete.**

### A.23 Self-contained rewrite of this document

81. `find` inventory → 65 `.ts`/`.tsx` files, 6,004 LOC (full list in §3).
82. Grepped `constants.ts` exports verbatim; `BLOCK_PATTERNS` = 4 regexes read verbatim;
    `ERROR_CODES` = 19 entries.
83. `vitest --reporter=json` for both packages → per-file counts (worker 17/135, web 2/23);
    note `numTotalTestSuites` counts describe blocks (57/10), NOT files — trust the human
    reporter's `Test Files` line.
84. Grepped migration (4 tables + 3 indexes), `wrangler.toml` bindings + dev/prod vars, all
    package scripts, the 8 CI steps, `LOCKED_BEHAVIORS.md` (57 lines, 18 numbered points).
85. **Full rewrite** of this file into 14 cross-referenced sections.
86. **Post-write self-audit caught my own error:** §8 claimed "17 live requests" but its table
    holds 16 data rows. Patched 17 → 16 in all 3 mentions (2 applied on the first pass; the
    line-wrapped mention needed an exact two-line anchor). Re-grepped every remaining `17` —
    each legitimate (17 worker spec files, 135, bug #17, wrangler 3.114.17, describe-block
    counts). **Lesson: verify counts inside generated docs against the tables they describe.**

### A.24 Current turn (this appendix)

87. Re-ran the full root gate: `install --frozen-lockfile` exit 0, `-r typecheck` exit 0,
    `-r test` exit 0 — 19 files / 158 tests.
88. Re-measured the granular facts for this appendix: delta-file LOC (100/145/97/150/244 =
    736), test-util LOC (`canaryLogger` 11, `collectSSE` 25, `mockCompletion` 26,
    `mockProvider` 59, web `setup` 24 = 145), `.gitignore` rules, `.dev.vars` present +
    gitignored (line 4).
89. Appended this Appendix A.

---

### A.25 Group 2 re-emission (complete) + Group 3 early

90. Owner confirmed the Group 1 capture and accepted the path reconciliation: web tests live in
    `apps/web/test/`; `sseClient.test.ts` exists *because* of the terminated-flag fix (BUG 4),
    while `vault.test.ts` is separate crypto/IDB coverage.
91. Delivered Group 2 file 1 of 6: `apps/web/src/lib/sseClient.ts` (69 lines).
92. Redaction scan across all seven handoff files: the only origin literals are the local dev
    proxy target (`127.0.0.1:8787`) and the RFC-2606 example placeholders in `wrangler.toml` —
    no secret, real id, or real domain is present, so no redaction was required.
93. Delivered Group 2 files 2–6 plus early Group 3 in a single code block (the paste rule
    constrains the number of *blocks* per message, not the number of files): `sseClient.test.ts`
    (223 lines), `vault.ts` (149), `vault.test.ts` (213), `setup.ts` (24), `vitest.config.ts`
    (15), `vite.config.ts` (21), `wrangler.toml` (49).
94. Re-ran the root gate after the doc sync → install exit 0, typecheck exit 0, 19 files /
    158 tests.
95. Found `apps/web/.git` — a stray empty repo (branch `master`, zero commits) left over from the
    file-creation flow. Harmless; **deleted in step 98**.
96. Owner echoed the Group 2/3 block back intact (8/8 `// FILE:` markers, no truncation).
    Final audit: Appendix B's line counts match disk exactly (69/223/149/213/24/15/21/49 = 763)
    and the gate re-ran clean → install exit 0, typecheck exit 0, 19 files / 158 tests.
97. Cross-checked an external agent's "FULL INTEGRITY SCAN" against disk. Verdict holds; two
    corrections to that report: (a) it listed `ptm.midstream.test` as evidence for the PTM
    midstream lock — that file no longer exists (deleted in the sync; superseded by
    `ptm.midstreamErrorCode.test.ts`), so the report has the two inverted; (b) its "shared: PASS"
    refers to typecheck only — `packages/shared` has **no test suite** (`scripts: {typecheck}`),
    so the 19 files / 158 tests are worker (17/135) + web (2/23). Also confirmed benign: the only
    "136 tests" left in this document is explicitly marked a VOID pre-sync baseline, and
    `wrangler.toml` on disk has NO `// FILE:` marker (line 1 = `name`), as warned in §14.
98. Deleted the stray `apps/web/.git` (verified zero commits before removal; nothing historical was
    at risk). Re-ran the gate afterwards → install exit 0, typecheck exit 0, 19 files / 158 tests.
99. Owner's multi-line audit command was flattened by a chat UI (newlines collapsed, so `wc -l`
    swallowed the following `echo`s and printed nothing useful). Root cause is paste transport, not
    the repo. Added **`verify.sh`** — a single-file, newline-safe verifier so nobody ever has to
    paste multi-line shell again: `cd /home/user/project-alpha && bash verify.sh`.
100. First `verify.sh` run FAILED 3 checks — my own script bug: the `for entry in $EXPECTED` loop
    split on whitespace only, so `69 path` pairs never parsed (`apps/web/69: No such file`). Fixed
    by switching to a `while read -r want rel` loop over a quoted heredoc. Second run:
    **ALL CHECKS PASS** (9 line-count checks incl. the 763 total, Appendix A contiguity at 98 steps,
    zero unlabelled legacy test counts, hygiene, and the full gate) — exit 0.
    Script check #2 deliberately reproduces the owner's regex *scoped to Appendix A*: the unscoped
    `^(\d+).\s` form also matches numbered lines elsewhere in the doc, which is what produced the
    phantom gaps `(1,1),(2,1),(20,1),(4,1),(3,1)` in the pasted run. Scope the regex, or use `verify.sh`.
101. `verify.sh` caught a real drift on its very next run: step 100's own prose contained a bare
    legacy count, which check #2 flagged (the checker was right — a future agent could read that
    number as current). Fixed by rewording the prose, then **tightening the checker** rather than
    loosening it: a legacy mention is now allowed only when its own line says `VOID`. Final run:
    **ALL CHECKS PASS**, exit 0. Nil issues for the verifier: 0 open.
102. Audited an external deployment runbook against the shipped repo before it could be executed.
    Six corrections found and applied (§15): (C1) it created `SESSION_KV` while `wrangler.toml`
    binds `OAUTH_KV` in all three scopes; (C2) its live-smoke sequence `meta → chunk → done` omits
    the two `phase` events and `verifier_json`; (C3) it described `token_usage.vcm` as possibly
    `null` — the contract is a `Record<string, number>` in which the key is *absent* when VCM
    degrades (`vcm: null` is the DoneEvent's VerifierResult field, a different thing); (C4) it said
    "8 migration statements" — **WITHDRAWN in step 106: the runbook was right, my correction was
    wrong**; (C5) its D1 evidence claimed
    the on-disk toml starts with a `# Project Alpha Worker...` comment — line 1 is actually
    `name = "project-alpha-worker"` (right conclusion, invented evidence); (C6) its stats were stale
    (101 steps / 994 lines at the time, not 96 / ~942). CLI flags re-verified with `--help`:
    `kv namespace create <namespace>` takes a positional name, `-e/--env` is global and accepted by
    `d1 migrations apply` and `secret put`. Confirmed correct: `d1 create`, the `d1 execute` SELECT
    against the real `users` schema, and the cookie attribute set.
103. Added §15 (the verified runbook) to this document; re-ran `verify.sh` → ALL CHECKS PASS.
104. Audited revised runbook v2. Found one consequential error (C7: `chunk.source` is `"ptm"`, not
    `"primary_answer"` — a false-failure trap on a passing system) plus three refinements, all folded
    into §15.1: the `APP_URL` vs `APP_ORIGIN` host distinction, the `isSSEEvent` nuance (permissive
    for non-error frames, strict for `error` frames via `KNOWN_ERROR_CODES`), and the v2 runbook's
    stale housekeeping item (`apps/web/.git` was already deleted in step 98). Verified PRAGMA
    `table_info` against the real schema by running it locally.
105. Audited the third-party "FINAL EXECUTION REPORT". Fetched the two live URLs directly: both are
    real HTTP 200 — so something IS deployed at that host — but the served build contradicts this
    repo on ten independent axes (root ping string absent from src, 2-vs-6 providers, missing
    `implemented` field and `gpt-4-turbo`, 14-vs-19 error codes, 7-vs-30 day cookie, three different
    index names, `provider_prefs` column set, `audit_events` column set, ISO-vs-INTEGER `created_at`,
    and its step numbering). Recorded as §16 with the full evidence table. Separately: the report's
    §2 pasted live 64-hex `SESSION_SECRET` values into chat — treated as an incident, rotation
    procedure written into §16.1 (values deliberately NOT copied into this document).

106. **Self-correction — C4 withdrawn.** Ran `wrangler d1 migrations apply DB --local --persist-to
    <fresh dir>` against a brand-new local DB to settle "7 vs 8": Wrangler printed
    **`8 commands executed successfully`**, while the file holds **7** DDL statements. Both are right
    — different measures (the extra command is migration bookkeeping; the resulting DB also contains
    a `d1_migrations` table). So the original runbook's "8" was correct and my §15 / step-102
    correction was wrong. Fixed in three places (§15 intro, §15 facts bullet, step 102) so nobody
    "corrects" the correct number back again. Also recorded: the other agent's converged report now
    reproduces this document's §16 L1–L10 axis table verbatim — both agents are reading the same
    source of truth, which is the outcome §16 was written for.

107. Audited the 2nd agent's session log (ERR-01 … ERR-09, Windows/`D:\Project Alpha All Doc`).
    **7 of the 9 errors came from running a MIXED build**, not from canonical code: their own
    monolithic worker served a catalog without `selectable` and with `models` as `[{id,name}]`
    objects, while the canonical web client filters `p.implemented && p.selectable` and renders
    `models` as strings. Verified canonical's actual payload by booting `wrangler dev --env dev`
    and curling it — `models` IS `string[]`, `selectable` IS present, 6 providers. So ERR-03
    ("No selectable providers") and ERR-08 ("Objects are not valid as a React child") are
    cross-build mismatches; canonical `ProviderSettings.tsx` has no object-as-child bug
    (it maps `p.models` → `<option>{m}</option>` where `m` is a string). ERR-04/ERR-05
    (`src/index.ts:378:172` syntax error; wrangler rejecting extra `export const`) were in their
    own 378-line monolithic entry — canonical `src/index.ts` is 30 lines with exactly one
    `export default app;`.
108. Found and fixed **two real canonical gaps** the report exposed:
    (a) `apps/worker` `migrate:dev` was `d1 execute --file` — **not idempotent**: on a second run
        it aborts with `table users already exists at offset 13: SQLITE_ERROR`. Measured by
        running it twice against a fresh `--persist-to` dir. Replaced with
        `wrangler d1 migrations apply DB --local --env dev`, re-measured: first run
        `8 commands executed successfully`, second run `No migrations to apply!` — idempotent.
    (b) `[env.dev]` had no `preview_database_id` / `preview_id`, which is exactly why the 2nd
        agent hit *"In development, you should use a separate kv namespace than the one you use in
        production"* when running `wrangler dev --remote`. Added both keys (placeholders) with a
        comment; confirmed local dev still boots afterwards (`wrangler 3.114.17` prints
        `DB: project-alpha-db-dev …, Preview: (…)` and serves normally).
109. Added `apps/worker/test/catalog.shape.test.ts` (**5 tests**) because no test guarded the one
    payload consumed by a *different package* with no shared type — the exact hole that let the
    other agent's build break the UI twice. It pins: exactly 4 public keys per provider
    (`id, models, implemented, selectable`), **`models` must be `string[]`**, the selectable set is
    exactly `{openai, groq}` with ≥1 model each, the other four stay `implemented:false,
    selectable:false` with `models: []`, and no `baseUrl`/upstream host leaks in the raw response.
    Suite is now **20 files / 163 tests** (worker 18/140, web 2/23); `tsc --noEmit` exit 0.

110. `verify.sh` immediately caught the consequence of step 108: adding the preview keys moved
    `wrangler.toml` from 49 to 56 lines, so its Appendix-B invariant FAILED on the next run
    (`wrangler.toml expected 49, got 56`). Updated the invariant to **56** and the handoff total to
    **770** (69/223/149/213/24/15/21/56) in `verify.sh` and Appendix B — the check doing its job on
    its author, again.
111. Re-ran everything after the fixes: typecheck exit 0; suite **20 files / 163 tests**
    (worker 18/140, web 2/23); local dev boot re-confirmed with the new toml
    (`Ready on http://localhost:8787`), and the live contract captured for the handoff —
    catalog 200 (6 providers, `models` as strings, `selectable` present), prefs 401
    `UNAUTHENTICATED`, chat 401 without cookie, unknown path 404, preflight 204 echoing only
    `http://127.0.0.1:5173` with `Allow-Headers: Content-Type,X-EPHEMERAL-KEYS`.

112. **Auth-route discovery (corrects my own §15 checklist and a pasted runbook).** Read
    `routes/auth.ts` on disk: the canonical flow is `POST /api/auth/google/start` →
    `200 {"url": "https://accounts.google.com/…"}`, then `GET /api/auth/google/callback`
    (sets `alpha_session`, redirects to `APP_ORIGIN`), then `POST /api/auth/logout`.
    There is **no** `GET /api/auth/google/login`, and `/google/start` does **not** 302 — a pasted
    runbook asserted both ("one of these should 302"), and that shape belongs to the other build.
    Against canonical a GET on either path is a 404, so a browser check written that way would
    report "OAuth broken" on a healthy system. The route returns JSON precisely because state +
    PKCE verifier must be written to KV before the browser leaves the origin.
113. **Real gap found and fixed: the canonical web client had no sign-in affordance at all.**
    `apps/web/src` contained zero references to the auth routes, so a browser user could never
    complete step 10's E2E flow — `ProviderSettings` would always render "Could not load provider
    settings (are you signed in?)". Added `apps/web/src/lib/authClient.ts`
    (`startGoogleLogin()` → POSTs, reads `{url}`, returns a typed result; `logout()`), wired
    "Sign in with Google" / "Sign out" buttons into `App.tsx`'s unlocked header, and pinned it with
    `apps/web/test/authClient.test.ts` (**7 tests**: endpoint+method+credentials, URL extraction,
    non-200, missing-url, unreachable, logout ok/reject). Suite is now **21 files / 170 tests**
    (worker 18/140, web 3/30); typecheck exit 0.

114. **Root cause of ERR-07 found, measured, and fixed.** Booted the canonical worker with a
    `.dev.vars` holding `SESSION_SECRET` only and probed the auth routes live:
    `POST /api/auth/google/start` returned **HTTP 200** — with
    `client_id=undefined` inside the Google URL. That silent success is precisely how the operator
    ends up staring at Google's *"Access blocked: Missing required parameter: client_id"* and
    hunting in the Google Console instead of their own bindings. Also confirmed the route names in
    the same probe: `GET /api/auth/google/login` → **404**, `GET /api/auth/google/start` → **404**
    (canonical start is POST-only), so any checklist built on "one of these should 302" false-fails
    a healthy worker.
115. **Fix shipped:** `lib/googleOAuth.ts` gained `GoogleOAuthConfigError` +
    `assertGoogleOAuthConfigured(env, keys)`, treating `""`, whitespace, `"undefined"` and `"null"`
    as not-configured. `buildGoogleAuthUrl` requires `GOOGLE_OAUTH_CLIENT_ID` + `APP_URL`;
    `exchangeGoogleCode` additionally requires `GOOGLE_OAUTH_CLIENT_SECRET` (it is only needed at
    the callback, so a missing secret does not block `/start`). `routes/auth.ts` catches it and
    returns `500 {"error_code":"INTERNAL_ERROR","message":"Google OAuth is not configured:
    GOOGLE_OAUTH_CLIENT_ID missing or blank"}` — no Google link in the body, no secret leaked.
    Re-probed live: same request now **500** with that message. Pinned by
    `test/authConfig.guard.test.ts` (**9 tests**: happy path params, KV state + 300s TTL, five
    not-configured variants, APP_URL absent, secret-only-missing still allowed). Suite is now
    **22 files / 179 tests** (worker 19/149, web 3/30); `tsc --noEmit` exit 0.

116. Audited the 2nd agent's "FINAL FIX EVERYTHING PACKAGE" — it replaces the canonical worker with
    a one-file `src/index.ts` that **inverts the verified contract**, and it does not work against
    the canonical schema. Ran its three SQL statements against a migrated local D1 to be sure:
      * `INSERT INTO audit_events (…, status, phase, latency_ms, created_at)` ->
        **`NOT NULL constraint failed: audit_events.request_id`**
      * `INSERT INTO provider_prefs (…, created_at, …)` ->
        **`table provider_prefs has no column named created_at`**
      * `INSERT INTO role_assignments (…, created_at, …)` ->
        **`table role_assignments has no column named created_at`**
    Its SSE frames also carry `event: <name>` + a payload with **no `type`** and an **ISO-string
    timestamp**, so the canonical `isSSEEvent` guard (which requires `type` + numeric `timestamp`)
    rejects every frame — the UI would render nothing. It also invents 3 error codes
    (`PTM_ALL_ATTEMPTS_FAILED`, `PTM_UPSTREAM_UNAVAILABLE`, `VCM_AUTH_INVALID`) and drops 3 real
    ones, returns `models` as `{id,name}` objects (canonical: strings) and adds a `name` field to
    the public catalog (canonical exposes exactly 4 keys). Correction to an earlier draft of this
    step: its sanitizer DOES drop `default_base_url`, so there is no base-URL leak — the breakage is
    the object-shaped `models` plus the extra key, both of which fail `catalog.shape.test.ts`. **fabricates a VCM verdict**
    (`{verified:true, confidence:95}` — R3 says VCM always runs; the server must never invent a
    verdict) and **fabricates `token_usage.vcm = 28`** (locked: usage is only ever what upstream
    reported, never a guess), and it reverts `wrangler.toml` to the pre-fix state without the
    preview ids. Verdict recorded: **do not apply it**; it is a different product that happens to
    share the name.
117. Hardened the OAuth guard against the exact artifact that package ships: `.dev.vars` containing
    the literal string `<REDACTED>`. `isConfigured` now also rejects angle-bracket placeholders,
    `YOUR_*` and `PASTE_*` prefixes, plus `none`/`todo`/`changeme`. Pinned with 3 more tests in
    `authConfig.guard.test.ts` (now 12). Suite at that step was **22 files / 182 tests** (worker
    19/152, web 3/30); `tsc --noEmit` exit 0.

118. **D1 — the Keys UI gap closed in the canonical shell.** `App.tsx` gained a memory-only
    `passphraseMem` ref (captured at unlock/create, wiped on lock), a `Keys` tab, and a two-step
    "a vault already exists — Unlock instead" confirm on Create (gated by `hasVault()`). No
    existing UI (sign-in/out, lock, tabs, chat, provider settings) was removed.
119. **D2 — `apps/web/src/components/KeysPanel.tsx` (new, 101 lines).** It fetches the public
    catalog over HTTP (it cannot import the worker's catalog module) and lists only
    `selectable === true` providers — openai, groq. Write-only password input,
    `autocomplete="off"`, key bytes never rendered; Save/Remove call `vault.setKey/removeKey`,
    then `persist(passphraseRef.current)` only when a passphrase is in memory (otherwise the
    status says "kept for this session only"). Readiness is shown as
    `buildEphemeralHeader() !== null` — never as key material.
120. **D5-B — `apps/web/test/keysPanel.test.tsx` (new, 178 lines, 6 tests, zero new deps).**
    `react-dom/client` + React 18.3's top-level `act` under the existing jsdom setup; the real
    `Vault` against fake-indexeddb. Tests type via the native value setter, then pump act-wrapped
    macrotask ticks (`clickAndWait`) because Save awaits a real 600k-iteration `deriveKey` —
    polling *inside* `act` deadlocks (found by measurement, see §10).
121. **D7 — `GET /` health probe + `0002_audit_index.sql`.** Public, metadata-only
    `{ok, service, version}` pinned by `rootHealth.test.ts` (3 tests, incl. "does not shadow the
    404 handler"); the migration adds `idx_audit_events_created` for newest-first audit reads.
122. **D6 — CI now builds and dry-runs.** `pnpm --filter @project-alpha/web build` and
    `pnpm exec wrangler deploy --dry-run --env production` (token-free — proven on 3.114.17);
    the audit-schema guard now greps all of `apps/worker/migrations/`, not only `0001_init.sql`.
123. **D8 — `hasVault()` (vault.ts 149 → 157) + 3 tests (vault.test.ts 213 → 240).** Read-only
    probe `(await idbGet("blob")) != null`: no `indexedDB.databases()`, no `deleteDatabase`, and
    `createNew()`'s pinned "does NOT persist on its own" contract is untouched.
124. **`verify.sh` is Python-free** (Group 2 rewritten in awk/bash) so the gate runs in Windows
    Git Bash with nothing but bash + awk + sed + grep; it now pins **807** total lines
    (`vault.ts` 157, `vault.test.ts` 240) and the **24 files / 194 tests** gate.
125. **Post-change gate, re-run in full:** `typecheck` exit 0; `test` exit 0 — **24 files / 194
    tests** (worker 20/155, web 4/39); `pnpm --filter @project-alpha/web build` ✓ (216.86 kB /
    64.93 kB gzip); worker `deploy --dry-run --env production` exit 0; `bash verify.sh` →
    **ALL CHECKS PASS** (125 steps, 805 total lines, 0 stray counts).

126. **Zip-extraction bug found by testing the deliverable, not the repo.** Extracting
    `project-alpha-canonical.zip` to a clean directory and running `verify.sh` failed one check:
    hygiene demanded `apps/worker/.dev.vars` exist, but that file is deliberately **never** shipped
    (gitignored secret file). Fixed: the check now asserts the invariant that matters — the path is
    listed in `.gitignore` — and reports whether the file is present or absent, so a fresh
    extraction reaches **ALL CHECKS PASS**. Re-verified end-to-end from the rebuilt 93-file zip:
    install ✓, typecheck ✓, **24 files / 194 tests** ✓, `ALL CHECKS PASS`.

127. **Transient-failure investigation → timeout hardening (no semantics changed).** Two isolated
    phantom failures were observed across ~20 full runs, both while several suites executed
    back-to-back on a loaded machine; neither reproduced (13 subsequent runs green). Investigation
    ruled out the obvious races: every test runs in 3–544 ms (default limit 5000 ms), and
    `raceWithDeadline` clears its timer in `finally` (no stray `abort()` after settle). The only
    remaining explanation is environment starvation, so both vitest configs now set
    `testTimeout: 20_000` — a value that cannot change any passing test's behaviour, only whether
    a starved run is misreported as a defect. Pins updated: `vitest.config.ts` 15 → 17 lines,
    Group-1 total 805 → **807**.

128. **GO-1 launch path — the worker serves the SPA itself (`[assets]`), so SPA and API share one origin.**
    Why: the web app fetches relative `/api/...` with `credentials:"include"` and the session cookie is
    `SameSite=Lax`; a Pages origin plus a workers.dev API origin is cross-site, so every authenticated
    call would 401. Fix: keep one origin and let the Worker serve `apps/web/dist`.
    Change: `apps/worker/wrangler.toml` 56 → 60 lines — a top-level `[assets]` block pointing at
    `../web/dist`, plus the production `APP_ORIGIN` example made same-origin. No route, schema, or test
    changes: the suite stays 24 files / 194 tests.
    Evidence (wrangler 3.114.17, real built SPA): `GET /` → 200 `text/html` (index.html), `GET
    /api/providers/catalog` → 200 JSON (worker routes untouched), `GET /api/health` → 404 JSON (the asset
    layer never swallows `/api/*`).
    Ops: `apps/web/dist` MUST exist before any `wrangler dev`/`deploy` (a missing `assets.directory` is a
    hard wrangler error) — build it with `pnpm --filter @project-alpha/web build`; the production liveness
    probe is `GET /api/providers/catalog`; CI already builds the web bundle before the worker dry-run.
    Re-lock: `verify.sh` Group-1 pins 56 → 60 and 807 → **811** (header + constants). Owner-side local edits
    stay three (6 ids, 3 `.dev.vars` values, prod `APP_URL`/`APP_ORIGIN`), plus the web build before local runs.


129. **BYOE Lite — owner-managed private endpoints (V8.08).**
    Catalog 6 → 8 providers (+private-llama, +private-smollm), selectable 2 → 4.
    Why: operator wants private gateway (OpenAI-compatible /v1) without opening true BYOE (user-supplied URL + SSRF).
    Change: `apps/worker/src/providers/catalog.ts` 46 → ~74 lines (2 new entries, baseUrl = https://<REAL-GATEWAY>/v1, models EXACT).
    Tests: `catalog.shape.test.ts` 6→8, selectable array 2→4, +2 defensive asserts (no https://, no baseUrl leak); `routes.public.test.ts` selectable 2→4.
    No new files (BYOE Lite stage); true BYOE v1.1+ would add `ssrfGuard.ts`, `BYOEEndpointInput.tsx`.
    Ops: Keys tab auto-renders 4 rows; user must save key per referenced provider or chat 400s; model id mismatch → 400 MODEL_NOT_RECOGNIZED.
    Rollback: `wrangler rollback` → catalog back to 6, or `git revert`.
    Re-lock: R7 updated (selectable now includes owner-managed private), docs updated, pins unchanged (catalog.ts unpinned, 811 stays).


**Appendix B — Quick reference: the 5 delta files (this session's code changes on top of canonical)**

| # | File | Lines | What changed vs the sync paste |
|---|------|------:|--------------------------------|
| 1 | `packages/shared/src/sse-events.ts` | 100 | `usage_tokens?` on `VerifierResult` |
| 2 | `apps/worker/src/adapters/openaiCompat.ts` | 145 | `StreamUsage`/`StreamOpts`; `includeUsage` gates **both** the `stream_options` body key and the `onUsage` callback; usage frames (`choices: []`) never yielded; `onUsage` throws swallowed |
| 3 | `apps/worker/src/adapters/ptmFailover.ts` | 97 | `PtmRunArgs` +`includeUsage?`/`onUsage?`; `let includeUsage` hoisted outside the attempt loop; per-attempt usage buffer surfaced only on success; 400-degradation retry without the field |
| 4 | `apps/worker/src/adapters/vcm.ts` | 150 | captures `usage.total_tokens` from the non-streaming completion → `VerifierResult.usage_tokens` |
| 5 | `apps/worker/src/orchestrator/runCommander.ts` | 244 | PTM call opts in → `tokenUsage.ptm`; FCM call site untouched (byte-identical body) |

Pinned by `test/ptm.usage.test.ts` (9) + `locks.andContracts` (`ptm === 31`, `vcm === 77`) and
the 16-request live smoke (§8).

---

**Group 2/3 handoff set (web + config, delivered A.25)**

| # | File | Lines | Note |
|---|------|------:|------|
| 1 | `apps/web/src/lib/sseClient.ts` | 69 | `terminated` flag suppresses post-terminal frames (BUG 4); `credentials: "include"`, never `Authorization` |
| 2 | `apps/web/test/sseClient.test.ts` | 223 | 8 tests: request shape, dispatch order, terminal vs recoverable error, network failure, abort |
| 3 | `apps/web/src/lib/vault.ts` | 157 | PBKDF2 from the shared constant; `createNew` sync; `unlock()` true when no blob; raw `indexedDB`; **`hasVault()` read-only probe (step 123)** |
| 4 | `apps/web/test/vault.test.ts` | 240 | 18 tests: lock state machine, round trip, blob carries no plaintext, 6KB threshold, **hasVault existence probe (step 123)** |
| 5 | `apps/web/test/setup.ts` | 24 | jsdom + WebCrypto bridge + a fresh `IDBFactory` per test |
| 6 | `apps/web/vitest.config.ts` | 15 | jsdom env, shared-source alias, `test/**` include |
| 7 | `apps/web/vite.config.ts` | 21 | react plugin; `/api` dev proxy to the local worker (relative calls in prod) |
| 8 | `apps/worker/wrangler.toml` | 56 | `<REDACTED>` D1/KV ids; dev + production envs; **`preview_database_id` + `preview_id` added in step 108**; secrets only via `wrangler secret put` |

---

**Appendix B2 — V8.07 delta (D1–D8, steps 118–125)**

| # | File | Lines | What changed |
|---|------|------:|--------------|
| 1 | `apps/web/src/components/KeysPanel.tsx` | NEW 101 | catalog-fetch (`selectable` only), write-only key entry, persist via `passphraseRef` |
| 2 | `apps/web/test/keysPanel.test.tsx` | NEW 178 | 6 tests — act + `createRoot`, no new dependencies |
| 3 | `apps/worker/test/rootHealth.test.ts` | NEW 42 | 3 tests pinning the `GET /` probe |
| 4 | `apps/worker/migrations/0002_audit_index.sql` | NEW 4 | `idx_audit_events_created` |
| 5 | `apps/web/src/App.tsx` | 126 | + `passphraseMem`, Keys tab, two-step create confirm |
| 6 | `apps/web/src/lib/vault.ts` | 157 | + `hasVault()` |
| 7 | `apps/worker/src/index.ts` | 34 | + public `GET /` health probe |
| 8 | `.github/workflows/ci.yml` | 74 | + web production build, + worker `deploy --dry-run`, audit guard over all migrations |
| 9 | `verify.sh` | 81 | Python-free Group 2; pins 805 / 24 files / 194 tests; `.dev.vars` check fixed for fresh extractions (step 126) |
| 10 | `README.md` · `TRANSFER_NOTE.md` | 75 · 197 | runbook notes folded in (no new files, so no zip-count drift) |

Zip: **93 files** (89 + the 4 new files above).

