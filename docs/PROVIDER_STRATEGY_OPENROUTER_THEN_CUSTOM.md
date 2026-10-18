# PROVIDER STRATEGY — OpenRouter-first → Custom Model fallback (V8.08+)

> **Goal:** Today run on OpenRouter (user key in vault, ephemeral per-request), but if OpenRouter model/quality/availability fails, switch to Custom Model (private provider) in <10 min with ZERO secret paste, ZERO server-side key persistence.

## 1) Assumptions + Required Inputs

### Assumptions
- Default runtime: **OpenRouter** provider (OpenAI-compatible, baseUrl `https://openrouter.ai/api/v1`)
- Fallback runtime: Custom = OpenAI-compatible endpoint (`/v1/chat/completions`) e.g. vLLM / llama.cpp / OpenWebUI proxy
- router_mode = "manual" locked (MVP), cookie-only session, SSE locks unchanged

### REQUIRED INPUTS to activate Custom Model
1. Custom base URL (non-secret): e.g. `https://llm.your-domain.com/v1`
2. Auth method (choose one):
   - (A) OpenAI-style bearer key (user-provided, from vault)
   - (B) No-auth (LAN/Tailscale only)
   - (C) Cloudflare Access/JWT (advanced, defer if tonight not needed)
3. Model IDs exact (no colon, max 128): e.g. `llama-3.2-70b`, `gemma-2-27b`, `smollm2-1.7b`
4. Switch trigger: model not found / 404, latency > X sec, 429 / quota, quality gate fail

## 2) Current State (measured 2026-10-06)

- Catalog now: 8 providers (openai, groq, private-llama, private-smollm + 4 disabled)
- **OpenRouter NOT present** in `apps/worker/src/providers/catalog.ts` — needs addition
- Public catalog route `apps/worker/src/routes/catalog.ts` correctly strips `baseUrl` → leak 0 (pinned by `catalog.shape.test.ts` 5 tests + `routes.public.test.ts` 8 tests)
- Adapter `apps/worker/src/adapters/openaiCompat.ts` resolves `baseUrl` exclusively from `PROVIDER_CATALOG` (LOCKED B3) via `getCatalogProvider(providerId)` — supports per-provider baseUrl + per-request ephemeral key
- Web `Chat.tsx` defaults: ptm openai gpt-4o-mini, vcm groq llama-3.3-70b-versatile, fcm null — with BYOE Lite comment for private-llama/private-smollm
- Keys UI: `KeysPanel.tsx` fetches public catalog, filters `selectable`, write-only input, persist via passphrase ref — no plaintext render
- Tests: 21/158 worker + 4/39 web = 25/197, verify.sh ALL PASS 60/811/129, build 216.86kB, dry-run 248.08KiB

## 3) Full Map — End-to-End

### Phase A — OpenRouter works baseline (tonight)
A1) Confirm OpenRouter provider present + selectable
- Add to catalog if missing (see Phase B1 patch)
- Verify: UI provider dropdown shows OpenRouter, chat stream works, public catalog no baseUrl leak

A2) Known-good OpenRouter model set (operator picks 2-3)
- Primary: fast + cheap (e.g. `openai/gpt-4o-mini` or `meta-llama/llama-3.2-3b-instruct:free`)
- Backup: stronger reasoning (e.g. `anthropic/claude-3.5-sonnet`)
- Emergency: very small (e.g. `google/gemma-2-9b-it:free`)

A3) Operator switch checklist (no code)
1. UI → Provider → OpenRouter
2. Model → backup model
3. Retry chat, confirm SSE: meta → phase(ptm) → chunk* → phase(vcm) → verifier_json → done
Outcome: OpenRouter outage handled without code change

