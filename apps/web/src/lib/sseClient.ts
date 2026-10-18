import { fetchEventSource } from "@microsoft/fetch-event-source";
import { isSSEEvent } from "@project-alpha/shared";
import type { SSEEvent } from "@project-alpha/shared";

export interface StreamHandlers {
  onEvent: (ev: SSEEvent) => void;
  onDone?: () => void;
  onTerminalError?: (ev: SSEEvent) => void;
  onNetworkError?: (err: unknown) => void;
}

// BUG 4 fix: `terminated` flag suppresses any frame that arrives after a
// terminal error or done — abort() alone does not discard already-buffered
// SSE frames sitting in the parser.
export function streamChat(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  handlers: StreamHandlers,
): { abort: () => void } {
  const controller = new AbortController();
  let terminated = false;

  fetchEventSource(url, {
    method: "POST",
    credentials: "include", // cookie-only session auth — never Authorization header
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: controller.signal,
    async onopen() {
      // response already validated by the browser fetch layer
    },
    onmessage(msg) {
      if (terminated) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (!isSSEEvent(parsed)) return;
      handlers.onEvent(parsed);
      if (parsed.type === "error" && !parsed.recoverable) {
        terminated = true;
        handlers.onTerminalError?.(parsed);
        controller.abort();
        return;
      }
      if (parsed.type === "done") {
        terminated = true;
        handlers.onDone?.();
      }
    },
    onerror(err) {
      if (terminated) throw err; // stop retrying, propagate to close the loop
      handlers.onNetworkError?.(err);
      throw err;
    },
  }).catch(() => {
    // errors already surfaced via onerror/onNetworkError
  });

  return {
    abort: () => {
      terminated = true;
      controller.abort();
    },
  };
}
