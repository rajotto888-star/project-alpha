import { VAULT_PBKDF2_ITERATIONS, EPHEMERAL_HEADER_SIZE_THRESHOLD_BYTES } from "@project-alpha/shared";

export { VAULT_PBKDF2_ITERATIONS };

interface VaultBlob {
  salt: number[];
  iv: number[];
  ciphertext: number[];
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// BUG 8 fix: TS5.7 generic Uint8Array requires the ArrayBuffer type param at
// the WebCrypto importKey/deriveKey boundary.
async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: VAULT_PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("alpha_vault", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("vault");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<VaultBlob | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("vault", "readonly");
    const req = tx.objectStore("vault").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: VaultBlob): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("vault", "readwrite");
    tx.objectStore("vault").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Ephemeral keys live only in memory (this.keys) and, when persisted, only as
// AES-GCM ciphertext in IndexedDB — never as plaintext, never server-side.
export class Vault {
  private keys: Map<string, string> = new Map();
  private unlocked = false;

  isUnlocked(): boolean {
    return this.unlocked;
  }

  createNew(_passphrase: string): void {
    this.keys = new Map();
    this.unlocked = true;
  }

  async unlock(passphrase: string): Promise<boolean> {
    const blob = await idbGet("blob");
    if (!blob) {
      this.keys = new Map();
      this.unlocked = true;
      return true;
    }
    try {
      const salt = new Uint8Array(blob.salt) as Uint8Array<ArrayBuffer>;
      const iv = new Uint8Array(blob.iv);
      const key = await deriveKey(passphrase, salt);
      const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, new Uint8Array(blob.ciphertext));
      const json = JSON.parse(new TextDecoder().decode(plainBuf)) as Record<string, string>;
      this.keys = new Map(Object.entries(json));
      this.unlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  lock(): void {
    this.keys = new Map();
    this.unlocked = false;
  }

  /** Read-only probe: true when a persisted blob exists. Never deletes, never decrypts. */
  async hasVault(): Promise<boolean> {
    // openDb() may lazily create an empty DB/store on a fresh browser — the same
    // side effect unlock()/persist() already have (it is never destructive).
    // No record means no vault; a locked vault still reports true.
    return (await idbGet("blob")) != null;
  }

  getKey(providerId: string): string | undefined {
    return this.keys.get(providerId);
  }

  listProviders(): string[] {
    return [...this.keys.keys()];
  }

  setKey(providerId: string, key: string): void {
    this.keys.set(providerId, key);
  }

  removeKey(providerId: string): void {
    this.keys.delete(providerId);
  }

  async persist(passphrase: string): Promise<void> {
    const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(Object.fromEntries(this.keys)));
    const ciphertextBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    await idbPut("blob", {
      salt: Array.from(salt),
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(ciphertextBuf)),
    });
  }

  buildEphemeralHeader(): string | null {
    if (this.keys.size === 0) return null;
    const json = JSON.stringify(Object.fromEntries(this.keys));
    const encoded = utf8ToBase64(json);
    if (encoded.length > EPHEMERAL_HEADER_SIZE_THRESHOLD_BYTES) return null;
    return encoded;
  }

  getKeysForBody(): Record<string, string> {
    return Object.fromEntries(this.keys);
  }
}
