/**
 * Task F — "no secret persistence" regression canary.
 *
 * Three layers:
 *  1. Type-level: AuditEventInsert must not accept free-text content fields.
 *  2. Source scan (lint-like): no logging of request material, and no key material
 *     reaching the DB layer or KV.
 *  3. Runtime: insertAuditEvent binds only metadata, with matching placeholder count.
 *
 * If someone widens the audit type or adds a `console.log(body)`, this file fails.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { insertAuditEvent, type AuditEventInsert } from "../src/db/audit";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Strip line and block comments so LOCKED explanatory comments do not trip the scan. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FILES = walk(SRC_DIR).map((f) => ({ path: relative(SRC_DIR, f), code: stripComments(readFileSync(f, "utf8")) }));

// Identifiers/strings that must never appear in a logging call.
const FORBIDDEN_IN_LOGS = [
  "ephemeral",
  "apiKey",
  "api_key",
  "messages",
  "payload",
  "rawBody",
  "authorization",
  "cookie",
  "header",
  "body",
  "token",
  "prompt",
  "output",
];

// Columns that must never exist on the audit table.
const FORBIDDEN_AUDIT_COLUMNS = [
  "prompt",
  "output",
  "message",
  "messages",
  "content",
  "headers",
  "cookie",
  "authorization",
  "api_key",
  "apikey",
  "secret",
  "ephemeral",
  "response",
  "request_body",
];

describe("Task F.1 — audit insert type cannot carry content (compile-time)", () => {
  it("rejects free-text fields on AuditEventInsert", () => {
    const base: AuditEventInsert = {
      id: "audit-1",
      user_id: "u1",
      request_id: "r1",
      provider_id: "openai",
      model_id: "gpt-4o-mini",
      status: "ok",
      latency_ms: 10,
      token_estimate: 5,
      cost_estimate: 0,
      phase: "done",
      error_code: null,
    };
    expect(base.user_id).toBe("u1");

    // Each of these MUST be a type error. If the type is ever widened, tsc fails here.
    // @ts-expect-error prompt content is never allowed on audit rows
    const withPrompt: AuditEventInsert = { ...base, prompt: "secret prompt" };
    // @ts-expect-error model output is never allowed on audit rows
    const withOutput: AuditEventInsert = { ...base, output: "secret output" };
    // @ts-expect-error provider keys are never allowed on audit rows
    const withKey: AuditEventInsert = { ...base, api_key: "sk-secret" };
    // @ts-expect-error headers are never allowed on audit rows
    const withHeaders: AuditEventInsert = { ...base, headers: "x-ephemeral-keys: ..." };

    expect([withPrompt, withOutput, withKey, withHeaders]).toHaveLength(4);
  });
});

describe("Task F.2 — source scan (lint-like canary)", () => {
  it("never logs request material, keys, headers or cookies", () => {
    const violations: string[] = [];
    for (const { path, code } of FILES) {
      const lines = code.split("\n");
      lines.forEach((line, i) => {
        if (!/console\s*\.\s*(log|info|warn|error|debug)/.test(line)) return;
        const lower = line.toLowerCase();
        for (const bad of FORBIDDEN_IN_LOGS) {
          if (lower.includes(bad.toLowerCase())) {
            violations.push(`${path}:${i + 1} logs "${bad}" -> ${line.trim()}`);
          }
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("keeps key material out of the DB layer entirely", () => {
    const dbFiles = FILES.filter((f) => f.path.startsWith("db/"));
    expect(dbFiles.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const { path, code } of dbFiles) {
      for (const bad of ["ephemeral", "apiKey", "api_key", "Authorization", "messages", "prompt", "headers", "cookie"]) {
        if (code.includes(bad)) violations.push(`${path} references "${bad}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("audit table has no content-bearing columns", () => {
    const audit = FILES.find((f) => f.path === "db/audit.ts");
    expect(audit).toBeDefined();
    const insert = audit!.code.match(/INSERT INTO audit_events\s*\(([^)]*)\)/i);
    expect(insert).not.toBeNull();
    const columns = insert![1].split(",").map((c) => c.trim().toLowerCase());
    const bad = columns.filter((c) => FORBIDDEN_AUDIT_COLUMNS.includes(c));
    expect(bad).toEqual([]);
  });

  it("KV writes never carry ephemeral key material", () => {
    const violations: string[] = [];
    for (const { path, code } of FILES) {
      if (!/KV\s*\.\s*put\s*\(/.test(code)) continue;
      if (/ephemeralKeys|apiKey|api_key/i.test(code)) {
        violations.push(`${path} writes to KV in a file that also touches key material`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("never stringifies request material into a persisted value", () => {
    const violations: string[] = [];
    for (const { path, code } of FILES) {
      const re = /JSON\.stringify\(\s*([A-Za-z0-9_.\[\]]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const arg = m[1].toLowerCase();
        // NOTE: a bare `payload` is intentionally NOT flagged — lib/crypto.ts legitimately
        // stringifies the SESSION payload ({uid, exp}) to sign the cookie. Only request
        // material is forbidden.
        const forbiddenArgs = [
          "messages",
          "rawbody",
          "ephemeralkeys",
          "headers",
          "payload.messages",
          "payload.ephemeral_keys",
          "c.req.raw",
        ];
        if (forbiddenArgs.includes(arg)) {
          violations.push(`${path} JSON.stringify(${m[1]})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("Task F.3 — insertAuditEvent binds metadata only", () => {
  it("binds one value per placeholder and no free-text field", async () => {
    let capturedSql = "";
    let capturedArgs: unknown[] = [];
    const fakeDb = {
      prepare(sql: string) {
        capturedSql = sql;
        return {
          bind(...args: unknown[]) {
            capturedArgs = args;
            return { run: async () => ({}) };
          },
        };
      },
    } as unknown as D1Database;

    await insertAuditEvent(fakeDb, {
      id: "audit-1",
      user_id: "u1",
      request_id: "r1",
      provider_id: "openai",
      model_id: "gpt-4o-mini",
      status: "ok",
      latency_ms: 42,
      token_estimate: 7,
      cost_estimate: 0,
      phase: "done",
      error_code: null,
    });

    const placeholders = (capturedSql.match(/\?/g) ?? []).length;
    expect(placeholders).toBe(capturedArgs.length);

    // No argument may be a long free-text blob; metadata values are ids/numbers/short codes.
    for (const a of capturedArgs) {
      if (typeof a === "string") expect(a.length).toBeLessThan(128);
    }

    const lower = capturedSql.toLowerCase();
    for (const bad of FORBIDDEN_AUDIT_COLUMNS) {
      expect(lower).not.toContain(` ${bad},`);
    }
  });
});
