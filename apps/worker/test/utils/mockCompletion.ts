/**
 * Non-streaming chat-completion mock.
 *
 * The canonical VCM adapter calls the upstream with `stream: false` and reads
 * `res.json()`, so the SSE helpers in mockProvider.ts cannot serve it. This is
 * additive — it does not alter the canonical mockProvider.ts.
 */
export function mockOpenAICompletion(
  content: string,
  opts: { status?: number; totalTokens?: number } = {},
): Response {
  const status = opts.status ?? 200;
  if (status !== 200) {
    return new Response(JSON.stringify({ error: "upstream failure" }), { status });
  }
  const body: Record<string, unknown> = {
    choices: [{ message: { role: "assistant", content } }],
  };
  if (typeof opts.totalTokens === "number") {
    body.usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: opts.totalTokens };
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
