// FILE: apps/web/src/components/BYOEEndpointInput.tsx (NEW — v1.1+ true BYOE, NOT part of Lite)
// Placeholder — deferred. True BYOE (user-supplied endpoint) needs UI for custom baseUrl + validation.
// BYOE Lite (step 129) does NOT use this component; KeysPanel auto-picks fixed catalog entries.
// When v1.1+ lands, this component will allow user to input baseUrl, validate via ssrfGuard, etc.

import { useState } from "react";

interface Props {
  onSave: (baseUrl: string) => void;
}

export function BYOEEndpointInput({ onSave }: Props) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") throw new Error("only https:// allowed");
      onSave(url);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="byoe-input">
      <p style={{ fontSize: 12, color: "#666" }}>v1.1+ placeholder — true BYOE endpoint input (not used in Lite)</p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-gateway.com/v1" />
      <button onClick={handleSave}>Save endpoint</button>
      {error && <div style={{ color: "red" }}>{error}</div>}
    </div>
  );
}
