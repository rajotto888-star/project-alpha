export interface MockStreamOptions {
  splitAcrossBoundaries?: boolean;
  /**
   * Emits the trailing usage frame a provider sends when the request carried
   * `stream_options.include_usage`: `choices: []` plus a populated `usage`.
   */
  totalTokens?: number;
}

function sseFrame(deltaOrRole: { delta?: string; role?: string }): string {
  const choice = deltaOrRole.role
    ? { delta: { role: deltaOrRole.role } }
    : { delta: { content: deltaOrRole.delta ?? "" } };
  return `data: ${JSON.stringify({ choices: [choice] })}\n\n`;
}

export function mockOpenAIStream(
  chunks: Array<{ delta?: string; role?: string }>,
  opts: MockStreamOptions = {},
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const usageFrame =
        opts.totalTokens === undefined
          ? ""
          : `data: ${JSON.stringify({ choices: [], usage: { total_tokens: opts.totalTokens } })}\n\n`;
      const full = chunks.map(sseFrame).join("") + usageFrame + "data: [DONE]\n\n";
      if (opts.splitAcrossBoundaries) {
        const bytes = encoder.encode(full);
        for (let i = 0; i < bytes.length; i += 3) {
          controller.enqueue(bytes.slice(i, i + 3));
        }
      } else {
        controller.enqueue(encoder.encode(full));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

export function mockOpenAIFailure(status: number): Response {
  return new Response(JSON.stringify({ error: "upstream failure" }), { status });
}

export function mockSlowStream(delayMs: number): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await new Promise((r) => setTimeout(r, delayMs));
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "late" } }] })}\n\n`),
      );
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
