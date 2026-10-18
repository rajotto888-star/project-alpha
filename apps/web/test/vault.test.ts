/**
 * Vault tests — the client-side key store, exercised against the CANONICAL
 * apps/web/src/lib/vault.ts API:
 *
 *   isUnlocked(): boolean
 *   createNew(passphrase): void          // sync; does NOT persist
 *   unlock(passphrase): Promise<boolean> // no blob on disk -> true (empty vault)
 *   lock(): void
 *   getKey / listProviders / setKey / removeKey / getKeysForBody
 *   persist(passphrase): Promise<void>
 *   buildEphemeralHeader(): string | null
 *
 * Real IndexedDB + WebCrypto (fake-indexeddb + Node webcrypto), not mocks — so
 * the LOCKED PBKDF2 parameter is actually exercised, not just read.
 */
import { describe, it, expect } from "vitest";
import { Vault, VAULT_PBKDF2_ITERATIONS } from "../src/lib/vault";
import { EPHEMERAL_HEADER_SIZE_THRESHOLD_BYTES } from "@project-alpha/shared";

const PW = "correct horse battery staple";
const DB_NAME = "alpha_vault";
const STORE_NAME = "vault";
const RECORD_KEY = "blob";

/** Read the raw persisted record straight out of IndexedDB. */
function readRecord(): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    // The store may not exist yet (createNew() never touches IDB), so create it
    // here — otherwise transaction() throws and the promise never settles.
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE_NAME, "readonly");
      const get = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe("PBKDF2 parameters (LOCKED §4.1)", () => {
  it("the vault re-exports the shared constant, and it is 600000", () => {
    expect(VAULT_PBKDF2_ITERATIONS).toBe(600_000);
  });
});

describe("Lock state machine", () => {
  it("starts locked", () => {
    const v = new Vault();
    expect(v.isUnlocked()).toBe(false);
  });

  it("createNew unlocks in memory and starts empty", () => {
    const v = new Vault();
    v.createNew(PW);
    expect(v.isUnlocked()).toBe(true);
    expect(v.listProviders()).toEqual([]);
    expect(v.buildEphemeralHeader()).toBeNull();
  });

  it("createNew does NOT persist on its own — an explicit persist() is required", async () => {
    const v = new Vault();
    v.createNew(PW);
    expect(await readRecord()).toBeUndefined();

    v.setKey("openai", "sk-abc");
    await v.persist(PW);
    expect(await readRecord()).toBeTruthy();
  }, 30_000);

  it("lock() clears in-memory keys but leaves the blob on disk", async () => {
    const v = new Vault();
    v.createNew(PW);
    v.setKey("openai", "sk-abc");
    await v.persist(PW);
    expect(v.getKey("openai")).toBe("sk-abc");

    v.lock();
    expect(v.isUnlocked()).toBe(false);
    expect(v.getKey("openai")).toBeUndefined();
    expect(v.listProviders()).toEqual([]);
    expect(v.buildEphemeralHeader()).toBeNull();
    expect(await readRecord()).toBeTruthy(); // still persisted
  }, 30_000);
});

describe("Create -> persist -> unlock round trip", () => {
  it("returns the exact keys after unlocking with the same passphrase", async () => {
    const v = new Vault();
    v.createNew(PW);
    v.setKey("openai", "sk-secret-openai");
    v.setKey("groq", "gsk-secret-groq");
    await v.persist(PW);

    const reopened = new Vault();
    expect(await reopened.unlock(PW)).toBe(true);
    expect(reopened.isUnlocked()).toBe(true);
    expect(reopened.getKeysForBody()).toEqual({ openai: "sk-secret-openai", groq: "gsk-secret-groq" });
    expect(reopened.getKey("openai")).toBe("sk-secret-openai");
    expect(reopened.listProviders().sort()).toEqual(["groq", "openai"]);
  }, 30_000);

  it("unlock with the WRONG passphrase returns false (AES-GCM tag failure) and stays locked", async () => {
    const v = new Vault();
    v.createNew(PW);
    v.setKey("openai", "sk-abc");
    await v.persist(PW);

    const reopened = new Vault();
    expect(await reopened.unlock("wrong-passphrase")).toBe(false);
    expect(reopened.isUnlocked()).toBe(false);
    expect(reopened.getKey("openai")).toBeUndefined();
  }, 30_000);

  it("unlock with NO blob on disk succeeds and yields an empty vault", async () => {
    // Canonical behaviour: first run has nothing to decrypt, so unlock() is a
    // no-op success rather than a failure.
    const v = new Vault();
    expect(await v.unlock(PW)).toBe(true);
    expect(v.isUnlocked()).toBe(true);
    expect(v.listProviders()).toEqual([]);
  });

  it("removeKey + persist drops the key on the next unlock", async () => {
    const v = new Vault();
    v.createNew(PW);
    v.setKey("openai", "sk-1");
    v.setKey("groq", "gsk-1");
    await v.persist(PW);

    v.removeKey("groq");
    await v.persist(PW);

    const reopened = new Vault();
    await reopened.unlock(PW);
    expect(reopened.getKeysForBody()).toEqual({ openai: "sk-1" });
  }, 30_000);
});

