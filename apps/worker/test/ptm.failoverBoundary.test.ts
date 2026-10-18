import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runPtmWithFailover } from "../src/adapters/ptmFailover";
import { mockOpenAIStream } from "./utils/mockProvider";

/**
 * Streams `chunks` and only THEN fails, on a later tick.
 * Erroring synchronously inside start() discards the queued chunks in Node's
 * streams implementation, which made the "after first emitted chunk" case
 * untestable (no chunk was ever delivered).
 */
function mockErrorStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`));
      }
      setTimeout(() => {
        try {
          controller.error(new Error("connection reset"));
        } catch {
          /* already closed */
        }
      }, 0);
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("PTM failover boundary (LOCKED)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("after first EMITTED chunk -> terminal, no retry", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => mockErrorStream(["Hello"]));
    vi.stubGlobal("fetch", fetchMock);

    const emitted: string[] = [];
    await expect(
      runPtmWithFailover({
        providerId: "openai",
        modelId: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        ephemeralKeys: { openai: "sk-test" },
        parentSignal: new AbortController().signal,
        maxAttempts: 2,
        onChunk: async (delta: string) => { emitted.push(delta); },
      }),
    ).rejects.toThrow();

    expect(emitted).toEqual(["Hello"]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // LOCKED: no retry after emitted chunk
  });

  it("fails BEFORE any chunk -> retry allowed, second attempt succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockErrorStream([]))
      .mockResolvedValueOnce(mockOpenAIStream([{ delta: "Recovered" }]));
    vi.stubGlobal("fetch", fetchMock);

    const emitted: string[] = [];
    await runPtmWithFailover({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      ephemeralKeys: { openai: "sk-test" },
      parentSignal: new AbortController().signal,
      maxAttempts: 2,
      onChunk: async (delta: string) => { emitted.push(delta); },
    });

    expect(emitted).toEqual(["Recovered"]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one retry consumed
  });
});