### Phase B — Custom Model fallback (pre-approved patch, apply only if OpenRouter fails)
B1) Add private providers to worker catalog (server-side registry)
- IDs: `private-llama`, `private-smollm` already exist (step 129) — reuse for custom endpoint
- For OpenRouter, add `openrouter` with baseUrl `https://openrouter.ai/api/v1`, models = exact OpenRouter model IDs you use
- Each: implemented true, selectable true (or false for staged rollout), models string[] exact
- internal baseUrl never returned by public catalog (pinned)

B2) Web defaults (optional)
- Keep OpenRouter as default, but document fallback entries so operator 1-click switches to private-llama

B3) Adapter supports per-provider baseUrl + per-request key (already does)
- provider_id → baseUrl pick via catalog
- key precedence: header valid → use, header invalid → reject (never fallback to body), header absent + body valid → use body, both absent → MISSING_CREDENTIALS
- No persistence, no echo in errors/logs, SSE unchanged

B4) Tests + A→Z scan gates
- Update `catalog.shape.test.ts` selectable list to include openrouter + private-llama + private-smollm
- Update `routes.public.test.ts` selectable check
- Run: install --frozen-lockfile, typecheck, test, verify.sh

### Phase C — Runtime ops: when to flip
Triggers: OpenRouter 404 model not found, 429 rate limit, latency > X sec median over N, quality gate fail
Action: UI provider switch → custom provider → retry
Proof: wrangler tail shows provider_id/model_id (no keys), SSE completes

## 4) Locked Behavior / Security Checkpoints

- NO server-side key persistence (D1/KV/DO/R2/logs/analytics/audit) — keys memory-only per request
- Cookie-only session, credentials:"include", no Authorization bearer for session
- SSE locks unchanged: policy block meta→error(policy, recoverable=false, provider_id=null)→close no done; PTM retry only before first chunk else PTM_TERMINAL_MIDSTREAM no done; VCM degrade error(recoverable=true, verification)→done(unverified, vcm:null)
- Naming: provider_id regex ^[a-z0-9][a-z0-9._-]*$ max 64 no colon; model_id max 128 no colon
- Public catalog must NOT leak baseUrl (2 defensive asserts)

## 5) Agent-1 Command Pack — Evidence Gathered

Inventory: 9 docs (.md/.txt/.sh/.yml/.toml) — see `_agent1_inventory.txt`
Provider refs: 60+ matches across worker/web — see `_agent1_provider_refs.txt`

Current catalog check:
- openrouter: NOT FOUND (needs add)
- private-llama / private-smollm: FOUND with placeholder <REAL-GATEWAY>

Public catalog route: strips baseUrl (publicSafe = id, models, implemented, selectable)

Adapter: resolveProviderConfig uses getCatalogProvider → baseUrl from catalog only, fetch(`${baseUrl}/chat/completions`)

Web Chat: manual_providers ptm openai gpt-4o-mini, vcm groq llama-3.3-70b-versatile, fcm null — BYOE Lite ready

## 6) Next — What Owner Must Tell Agent-1 (one line each)

- OpenRouter provider_id/model_id currently used: e.g. `openrouter / openai/gpt-4o-mini`
- Custom endpoint base URL (non-secret) + model IDs: e.g. `https://llm.your-domain.com/v1` + `llama-3.2-70b, gemma-2-27b, smollm2-1.7b`

Then Agent-1 will deliver exact file-by-file patch (ONE block) for 10-min switch.

## 7) Switch Runbook (for main launch doc)

If OpenRouter model unavailable:
1. Keys tab → ensure OpenRouter key saved (ephemeral header ready)
2. Chat → Provider dropdown → select backup OpenRouter model (if catalog has multiple)
3. If still failing (404/429/latency): Provider → private-llama (custom) → model → exact custom ID → Save key for private-llama → Retry chat
4. Verify SSE completes and D1 audit shows provider_id = private-llama (no key logged)
5. Rollback: Provider → openrouter → retry (no deploy needed)

---
Last verified: 2026-10-06, catalog 8 providers 4 selectable, 25/197 tests, 60/811/129 ALL PASS, build 216.86kB, dry-run 248.08KiB, leak 0
