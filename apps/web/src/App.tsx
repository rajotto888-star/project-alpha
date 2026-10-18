import { useEffect, useRef, useState } from "react";
import { Vault } from "./lib/vault";
import { startGoogleLogin, autoLogin, logout } from "./lib/authClient";
import { Chat } from "./pages/Chat";
import { ProviderSettings } from "./components/ProviderSettings";
import { KeysPanel } from "./components/KeysPanel";

type Tab = "chat" | "providers" | "keys";

export function App() {
  const [vault] = useState(() => new Vault());
  const [unlocked, setUnlocked] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const passphraseMem = useRef("");
  const [createConfirm, setCreateConfirm] = useState(false);
  const [autoLoggedIn, setAutoLoggedIn] = useState(false);

  // AUTO-LOGIN on mount with pass 123456
  useEffect(() => {
    (async () => {
      const res = await autoLogin("123456");
      if (res.ok) {
        setAutoLoggedIn(true);
        setAuthNotice("Auto-login success (default-user)");
      } else {
        setAutoLoggedIn(true);
      }
    })();
  }, []);

  async function handleSignIn() {
    setAuthNotice(null);
    const result = await startGoogleLogin();
    if (result.ok && result.url) {
      window.location.assign(result.url);
      return;
    }
    setAuthNotice(result.error ?? "Sign-in failed.");
  }

  async function handleAutoLogin() {
    setAuthNotice(null);
    const res = await autoLogin("123456");
    if (res.ok) {
      setAutoLoggedIn(true);
      setAuthNotice("Auto-login success");
    } else {
      setAuthNotice(res.error ?? "Auto-login failed");
    }
  }

  async function handleSignOut() {
    setAuthNotice(null);
    await logout();
    setAuthNotice("Signed out.");
    setAutoLoggedIn(false);
  }

  async function handleUnlock() {
    setNotice(null);
    const ok = await vault.unlock(passphrase);
    if (ok) {
      passphraseMem.current = passphrase;
      setUnlocked(true);
      setPassphrase("");
    } else {
      setNotice("Could not unlock the vault with that passphrase.");
    }
  }

  async function handleCreate() {
    setNotice(null);
    const exists = await vault.hasVault();
    if (exists && !createConfirm) {
      setCreateConfirm(true);
      setNotice(
        "A vault already exists — use Unlock instead. A new vault starts empty and replaces the saved keys.",
      );
      return;
    }
    passphraseMem.current = passphrase;
    vault.createNew(passphrase);
    setCreateConfirm(false);
    setUnlocked(true);
    setPassphrase("");
  }

  function handleLock() {
    vault.lock();
    passphraseMem.current = "";
    setCreateConfirm(false);
    setUnlocked(false);
  }

  useEffect(() => {
    document.title = unlocked ? "Project Alpha" : "Project Alpha — locked";
  }, [unlocked]);

  if (!unlocked) {
    return (
      <main style={{ maxWidth: 480, margin: "80px auto", fontFamily: "system-ui, sans-serif" }}>
        <h1>Project Alpha</h1>
        <p>
          Your provider keys live only in this browser, encrypted with AES-GCM. Nothing is ever
          sent to or stored on the server.
        </p>
        <p style={{ fontSize: 12, color: "#666" }}>
          Auto-login: {autoLoggedIn ? "✅ default-user (123456)" : "⏳ connecting..."} {authNotice ? `- ${authNotice}` : ""}
        </p>
        <input
          type="password"
          value={passphrase}
          placeholder="Vault passphrase"
          onChange={(e) => {
            setPassphrase(e.target.value);
            setCreateConfirm(false);
          }}
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleUnlock} disabled={!passphrase}>Unlock</button>
          <button onClick={handleCreate} disabled={!passphrase}>Create new vault</button>
        </div>
        {notice ? <p role="alert">{notice}</p> : null}
        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={handleAutoLogin}>Auto-login (123456)</button>
          <button onClick={handleSignIn}>Sign in with Google</button>
          <button onClick={handleSignOut}>Sign out</button>
        </div>
        {authNotice ? <p style={{ fontSize: 12 }}>{authNotice}</p> : null}
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Project Alpha</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ fontSize: 12, background: "#e6ffe6", padding: "4px 8px", borderRadius: 4 }}>
            {autoLoggedIn ? "default-user" : "guest"} | Auto-login 123456
          </span>
          <button onClick={handleSignIn}>Sign in with Google</button>
          <button onClick={handleSignOut}>Sign out</button>
          <button onClick={handleLock}>Lock vault</button>
        </div>
      </header>
      {authNotice ? <p style={{ fontSize: 12, color: "#666" }}>{authNotice}</p> : null}
      <nav style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab("chat")} style={{ fontWeight: tab === "chat" ? "bold" : "normal" }}>Chat</button>
        <button onClick={() => setTab("providers")} style={{ fontWeight: tab === "providers" ? "bold" : "normal" }}>Providers</button>
        <button onClick={() => setTab("keys")} style={{ fontWeight: tab === "keys" ? "bold" : "normal" }}>Keys</button>
      </nav>
      {tab === "chat" ? <Chat vault={vault} /> : null}
      {tab === "providers" ? <ProviderSettings /> : null}
      {tab === "keys" ? <KeysPanel vault={vault} passphraseRef={passphraseMem} /> : null}
    </main>
  );
}
