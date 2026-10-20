import { useEffect, useState } from "react";

interface CatalogProvider {
  id: string;
  models: string[];
  implemented: boolean;
  selectable: boolean;
}

interface PrefRow {
  provider_id: string;
  enabled: number | boolean;
  selected_model: string | null;
  priority_mode: string;
  cost_weight: number;
  quota_hint_daily?: number | null;
}

type Role = "ptm" | "vcm" | "fcm";

export function ProviderSettings() {
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);
  const [prefs, setPrefs] = useState<PrefRow[]>([]);
  const [roles, setRoles] = useState<Record<string, { provider_id: string; model_id: string } | null>>({});
  const [status, setStatus] = useState<string | null>(null);

  async function refresh() {
    const [cat, pref] = await Promise.all([
      fetch("/api/providers/catalog", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/providers/prefs", { credentials: "include" }).then((r) => r.json()),
    ]);
    setCatalog(cat.providers ?? []);
    setPrefs(pref.provider_prefs ?? []);
    setRoles(pref.roles ?? {});
  }

  useEffect(() => {
    refresh().catch(() => setStatus("Could not load provider settings (are you signed in?)"));
  }, []);

  async function savePrefs() {
    const res = await fetch("/api/providers/prefs", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prefs: prefs.map((p) => ({
          provider_id: p.provider_id,
          enabled: !!p.enabled,
          selected_model: p.selected_model,
          priority_mode: p.priority_mode,
          cost_weight: Number(p.cost_weight),
        })),
      }),
    });
    setStatus(res.ok ? "Preferences saved." : "Save failed.");
    if (res.ok) await refresh();
  }

  async function setRole(role: Role, provider_id: string, model_id: string) {
    // null body => DELETE the assignment (true disable), per LOCKED behavior #8
    const body = provider_id ? { provider_id, model_id } : null;
    const res = await fetch(`/api/providers/prefs/roles/${role}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setStatus(res.ok ? `Role ${role} updated.` : `Role ${role} update failed.`);
    if (res.ok) await refresh();
  }

  const selectable = catalog.filter((p) => p.implemented && p.selectable);

  // Auto-initialize prefs with defaults if empty - show selected model properly
  useEffect(() => {
    if (catalog.length > 0 && prefs.length === 0) {
      const defaults: PrefRow[] = selectable.map((p) => ({
        provider_id: p.id,
        enabled: ["groq", "openrouter", "openai"].includes(p.id) ? 1 : 0,
        selected_model: p.models[0] ?? null,
        priority_mode: "balanced",
        cost_weight: 5,
      }));
      setPrefs(defaults);
    }
  }, [catalog]);

  // Custom endpoints for Android Private LM and local LLMs (stored in localStorage)
  const [customEndpoints, setCustomEndpoints] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("custom_endpoints") || "{}"); } catch { return {}; }
  });

  function saveCustomEndpoint(providerId: string, url: string) {
    const next = { ...customEndpoints, [providerId]: url };
    if (!url) delete next[providerId];
    setCustomEndpoints(next);
    localStorage.setItem("custom_endpoints", JSON.stringify(next));
    setStatus(url ? `Custom endpoint for ${providerId} saved: ${url}` : `Custom endpoint for ${providerId} cleared`);
  }

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Provider preferences</h2>
      <p style={{ fontSize: 12, color: "#666" }}>Select providers, choose default model (shown), and assign roles for chat. First-time defaults: groq, openrouter, openai enabled.</p>
      {selectable.length === 0 ? <p>No selectable providers returned by the catalog.</p> : null}

      {selectable.map((p) => {
        const row = prefs.find((r) => r.provider_id === p.id);
        const isEnabled = !!row?.enabled;
        const selectedModel = row?.selected_model ?? p.models[0] ?? "";
        const customUrl = customEndpoints[p.id] || "";
        const isLocalProvider = ["private-llama", "private-smollm", "colab", "kaggle", "hf-space"].includes(p.id);
        return (
          <div key={p.id} style={{ border: isEnabled ? "2px solid #4a9" : "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 8, background: isEnabled ? "#f6fff6" : "#fff" }}>
            <label style={{ display: "block", marginBottom: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) =>
                  setPrefs((prev) => {
                    const others = prev.filter((x) => x.provider_id !== p.id);
                    return [
                      ...others,
                      {
                        provider_id: p.id,
                        enabled: e.target.checked ? 1 : 0,
                        selected_model: row?.selected_model ?? p.models[0] ?? null,
                        priority_mode: row?.priority_mode ?? "balanced",
                        cost_weight: row?.cost_weight ?? 5,
                      },
                    ];
                  })
                }
              />{" "}
              <strong>{p.id}</strong> {isEnabled ? "✅ enabled" : "⬜ disabled"} {selectedModel ? `— model: ${selectedModel}` : ""}
            </label>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
              <label style={{ display: "block" }}>
                Model{" "}
                <select
                  value={selectedModel}
                  onChange={(e) =>
                    setPrefs((prev) => {
                      const exists = prev.find((x) => x.provider_id === p.id);
                      if (!exists) {
                        return [...prev, { provider_id: p.id, enabled: 1, selected_model: e.target.value, priority_mode: "balanced", cost_weight: 5 }];
                      }
                      return prev.map((x) => (x.provider_id === p.id ? { ...x, selected_model: e.target.value } : x));
                    })
                  }
                >
                  {p.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: "block" }}>
                Priority mode{" "}
                <select
                  value={row?.priority_mode ?? "balanced"}
                  onChange={(e) =>
                    setPrefs((prev) => {
                      const exists = prev.find((x) => x.provider_id === p.id);
                      if (!exists) return prev;
                      return prev.map((x) => (x.provider_id === p.id ? { ...x, priority_mode: e.target.value } : x));
                    })
                  }
                >
                  {["latency", "reliability", "budget", "balanced"].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: "block" }}>
                Cost weight (0–10){" "}
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={row?.cost_weight ?? 5}
                  onChange={(e) =>
                    setPrefs((prev) =>
                      prev.map((x) =>
                        x.provider_id === p.id ? { ...x, cost_weight: Number(e.target.value) } : x,
                      ),
                    )
                  }
                  style={{ width: 50 }}
                />
              </label>
            </div>

            {isLocalProvider && (
              <div style={{ marginTop: 6, padding: 8, background: "#eef6ff", borderRadius: 6 }}>
                <label style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  Custom endpoint for {p.id} (Android Private LM / Colab tunnel / HF Space):
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    placeholder={p.id === "private-llama" ? "https://xxxx.trycloudflare.com/v1 or http://192.168.1.10:8080/v1" : "https://your-space.hf.space/v1"}
                    value={customUrl}
                    onChange={(e) => setCustomEndpoints((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    style={{ flex: 1, padding: 4, fontSize: 12 }}
                  />
                  <button onClick={() => saveCustomEndpoint(p.id, customEndpoints[p.id] || "")} style={{ fontSize: 12 }}>Save URL</button>
                  {customUrl && <button onClick={() => saveCustomEndpoint(p.id, "")} style={{ fontSize: 12 }}>Clear</button>}
                </div>
                {customUrl && <p style={{ fontSize: 11, color: "#06a", margin: "4px 0 0 0" }}>Will use: {customUrl} (SSRF guard allows private IPs for this provider when custom URL set)</p>}
                {p.id === "private-llama" && !customUrl && <p style={{ fontSize: 11, color: "#666" }}>For Android Private LM: run your LM app, then in Termux run `cloudflared tunnel --url http://localhost:8080`, copy https://...trycloudflare.com/v1 here, or use direct http://192.168.x.x:port/v1 with Allow Private toggle.</p>}
              </div>
            )}
          </div>
        );
      })}

      <button onClick={savePrefs} style={{ padding: "8px 16px", fontWeight: 600 }}>Save preferences</button>

      <h2 style={{ fontSize: 16, marginTop: 20 }}>Role assignments (PTM = main answer, VCM = verifier, FCM = fast draft)</h2>
      <p style={{ fontSize: 12, color: "#666" }}>Chat will use these roles. If not set, it falls back to first available provider with key.</p>
      {(["ptm", "vcm", "fcm"] as Role[]).map((role) => {
        const current = roles[role];
        const display = current ? `${current.provider_id} / ${current.model_id}` : "— none —";
        return (
          <div key={role} style={{ marginBottom: 8, padding: 8, border: "1px solid #eee", borderRadius: 6 }}>
            <strong>{role.toUpperCase()}</strong> — currently: <span style={{ background: current ? "#e6ffe6" : "#ffe6e6", padding: "2px 6px", borderRadius: 4 }}>{display}</span>
            <br />
            <select
              value={current ? `${current.provider_id}:${current.model_id}` : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return setRole(role, "", "");
                const idx = v.lastIndexOf(":");
                // model may contain colon, so split from first colon after provider
                const provider_id = v.split(":")[0];
                // actually provider_id never contains colon, model may contain colon, so we need to split at first colon
                const sep = v.indexOf(":");
                const pid = v.slice(0, sep);
                const mid = v.slice(sep + 1);
                setRole(role, pid, mid);
              }}
              style={{ marginTop: 4, minWidth: 300 }}
            >
              <option value="">— none —</option>
              {selectable.flatMap((p) =>
                p.models.map((m) => (
                  <option key={`${p.id}:${m}`} value={`${p.id}:${m}`}>
                    {p.id} / {m}
                  </option>
                )),
              )}
            </select>
          </div>
        );
      })}

      {status ? <p style={{ background: "#e6f7ff", padding: 8, borderRadius: 4 }}>{status}</p> : null}
    </section>
  );
}
