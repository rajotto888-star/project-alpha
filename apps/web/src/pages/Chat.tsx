import { useEffect, useRef, useState } from "react";
import type { Correction, Message, PatchPayload } from "@project-alpha/shared";
import { streamChat } from "../lib/sseClient";
import { ApplyCorrections } from "../components/ApplyCorrections";
import { Vault } from "../lib/vault";

interface ChatInputBarProps {
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

function ChatInputBar({ disabled, onSend, onStop }: ChatInputBarProps) {
  const [text, setText] = useState("");
  return (
    <div className="chat-input-bar">
      <input
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a message..."
      />
      <button
        type="button"
        disabled={disabled || text.trim().length === 0}
        onClick={() => {
          onSend(text);
          setText("");
        }}
      >
        Send
      </button>
      <button type="button" disabled={!disabled} onClick={onStop}>
        Stop
      </button>
    </div>
  );
}

export function Chat({ vault }: { vault: Vault }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [assistantText, setAssistantText] = useState("");
  const [patch, setPatch] = useState<PatchPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [terminalErrorMsg, setTerminalErrorMsg] = useState<string | null>(null);
  const [roles, setRoles] = useState<{ ptm: { provider_id: string; model_id: string } | null; vcm: { provider_id: string; model_id: string } | null; fcm: { provider_id: string; model_id: string } | null }>({ ptm: null, vcm: null, fcm: null });
  const abortRef = useRef<{ abort: () => void } | null>(null);

  // Load roles from API - fixes "chat reply asce na" when roles not set
  useEffect(() => {
    fetch("/api/providers/prefs", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.roles) setRoles(data.roles);
      })
      .catch(() => {});
  }, []);

  function runStream(messageList: Message[]) {
    setLoading(true);
    setAssistantText("");
    setPatch(null);
    setTerminalErrorMsg(null);

    const availableKeys = vault.listProviders();
    if (availableKeys.length === 0) {
      setLoading(false);
      setTerminalErrorMsg("No provider keys saved. Go to Keys tab and add at least groq or openrouter key.");
      return;
    }

    // Ephemeral key precedence: header first (if it fits under the size threshold), otherwise fall back to body keys. Never persisted server-side.
    const headerValue = vault.buildEphemeralHeader();
    const headers: Record<string, string> = {};
    let bodyKeys: Record<string, string> | undefined;
    if (headerValue) {
      headers["X-EPHEMERAL-KEYS"] = headerValue;
    } else {
      bodyKeys = vault.getKeysForBody();
    }

    // Custom endpoints from localStorage (Android Private LM / Colab tunnel / HF Space)
    try {
      const customEndpoints = JSON.parse(localStorage.getItem("custom_endpoints") || "{}");
      if (Object.keys(customEndpoints).length > 0) {
        headers["X-CUSTOM-ENDPOINTS"] = btoa(JSON.stringify(customEndpoints));
      }
    } catch {}

    // Determine manual_providers dynamically - fixes chat not replying when hardcoded providers missing keys
    let ptm = roles.ptm;
    let vcm = roles.vcm;
    let fcm = roles.fcm;

    // Fallback logic: use first available key provider if role not set or key missing
    const firstAvailable = availableKeys[0];
    const getFallback = (preferred: { provider_id: string; model_id: string } | null, fallbackModel: string) => {
      if (preferred && availableKeys.includes(preferred.provider_id)) return preferred;
      // Find a provider that has key and has models
      if (availableKeys.includes("groq")) return { provider_id: "groq", model_id: "llama-3.3-70b-versatile" };
      if (availableKeys.includes("openrouter")) return { provider_id: "openrouter", model_id: "deepseek/deepseek-r1-free" };
      if (availableKeys.includes("openai")) return { provider_id: "openai", model_id: "gpt-4o-mini" };
      if (availableKeys.includes("private-llama")) return { provider_id: "private-llama", model_id: "llama-3.2-3b-instruct" };
      if (availableKeys.includes("hf-space")) return { provider_id: "hf-space", model_id: "smollm2-1.7b-instruct" };
      // Last resort: use first available with its first model (will be validated server-side)
      return { provider_id: firstAvailable, model_id: fallbackModel };
    };

    const finalPtm = getFallback(ptm, "llama-3.3-70b-versatile");
    const finalVcm = getFallback(vcm, "llama-3.3-70b-versatile");
    // FCM is optional - only use if key available
    const finalFcm = fcm && availableKeys.includes(fcm.provider_id) ? fcm : null;

    const body = {
      messages: messageList,
      manual_providers: {
        ptm: finalPtm,
        vcm: finalVcm,
        fcm: finalFcm,
      },
      merge_style: "hybrid",
      enable_fast_draft: !!finalFcm,
      router_mode: "manual" as const,
      ephemeral_keys: bodyKeys,
    };

    let liveAnswer = "";

    abortRef.current = streamChat("/api/chat/stream", body, headers, {
      onEvent: (ev) => {
        if (ev.type === "chunk" && ev.source === "ptm") {
          liveAnswer += ev.delta;
          setAssistantText(liveAnswer);
        }
        if (ev.type === "patch") {
          setPatch(ev);
        }
      },
      onDone: () => {
        setLoading(false);
        setMessages((prev) => [...prev, { role: "assistant", content: liveAnswer }]);
      },
      onTerminalError: (ev) => {
        setLoading(false);
        if (ev.type === "error") setTerminalErrorMsg(ev.message);
      },
      onNetworkError: () => {
        setLoading(false);
        setTerminalErrorMsg("network error");
      },
    });
  }

  function handleSend(text: string) {
    const nextMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    runStream(nextMessages);
  }

  function handleStop() {
    abortRef.current?.abort();
    setLoading(false);
  }

  function handleRerun(newMessages: Message[]) {
    // Stateless rerun: a brand-new /api/chat/stream call, server never rewrites in place.
    runStream(newMessages);
  }

  const inlineCorrections: Correction[] | null = patch?.mode === "patch" ? patch.corrections : null;

  return (
    <div className="chat-page">
      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`message message-${m.role}`}>
            {m.content}
          </div>
        ))}
        {assistantText && <div className="message message-assistant streaming">{assistantText}</div>}
      </div>

      {inlineCorrections && (
        <div className="inline-corrections">
          <p>Verifier suggested minor corrections:</p>
          <ul>
            {inlineCorrections.map((c, i) => (
              <li key={i}>
                [{c.severity}] {c.issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {patch?.mode === "replace" && (
        <ApplyCorrections
          corrections={patch.corrections}
          originalMessages={messages}
          assistantAnswer={assistantText}
          onRerun={handleRerun}
        />
      )}

      {terminalErrorMsg && <div className="terminal-error">{terminalErrorMsg}</div>}

      <ChatInputBar disabled={loading} onSend={handleSend} onStop={handleStop} />
    </div>
  );
}

