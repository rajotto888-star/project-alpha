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

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Provider preferences</h2>
      {selectable.length === 0 ? <p>No selectable providers returned by the catalog.</p> : null}

      {selectable.map((p) => {
        const row = prefs.find((r) => r.provider_id === p.id);
        return (
          <div key={p.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <label style={{ display: "block", marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={!!row?.enabled}
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
              <strong>{p.id}</strong>
            </label>

            <label style={{ display: "block" }}>
              Model{" "}
              <select
                value={row?.selected_model ?? ""}
                onChange={(e) =>
                  setPrefs((prev) =>
                    prev.map((x) => (x.provider_id === p.id ? { ...x, selected_model: e.target.value } : x)),
                  )
                }
              >
                <option value="">—</option>
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
                  setPrefs((prev) =>
                    prev.map((x) => (x.provider_id === p.id ? { ...x, priority_mode: e.target.value } : x)),
                  )
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
              />
            </label>
          </div>
        );
      })}

      <button onClick={savePrefs}>Save preferences</button>

      <h2 style={{ fontSize: 16, marginTop: 20 }}>Role assignments</h2>
      {(["ptm", "vcm", "fcm"] as Role[]).map((role) => {
        const current = roles[role];
        return (
          <div key={role} style={{ marginBottom: 8 }}>
            <strong>{role.toUpperCase()}</strong>{" "}
            <select
              value={current ? `${current.provider_id}:${current.model_id}` : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return setRole(role, "", "");
                const idx = v.indexOf(":");
                setRole(role, v.slice(0, idx), v.slice(idx + 1));
              }}
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

      {status ? <p>{status}</p> : null}
    </section>
  );
}
