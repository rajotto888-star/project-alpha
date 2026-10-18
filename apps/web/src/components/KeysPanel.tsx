import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import type { Vault } from "../lib/vault";

/** Public catalog row shape (string models, no baseUrl — see GET /api/providers/catalog). */
interface CatalogRow {
  id: string;
  models: string[];
  implemented: boolean;
  selectable: boolean;
}

interface KeysPanelProps {
  vault: Vault;
  /** Memory-only passphrase captured at unlock/create time. Never persisted, never rendered. */
  passphraseRef: MutableRefObject<string>;
}

export function KeysPanel({ vault, passphraseRef }: KeysPanelProps) {
  const [providers, setProviders] = useState<CatalogRow[]>([]);
  const [providerId, setProviderId] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [stored, setStored] = useState<string[]>(() => vault.listProviders());
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/providers/catalog", { credentials: "include" })
      .then((r) => r.json())
      .then((body: { providers?: CatalogRow[] }) => {
        const rows = (body.providers ?? []).filter((p) => p.selectable === true);
        setProviders(rows);
        setProviderId((current) => current || rows[0]?.id || "");
      })
      .catch(() => setStatus("Could not load the provider catalog."));
  }, []);

  async function persistIfPossible(): Promise<string> {
    if (!passphraseRef.current) return "kept for this session only (vault passphrase not in memory)";
    await vault.persist(passphraseRef.current);
    return "encrypted and saved in this browser";
  }

  async function handleSave() {
    if (!providerId || keyValue.length === 0) return;
    vault.setKey(providerId, keyValue);
    const note = await persistIfPossible();
    setKeyValue("");
    setStored(vault.listProviders());
    setStatus(`saved: ${providerId} — ${note}`);
  }

  async function handleRemove() {
    if (!providerId) return;
    vault.removeKey(providerId);
    const note = await persistIfPossible();
    setStored(vault.listProviders());
    setStatus(`removed: ${providerId} — ${note}`);
  }

  const headerReady = vault.buildEphemeralHeader() !== null;

  return (
    <section className="keys-panel">
      <h2>Provider keys</h2>
      <p>
        Keys are encrypted with AES-GCM in this browser and sent only as request-scoped
        credentials. They are never stored on the server.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select
          aria-label="Provider"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}
            </option>
          ))}
        </select>
        <input
          type="password"
          autoComplete="off"
          aria-label="API key"
          placeholder="API key"
          value={keyValue}
          onChange={(e) => setKeyValue(e.target.value)}
        />
        <button type="button" onClick={handleSave} disabled={!providerId || keyValue.length === 0}>
          Save
        </button>
        <button type="button" onClick={handleRemove} disabled={!providerId || !stored.includes(providerId)}>
          Remove
        </button>
      </div>
      <p role="status">{status}</p>
      <p>stored providers: {stored.length === 0 ? "none" : stored.join(", ")}</p>
      <p>ephemeral header ready: {headerReady ? "yes" : "no"}</p>
    </section>
  );
}
