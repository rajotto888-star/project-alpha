/**
 * sseClient tests — written against the CANONICAL apps/web/src/lib/sseClient.ts:
 *
 *   streamChat(url, body, headers, handlers): { abort: () => void }
 *   handlers = { onEvent(ev), onDone?(), onTerminalError?(ev), onNetworkError?(err) }
 *
 * Note onDone() carries NO argument — the done payload is observed through onEvent.
 * Every frame must carry a numeric `timestamp` to survive the shared isSSEEvent guard.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { streamChat } from "../src/lib/sseClient";

let n = 0;
const ev = (e: Record<string, unknown>) => ({ timestamp: Date.now() + n++, ...e });

function sseResponse(events: Array<Record<string, unknown>>, status = 200): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

function flush(ms = 40) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

afterEach(() => vi.unstubAllGlobals());

describe("streamChat request shape", () => {
  it("POSTs with credentials and forwards the ephemeral key header verbatim", async () => {
    const fetchMock = vi.fn(async () => sseResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const ctrl = streamChat(
      "/api/chat/stream",
      { messages: [{ role: "user", content: "hi" }] },
      { "X-EPHEMERAL-KEYS": "eyJvcGVuYWkiOiJzayJ9" },
      { onEvent: () => {} },
    );
    await flush();
    ctrl.abort();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe("/api/chat/stream");
    expect(init.method).toBe("POST");
    // LOCKED R5: the browser authenticates by cookie, never by an Authorization header
    expect(init.credentials).toBe("include");
    expect(init.headers["X-EPHEMERAL-KEYS"]).toBe("eyJvcGVuYWkiOiJzayJ9");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body).messages[0].content).toBe("hi");
  });

  it("exposes an abort() handle rather than the raw AbortController", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([])));
    const ctrl = streamChat("/api/chat/stream", {}, {}, { onEvent: () => {} });
    expect(typeof ctrl.abort).toBe("function");
    expect((ctrl as any).signal).toBeUndefined();
    ctrl.abort();
  });
});

describe("streamChat event dispatch", () => {
  it("delivers every valid frame to onEvent in stream order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          ev({ type: "meta", request_id: "r1" }),
          ev({ type: "phase", phase: "primary_answer", source: "ptm" }),
          ev({ type: "chunk", source: "ptm", index: 0, delta: "Hello " }),
          ev({ type: "chunk", source: "ptm", index: 1, delta: "world" }),
          ev({ type: "phase", phase: "verification" }),
          ev({ type: "verifier_json", result: { needs_correction: false, confidence: 99, corrections: [] } }),
          ev({ type: "done", final_verdict: "verified", token_usage: { vcm: 10 }, cost_estimate: 0 }),
        ]),
      ),
    );

    const seen: string[] = [];
    let done: any = null;
    let doneFired = 0;
    streamChat("/api/chat/stream", {}, {}, {
      onEvent: (e) => {
        seen.push(e.type);
        if (e.type === "done") done = e;
      },
      onDone: () => {
        doneFired += 1;
      },
    });
    await flush(80);

    expect(seen).toEqual(["meta", "phase", "chunk", "chunk", "phase", "verifier_json", "done"]);
    expect(doneFired).toBe(1); // onDone fires exactly once, with no payload
    expect(done.final_verdict).toBe("verified");
    expect(done.token_usage.vcm).toBe(10);
  });

  it("drops frames that fail the shared isSSEEvent guard without crashing the stream", async () => {
    const frames = [
      `data: ${JSON.stringify(ev({ type: "meta", request_id: "r1" }))}\n\n`,
      `data: ${JSON.stringify({ type: "meta", request_id: "no-timestamp" })}\n\n`, // no timestamp
      `data: ${JSON.stringify(ev({ type: "invented_event" }))}\n\n`, // unknown type
      `data: ${JSON.stringify(ev({ no_type: true }))}\n\n`, // missing type
      `data: not-json-at-all\n\n`, // malformed payload
      `data: ${JSON.stringify(ev({ type: "done", final_verdict: "verified" }))}\n\n`,
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(frames, { status: 200, headers: { "Content-Type": "text/event-stream" } })),
    );

    const seen: string[] = [];
    streamChat("/api/chat/stream", {}, {}, { onEvent: (e) => seen.push(e.type) });
    await flush(80);

    expect(seen).toEqual(["meta", "done"]);
  });
});

describe("Error handling", () => {
  it("LOCKED: a non-recoverable error fires onTerminalError and suppresses later frames", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          ev({ type: "meta", request_id: "r1" }),
          ev({ type: "error", error_code: "POLICY_BLOCKED", phase: "policy", recoverable: false }),
          ev({ type: "chunk", source: "ptm", index: 0, delta: "should never arrive" }),
        ]),
      ),
    );

    const seen: string[] = [];
    let terminal: any = null;
    streamChat("/api/chat/stream", {}, {}, {
      onEvent: (e) => seen.push(e.type),
      onTerminalError: (e) => {
        terminal = e;
      },
    });
    await flush(80);

    expect(terminal).not.toBeNull();
    expect(terminal.error_code).toBe("POLICY_BLOCKED");
    expect(terminal.recoverable).toBe(false);
    // the `terminated` flag suppressed the buffered post-error chunk
    expect(seen).toEqual(["meta", "error"]);
  });

  it("a RECOVERABLE error is delivered but does not terminate the stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          ev({ type: "meta", request_id: "r1" }),
          ev({ type: "error", error_code: "VCM_ALL_ATTEMPTS_FAILED", phase: "verification", recoverable: true }),
          ev({ type: "done", final_verdict: "unverified", vcm: null }),
        ]),
      ),
    );

    const seen: string[] = [];
    let terminal: any = null;
    let doneFired = 0;
    streamChat("/api/chat/stream", {}, {}, {
      onEvent: (e) => seen.push(e.type),
      onTerminalError: (e) => {
        terminal = e;
      },
      onDone: () => {
        doneFired += 1;
      },
    });
    await flush(80);

    expect(terminal).toBeNull(); // recoverable -> not terminal
    expect(seen).toEqual(["meta", "error", "done"]); // stream continued
    expect(doneFired).toBe(1);
  });

  it("reports a transport failure through onNetworkError", async () => {
    // fetch-event-source routes a rejecting fetch through onerror, which the
    // canonical client forwards to onNetworkError and then rethrows to stop retries.
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));

    let err: unknown = null;
    streamChat("/api/chat/stream", {}, {}, {
      onEvent: () => {},
      onNetworkError: (e) => {
        err = e;
      },
    });
    await flush(60);

    expect(err).toBeInstanceOf(TypeError);
  });

  it("abort() stops delivery of any further buffered frames", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          ev({ type: "meta", request_id: "r1" }),
          ev({ type: "chunk", source: "ptm", index: 0, delta: "a" }),
          ev({ type: "chunk", source: "ptm", index: 1, delta: "b" }),
        ]),
      ),
    );

    const seen: string[] = [];
    const ctrl = streamChat("/api/chat/stream", {}, {}, {
      onEvent: (e) => {
        seen.push(e.type);
        if (e.type === "meta") ctrl.abort(); // abort on the very first frame
      },
    });
    await flush(80);

    expect(seen[0]).toBe("meta");
    expect(seen.filter((t) => t === "chunk")).toEqual([]);
  });
});
