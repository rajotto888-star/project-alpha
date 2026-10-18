export interface AuditEventInsert {
  id: string;
  user_id: string | null;
  request_id: string;
  provider_id: string | null;
  model_id: string | null;
  status: "ok" | "error" | "blocked";
  latency_ms: number | null;
  token_estimate: number | null;
  cost_estimate: number | null;
  phase: string | null;
  error_code: string | null;
  // LOCKED metadata-only shape. Never widen with message/prompt/output/
  // headers/cookie fields — no secret or content persistence server-side.
}

export async function insertAuditEvent(db: D1Database, ev: AuditEventInsert): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_events
       (id, user_id, request_id, provider_id, model_id, status, latency_ms, token_estimate, cost_estimate, phase, error_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ev.id,
      ev.user_id,
      ev.request_id,
      ev.provider_id,
      ev.model_id,
      ev.status,
      ev.latency_ms,
      ev.token_estimate,
      ev.cost_estimate,
      ev.phase,
      ev.error_code,
      Date.now(),
    )
    .run();
}