describe("Stored blob carries no plaintext key material", () => {
  it("persists salt/iv/ciphertext only, and the ciphertext is not the plaintext", async () => {
    const v = new Vault();
    v.createNew(PW);
    v.setKey("openai", "sk-super-secret-value");
    await v.persist(PW);

    const record = await readRecord();
    expect(record).toBeTruthy();
    expect(Object.keys(record).sort()).toEqual(["ciphertext", "iv", "salt"]);

    const blob = JSON.stringify(record);
    expect(blob).not.toContain("sk-super-secret-value");
    expect(record.salt.length).toBe(16);
    expect(record.iv.length).toBe(12);
    expect(record.ciphertext.length).toBeGreaterThan(0);
  }, 30_000);

  it("re-persisting rotates the salt, so the ciphertext changes for identical keys", async () => {
    const v = new Vault();
    v.createNew(PW);
    v.setKey("openai", "sk-same");
    await v.persist(PW);
    const first = await readRecord();

    await v.persist(PW);
    const second = await readRecord();

    expect(first.salt).not.toEqual(second.salt);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
  }, 30_000);
});

describe("buildEphemeralHeader (LOCKED size threshold)", () => {
  it("returns base64 JSON keyed by provider_id that decodes back to the exact keys", () => {
    const v = new Vault();
    v.createNew(PW);
    v.setKey("openai", "sk-abc");
    v.setKey("groq", "gsk-def");

    const header = v.buildEphemeralHeader();
    expect(header).toBeTruthy();
    expect(JSON.parse(atob(header!))).toEqual({ openai: "sk-abc", groq: "gsk-def" });
  });

  it("returns null when the vault holds no keys", () => {
    const v = new Vault();
    v.createNew(PW);
    expect(v.buildEphemeralHeader()).toBeNull();
  });

  it("returns null once the payload would exceed the 6KB threshold", () => {
    const v = new Vault();
    v.createNew(PW);
    v.setKey("openai", "k".repeat(EPHEMERAL_HEADER_SIZE_THRESHOLD_BYTES));
    expect(v.buildEphemeralHeader()).toBeNull();
  });

  it("stays under the threshold for realistic key sets", () => {
    const v = new Vault();
    v.createNew(PW);
    v.setKey("openai", "sk-" + "a".repeat(160));
    v.setKey("groq", "gsk_" + "b".repeat(56));
    const header = v.buildEphemeralHeader();
    expect(header).toBeTruthy();
    expect(header!.length).toBeLessThan(EPHEMERAL_HEADER_SIZE_THRESHOLD_BYTES);
  });
});

describe("hasVault() — read-only existence probe", () => {
  it("is false on a fresh database", async () => {
    const v = new Vault();
    v.createNew(PW);
    expect(await v.hasVault()).toBe(false);
  });
  it("is true after persist(), and stays true after lock()", async () => {
    const v = new Vault();
    v.createNew(PW);
    v.setKey("openai", "sk-test-openai");
    await v.persist(PW);
    expect(await v.hasVault()).toBe(true);
    v.lock();
    expect(await v.hasVault()).toBe(true);
  });
  it("probes existence only — never unlocks, never exposes keys", async () => {
    const v = new Vault();
    v.createNew(PW);
    v.setKey("groq", "gsk-test-groq");
    await v.persist(PW);
    const fresh = new Vault();
    expect(await fresh.hasVault()).toBe(true);
    expect(fresh.isUnlocked()).toBe(false);
    expect(fresh.listProviders()).toEqual([]);
  });
});
