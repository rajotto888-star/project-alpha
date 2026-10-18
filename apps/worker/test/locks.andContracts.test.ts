import { describe, it, expect, vi, afterEach } from "vitest";
import {
  VAULT_PBKDF2_ITERATIONS,
  FCM_DEADLINE_MS,
  PTM_STREAM_TIMEOUT_MS,
  VCM_TIMEOUT_MS,
  OAUTH_STATE_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  EPHEMERAL_HEADER_SIZE_THRESHOLD_BYTES,
} from "@project-alpha/shared";
import { runCommander } from "../src/orchestrator/runCommander";
import { mockOpenAIStream } from "./utils/mockProvider";
import { mockOpenAICompletion } from "./utils/mockCompletion";
import { getProviderPrefs, putRoleAssignment } from "../src/db/providerPrefs";

describe("FIX #7 — locked constants (lock guards)", () => {
  it("vault PBKDF2 iterations are 600,000 and never lower", () => {
    expect(VAULT_PBKDF2_ITERATIONS).toBe(600_000);
    // OWASP 2023 floor for PBKDF2-HMAC-SHA256. Lowering this must fail the build.
    expect(VAULT_PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it("commander/auth timing constants are unchanged", () => {
    expect(FCM_DEADLINE_MS).toBe(500);
    expect(PTM_STREAM_TIMEOUT_MS).toBe(60_000);
    expect(VCM_TIMEOUT_MS).toBe(30_000);
    expect(OAUTH_STATE_TTL_SECONDS).toBe(300);
    expect(SESSION_COOKIE_NAME).toBe("alpha_session");
    expect(EPHEMERAL_HEADER_SIZE_THRESHOLD_BYTES).toBe(6 * 1024);
  });
});

function fakeD1() {
  return {
    prepare: () => ({
      bind: () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }),
    }),
  } as unknown as D1Database;
}

class RecordingEmitter {
  events: any[] = [];
  meta(requestId: string, manualProviders: unknown) {
    this.events.push({ type: "meta", request_id: requestId, manualProviders });
  }
  phase(phase: string, source?: string) { this.events.push({ type: "phase", phase, source }); }
  chunk(source: string, delta: string) { this.events.push({ type: "chunk", source, delta }); }
  verifierJson(result: unknown) { this.events.push({ type: "verifier_json", result }); }
  patch(payload: unknown) { this.events.push({ type: "patch", payload }); }
  done(args: any) { this.events.push({ type: "done", ...args }); }
  error(args: any) { this.events.push({ type: "error", ...args }); }
  close() { this.events.push({ type: "close" }); }
}

describe("Item #7 — VCM success path plumbs token_usage.vcm", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("emits verifier_json once, then done(verified) with a numeric token_usage.vcm", async () => {
    const verifierJson = JSON.stringify({
      needs_correction: false,
      confidence: 97,
      reasoning: "Answer is accurate.",
      corrections: [],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(typeof input === "string" ? input : input.url);
        if (url.includes("openai.com"))
          return mockOpenAIStream([{ delta: "Paris is the capital of France." }], { totalTokens: 31 });
        if (url.includes("groq.com")) return mockOpenAICompletion(verifierJson, { totalTokens: 77 });
        throw new Error("unexpected url: " + url);
      }),
    );

    const emitter = new RecordingEmitter();
    await runCommander(
      {
        userId: "u1",
        db: fakeD1(),
        payload: {
          messages: [{ role: "user", content: "What is the capital of France?" }],
          manual_providers: {
            ptm: { provider_id: "openai", model_id: "gpt-4o-mini" },
            vcm: { provider_id: "groq", model_id: "llama-3.3-70b-versatile" },
            fcm: null,
          },
          merge_style: "hybrid",
          enable_fast_draft: false,
          router_mode: "manual",
        } as any,
        ephemeralKeys: { openai: "sk-test", groq: "gk-test" },
        signal: new AbortController().signal,
        emitter: emitter as any,
      },
    );

    const types = emitter.events.map((e) => e.type);
    expect(types.filter((t) => t === "verifier_json")).toHaveLength(1);
    // no corrections -> hybrid decision is "none" -> no patch event
    expect(types).not.toContain("patch");
    // LOCKED: merge never gets a phase event
    expect(emitter.events.some((e) => e.type === "phase" && e.phase === "merge")).toBe(false);

    const done = emitter.events.find((e) => e.type === "done");
    expect(done.final_verdict).toBe("verified");
    expect(done.vcm).not.toBeNull();
    // item #7: VCM usage from the non-streaming completion is plumbed through as a NUMBER
    expect(typeof done.token_usage.vcm).toBe("number");
    expect(done.token_usage.vcm).toBe(77);
    // PTM now opts into stream_options.include_usage, so token_usage.ptm is a
    // real number read off the provider's trailing usage frame — never a
    // fabricated 0, and never present when the provider omits usage.
    expect(typeof done.token_usage.ptm).toBe("number");
    expect(done.token_usage.ptm).toBe(31);
  });
});

describe("FIX #8 — provider prefs + role assignment DB contract", () => {
  it("GET returns provider_prefs AND a roles map with all three keys", async () => {
    const db = {
      prepare(sql: string) {
        const isPrefs = sql.includes("FROM provider_prefs");
        return {
          bind: () => ({
            all: async () => ({
              results: isPrefs
                ? [
                    {
                      provider_id: "groq",
                      enabled: 1,
                      selected_model: "llama-3.3-70b-versatile",
                      priority_mode: "balanced",
                      cost_weight: 5,
                      quota_hint_daily: null,
                    },
                  ]
                : [{ role: "ptm", provider_id: "groq", model_id: "llama-3.3-70b-versatile" }],
            }),
          }),
        };
      },
    } as unknown as D1Database;

    const res = await getProviderPrefs(db, "u1");
    expect(res.provider_prefs).toHaveLength(1);
    // enabled is normalized to a real boolean, not the stored 0/1
    expect(res.provider_prefs[0].enabled).toBe(true);
    expect(Object.keys(res.roles).sort()).toEqual(["fcm", "ptm", "vcm"]);
    expect(res.roles.ptm).toEqual({ provider_id: "groq", model_id: "llama-3.3-70b-versatile" });
    expect(res.roles.vcm).toBeNull();
    expect(res.roles.fcm).toBeNull();
  });

  it("role=null issues a DELETE (true disable), not a skip-update", async () => {
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return { bind: () => ({ run: async () => ({}) }) };
      },
    } as unknown as D1Database;

    await putRoleAssignment(db, "u1", "vcm", null);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^DELETE FROM role_assignments/);

    await putRoleAssignment(db, "u1", "vcm", { provider_id: "groq", model_id: "llama-3.1-8b-instant" });
    expect(statements[1]).toMatch(/INSERT INTO role_assignments/);
    expect(statements[1]).toMatch(/ON CONFLICT\(user_id, role\) DO UPDATE/);
  });
});
