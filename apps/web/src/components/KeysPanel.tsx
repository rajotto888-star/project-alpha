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
  const [keysMap, setKeysMap] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/providers/catalog", { credentials: "include" })
      .then((r) => r.json())
      .then((body: { providers?: CatalogRow[] }) => {
        const rows = (body.providers ?? []).filter((p) => p.selectable === true);
        setProviders(rows);
        setProviderId((current) => current || rows[0]?.id || "");
      })
      .catch(() => setStatus("Could not load the provider catalog."));
    // Load existing keys map for display
    const existing = vault.listProviders();
    const map: Record<string, string> = {};
    for (const pid of existing) {
      const k = vault.getKey(pid);
      if (k) map[pid] = k.substring(0, 8) + "..." + k.substring(k.length - 4);
    }
    setKeysMap(map);
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
    const k = vault.getKey(providerId);
    if (k) setKeysMap((prev) => ({ ...prev, [providerId]: k.substring(0, 8) + "..." + k.substring(k.length - 4) }));
    setStatus(`saved: ${providerId} — ${note}`);
  }

  async function handleRemove() {
    if (!providerId) return;
    vault.removeKey(providerId);
    const note = await persistIfPossible();
    setStored(vault.listProviders());
    setKeysMap((prev) => { const next = { ...prev }; delete next[providerId]; return next; });
    setStatus(`removed: ${providerId} — ${note}`);
  }

  const headerReady = vault.buildEphemeralHeader() !== null;

  return (
    <section className="keys-panel">
      <h2>Provider keys</h2>
      <p>
        Keys are encrypted with AES-GCM in this browser and sent only as request-scoped
        credentials. They are never stored on the server. Add keys for all providers you want to use.
      </p>
      
      {/* Quick add single */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16, padding: 12, background: "#f5f5ff", borderRadius: 8 }}>
        <select
          aria-label="Provider"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} {stored.includes(p.id) ? "✅" : ""}
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
          style={{ minWidth: 300 }}
        />
        <button type="button" onClick={handleSave} disabled={!providerId || keyValue.length === 0}>
          Save
        </button>
        <button type="button" onClick={handleRemove} disabled={!providerId || !stored.includes(providerId)}>
          Remove
        </button>
      </div>

      {/* All providers grid - fixes "only groq" issue */}
      <h3 style={{ fontSize: 14 }}>All providers - status</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8, marginBottom: 16 }}>
        {providers.map((p) => {
          const hasKey = stored.includes(p.id);
          const masked = keysMap[p.id] || "";
          return (
            <div key={p.id} style={{ border: hasKey ? "2px solid #4a9" : "1px solid #ddd", borderRadius: 6, padding: 8, background: hasKey ? "#f0fff0" : "#fff" }}>
              <strong>{p.id}</strong> {hasKey ? "✅ key saved" : "❌ no key"}
              <div style={{ fontSize: 11, color: "#666" }}>Models: {p.models.slice(0, 2).join(", ")}{p.models.length > 2 ? ` +${p.models.length - 2} more` : ""}</div>
              {hasKey && <div style={{ fontSize: 11, color: "#06a" }}>{masked}</div>}
            </div>
          );
        })}
      </div>

      <p role="status" style={{ background: status ? "#e6f7ff" : "transparent", padding: status ? 8 : 0, borderRadius: 4 }}>{status}</p>
      <p>stored providers: {stored.length === 0 ? "none" : stored.join(", ")}</p>
      <p>ephemeral header ready: {headerReady ? "yes" : "no"} {headerReady ? "✅ chat will work" : "❌ add at least one key"}</p>
      
      <div style={{ marginTop: 16, padding: 12, background: "#fff8e6", borderRadius: 8, fontSize: 12 }}>
        <strong>How to get keys:</strong>
        <ul style={{ margin: "4px 0", paddingLeft: 16 }}>
          <li><strong>groq</strong>: https://console.groq.com/keys (free 14k req/day)</li>
          <li><strong>openrouter</strong>: https://openrouter.ai/keys (many free models)</li>
          <li><strong>openai</strong>: https://platform.openai.com/api-keys</li>
          <li><strong>private-llama / hf-space / colab / kaggle</strong>: any string (e.g., "local-key" or "dummy") if you run your own gateway, or your HF Space token</li>
          <li><strong>Android Private LM</strong>: set custom endpoint in Providers tab, then use any key like "android-local"</li>
        </ul>
      </div>
    </section>
  );
}
