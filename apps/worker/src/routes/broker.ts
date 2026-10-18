import { Hono } from "hono";
import type { AuthedEnv } from "../types/env";

// Arena.ai -> Tab A8 / PC Command Broker - AUTO-LOGIN MODE (no auth required)
// POST /api/broker/push  - Arena pushes command
// GET  /api/broker/poll?device_id=pc-main - Poller polls pending
// POST /api/broker/ack   - Ack result
// GET  /api/broker/list?device_id=pc-main - List recent

export const brokerRoute = new Hono<AuthedEnv>();

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Helper: get userId or default to auto user
function getUserId(c: any): string {
  return c.get("userId") || "default-user";
}

brokerRoute.post("/push", async (c) => {
  const userId = getUserId(c);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error_code: "INVALID_JSON", message: "invalid json" }, 400);
  }
  const device_id = String(body.device_id || "pc-main").trim();
  const command = String(body.command || "").trim();
  if (!command) {
    return c.json({ error_code: "COMMAND_REQUIRED", message: "command required" }, 400);
  }
  if (command.length > 8000) {
    return c.json({ error_code: "COMMAND_TOO_LONG", message: "command too long" }, 400);
  }
  const payload = body.payload ? JSON.stringify(body.payload).slice(0, 10000) : null;
  const id = genId();
  const now = Date.now();

  try {
    // Ensure table exists (in case migration not applied)
    await c.env.DB?.prepare(
      `CREATE TABLE IF NOT EXISTS broker_commands (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        command TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        created_at INTEGER NOT NULL,
        claimed_at INTEGER,
        done_at INTEGER,
        created_by TEXT
      )`
    ).run().catch(() => {});

    await c.env.DB.prepare(
      `INSERT INTO broker_commands (id, device_id, command, payload, status, created_at, created_by)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(id, device_id, command, payload, now, userId).run();
  } catch (e: any) {
    return c.json({ error_code: "DB_ERROR", message: e?.message || "db error" }, 500);
  }

  return c.json({ ok: true, id, device_id, command, status: "pending", created_at: now });
});

brokerRoute.get("/poll", async (c) => {
  const device_id = String(c.req.query("device_id") || "pc-main").trim();
  const limit = Math.min(20, Math.max(1, Number(c.req.query("limit") || 10)));

  try {
    await c.env.DB?.prepare(
      `CREATE TABLE IF NOT EXISTS broker_commands (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        command TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        created_at INTEGER NOT NULL,
        claimed_at INTEGER,
        done_at INTEGER,
        created_by TEXT
      )`
    ).run().catch(() => {});

    const res = await c.env.DB.prepare(
      `SELECT id, device_id, command, payload, status, created_at
       FROM broker_commands
       WHERE device_id = ? AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT ?`
    ).bind(device_id, limit).all<{
      id: string; device_id: string; command: string; payload: string | null; status: string; created_at: number;
    }>();

    const now = Date.now();
    for (const row of res.results || []) {
      await c.env.DB.prepare(
        `UPDATE broker_commands SET status='claimed', claimed_at=? WHERE id=? AND status='pending'`
      ).bind(now, row.id).run().catch(() => {});
    }

    return c.json({ ok: true, device_id, commands: res.results || [] });
  } catch (e: any) {
    return c.json({ error_code: "DB_ERROR", message: e?.message || "db error", device_id, commands: [] }, 200);
  }
});

brokerRoute.post("/ack", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error_code: "INVALID_JSON", message: "invalid json" }, 400);
  }
  const id = String(body.id || "").trim();
  const status = body.status === "failed" ? "failed" : "done";
  const result = body.result ? String(body.result).slice(0, 20000) : null;
  if (!id) {
    return c.json({ error_code: "ID_REQUIRED", message: "id required" }, 400);
  }
  const now = Date.now();
  try {
    await c.env.DB.prepare(
      `UPDATE broker_commands SET status=?, result=?, done_at=? WHERE id=?`
    ).bind(status, result, now, id).run();
    return c.json({ ok: true, id, status, done_at: now });
  } catch (e: any) {
    return c.json({ error_code: "DB_ERROR", message: e?.message || "db error" }, 500);
  }
});

brokerRoute.get("/list", async (c) => {
  const device_id = String(c.req.query("device_id") || "pc-main").trim();
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") || 20)));
  try {
    const res = await c.env.DB.prepare(
      `SELECT id, device_id, command, payload, status, result, created_at, claimed_at, done_at
       FROM broker_commands
       WHERE device_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(device_id, limit).all();
    return c.json({ ok: true, device_id, commands: res.results || [] });
  } catch (e: any) {
    return c.json({ ok: true, device_id, commands: [], error: e?.message }, 200);
  }
});
