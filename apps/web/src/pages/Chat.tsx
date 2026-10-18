import { useRef, useState } from "react";
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
  const abortRef = useRef<{ abort: () => void } | null>(null);

  function runStream(messageList: Message[]) {
    setLoading(true);
    setAssistantText("");
    setPatch(null);
    setTerminalErrorMsg(null);

    // Ephemeral key precedence: header first (if it fits under the size
    // threshold), otherwise fall back to body keys. Never persisted server-side.
    const headerValue = vault.buildEphemeralHeader();
    const headers: Record<string, string> = {};
    let bodyKeys: Record<string, string> | undefined;
    if (headerValue) {
      headers["X-EPHEMERAL-KEYS"] = headerValue;
    } else {
      bodyKeys = vault.getKeysForBody();
    }

    const body = {
      messages: messageList,
      // BYOE Lite (step 129): selectable now = openai, groq, private-llama, private-smollm
      // PTM/VCM default to openai/groq for first launch; switch to private-llama after Keys saved.
      // To enable fast-draft: fcm: { provider_id: "openrouter", model_id: "qwen/qwen-2.5-7b-instruct-free" }
      // LEVEL-1 3-model pipeline: PTM draft (openrouter fast), VCM verify (groq strong), FCM final format (openrouter cheap)
      // Switch to private-llama when gateway healthy: ptm private-llama llama-3.2-70b
      manual_providers: {
        ptm: { provider_id: "groq", model_id: "openai/gpt-oss-20b" },
        vcm: { provider_id: "openrouter", model_id: "deepseek/deepseek-r1-free" },
        fcm: { provider_id: "openrouter", model_id: "qwen/qwen-2.5-7b-instruct-free" },
      },
      merge_style: "hybrid",
      enable_fast_draft: true,
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

