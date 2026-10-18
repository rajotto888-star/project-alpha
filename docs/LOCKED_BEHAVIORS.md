# PROJECT ALPHA — LOCKED BEHAVIORS (canonical, V8.06)

1. Policy gate: always SSE 200. Blocked flow = meta -> error(phase="policy",
   recoverable=false, error_code=POLICY_BLOCKED, provider_id=null) -> close.
   No done/phase/chunk/verifier_json/patch. Generic message, no rule leakage.
2. final_verdict enum is exactly "verified" | "unverified". VCM success ->
   always "verified" regardless of patch/replace/none. VCM total failure ->
   "unverified", vcm:null.
3. No PhaseEvent is ever emitted for the "merge" step.
4. Ephemeral key precedence: header valid => use; header invalid => reject
   (never fall back to body); header absent + body valid => use body; both
   absent/invalid => MISSING_CREDENTIALS.
5. provider_id regex ^[a-z0-9][a-z0-9._-]*$, no colon, max 64 chars.
6. provider_prefs.cost_weight CHECK BETWEEN 0 AND 10 (SQL + Zod).
7. PTM failover boundary: retry allowed only before the first successfully
   emitted chunk (flag flips only after emitter.chunk() resolves). After the
   first emitted chunk, any failure is terminal PTM_TERMINAL_MIDSTREAM
   regardless of underlying cause — no retry, no VCM, no done.
8. role_assignments: role=null on PUT means DELETE the row, never skip-update.
   DB design is Option A: provider_prefs(user_id,provider_id) PLUS separate
   role_assignments(user_id,role).
9. ERROR_CODES is the single source of truth (packages/shared/src/error-codes.ts).
   No route/adapter/orchestrator may emit ad-hoc error_code strings;
   assertKnownErrorCode() is called as the first line of SSEEmitter.error().
   NOT_FOUND is used only by the 404 handler, never inside an SSE stream.
10. Cookie-only session auth. Authorization header is never read for session
    auth. Session payload is minimal {uid, exp, sid?} signed via WebCrypto
    HMAC-SHA256, verified with a timing-safe comparison.
11. No secret persistence anywhere server-side (D1/KV/DO/R2/logs/analytics/
    audit). AuditEventInsert is metadata-only by type; message/prompt/output/
    headers/cookie fields must never be added to it.
12. VerifierResult.severity is SERVER-COMPUTED as max(corrections[].severity);
    raw VCM JSON severity is ignored. Corrections[].severity can never be
    "none" — only "minor"|"major"|"critical". Top-level Severity adds "none".
13. PTM midstream terminal semantics: PTM_TERMINAL_MIDSTREAM is reported
    uniformly for any PTM failure after the first emitted chunk (auth/timeout/
    5xx/connection-reset — cause irrelevant).
14. SSEEmitter enforces all sequencing invariants by THROWING (never silently
    no-op-ing): meta must be first; no event before meta; no event after
    terminal; chunk(source) requires the matching phase(source) first;
    chunk.index is monotonic per source; verifier_json requires
    phase("verification") first and can fire at most once; patch requires
    verifier_json first and can fire at most once; no done after a
    non-recoverable error.
15. FCM_DEADLINE_MISSED is emitted exclusively from raceWithDeadline()'s
    "deadline" branch. Any other FCM failure classifies as FCM_PROVIDER_ERROR.
16. Client disconnect (AbortSignal) cascades to all in-flight upstream
    fetches. On disconnect mid-stream the server stops quietly — no
    misleading terminal SSE error, no misleading audit "error" row.
17. Merge style is hybrid (default) | always_patch | always_replace. Hybrid
    replaces iff needs_correction=true AND confidence>=80 AND severity in
    [major,critical]; otherwise patches. Replace mode's corrected_answer is
    always null at the type level — the server never rewrites in place; the
    client must trigger a new stateless /api/chat/stream call, carrying the
    original PTM answer forward as an assistant message.
18. router_mode is the fixed literal "manual" in MVP. Auto-router scaffolding
    is allowed only off-by-default with no schema change.

19. R7 (updated, step 129): selectable providers now include owner-managed private endpoints (private-llama, private-smollm). True user-supplied BYOE (arbitrary baseUrl from client) remains deferred to v1.1+ with SSRF guard. baseUrl stays server-side only, resolved exclusively from PROVIDER_CATALOG (B3 lock).

