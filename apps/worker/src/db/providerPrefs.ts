import type { ProviderPrefEntry, ModelRef } from "@project-alpha/shared";

export interface RoleAssignmentsMap {
  ptm: ModelRef | null;
  vcm: ModelRef | null;
  fcm: ModelRef | null;
}

export interface ProviderPrefsResult {
  provider_prefs: ProviderPrefEntry[];
  roles: RoleAssignmentsMap;
}

// LOCKED design Option A: provider_prefs(user_id,provider_id) PLUS separate
// role_assignments(user_id,role). GET returns both.
export async function getProviderPrefs(db: D1Database, userId: string): Promise<ProviderPrefsResult> {
  const prefsRes = await db
    .prepare(
      `SELECT provider_id, enabled, selected_model, priority_mode, cost_weight, quota_hint_daily
       FROM provider_prefs WHERE user_id = ?`,
    )
    .bind(userId)
    .all<{
      provider_id: string;
      enabled: number;
      selected_model: string | null;
      priority_mode: string;
      cost_weight: number;
      quota_hint_daily: number | null;
    }>();

  const provider_prefs: ProviderPrefEntry[] = (prefsRes.results ?? []).map((r) => ({
    provider_id: r.provider_id,
    enabled: r.enabled === 1,
    selected_model: r.selected_model,
    priority_mode: r.priority_mode as ProviderPrefEntry["priority_mode"],
    cost_weight: r.cost_weight,
    quota_hint_daily: r.quota_hint_daily ?? undefined,
  }));

  const rolesRes = await db
    .prepare(`SELECT role, provider_id, model_id FROM role_assignments WHERE user_id = ?`)
    .bind(userId)
    .all<{ role: string; provider_id: string; model_id: string }>();

  const roles: RoleAssignmentsMap = { ptm: null, vcm: null, fcm: null };
  for (const row of rolesRes.results ?? []) {
    const ref: ModelRef = { provider_id: row.provider_id, model_id: row.model_id };
    if (row.role === "ptm") roles.ptm = ref;
    else if (row.role === "vcm") roles.vcm = ref;
    else if (row.role === "fcm") roles.fcm = ref;
  }

  return { provider_prefs, roles };
}

export async function putProviderPrefs(
  db: D1Database,
  userId: string,
  prefs: ProviderPrefEntry[],
): Promise<void> {
  const now = Date.now();
  const statements = prefs.map((p) =>
    db
      .prepare(
        `INSERT INTO provider_prefs (user_id, provider_id, enabled, selected_model, priority_mode, cost_weight, quota_hint_daily, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, provider_id) DO UPDATE SET
           enabled = excluded.enabled,
           selected_model = excluded.selected_model,
           priority_mode = excluded.priority_mode,
           cost_weight = excluded.cost_weight,
           quota_hint_daily = excluded.quota_hint_daily,
           updated_at = excluded.updated_at`,
      )
      .bind(
        userId,
        p.provider_id,
        p.enabled ? 1 : 0,
        p.selected_model,
        p.priority_mode,
        p.cost_weight,
        p.quota_hint_daily ?? null,
        now,
      ),
  );
  if (statements.length > 0) {
    await db.batch(statements);
  }
}

// LOCKED: role=null on PUT means DELETE the row (true disable), never a
// skip-update that leaves a stale row behind.
export async function putRoleAssignment(
  db: D1Database,
  userId: string,
  role: "ptm" | "vcm" | "fcm",
  ref: ModelRef | null,
): Promise<void> {
  if (ref === null) {
    await db
      .prepare(`DELETE FROM role_assignments WHERE user_id = ? AND role = ?`)
      .bind(userId, role)
      .run();
    return;
  }
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO role_assignments (user_id, role, provider_id, model_id, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, role) DO UPDATE SET
         provider_id = excluded.provider_id,
         model_id = excluded.model_id,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, role, ref.provider_id, ref.model_id, now)
    .run();
}
