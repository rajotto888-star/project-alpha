export interface UserRow {
  id: string;
  oauth_provider: string;
  oauth_sub: string;
  email: string;
  created_at: number;
}

export async function upsertUser(
  db: D1Database,
  oauthProvider: string,
  oauthSub: string,
  email: string,
): Promise<UserRow> {
  const existing = await db
    .prepare(
      `SELECT id, oauth_provider, oauth_sub, email, created_at FROM users WHERE oauth_provider = ? AND oauth_sub = ?`,
    )
    .bind(oauthProvider, oauthSub)
    .first<UserRow>();

  if (existing) {
    if (existing.email !== email) {
      await db.prepare(`UPDATE users SET email = ? WHERE id = ?`).bind(email, existing.id).run();
      return { ...existing, email };
    }
    return existing;
  }

  const id = crypto.randomUUID();
  const created_at = Date.now();
  await db
    .prepare(`INSERT INTO users (id, oauth_provider, oauth_sub, email, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, oauthProvider, oauthSub, email, created_at)
    .run();
  return { id, oauth_provider: oauthProvider, oauth_sub: oauthSub, email, created_at };
}

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  const row = await db
    .prepare(`SELECT id, oauth_provider, oauth_sub, email, created_at FROM users WHERE id = ?`)
    .bind(id)
    .first<UserRow>();
  return row ?? null;
}
