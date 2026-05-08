/**
 * Batch small tokens from an async generator into larger chunks.
 *
 * streamAI yields individual tokens (1-3 chars each), which causes
 * excessive SSE events and JSON overhead. This utility accumulates
 * tokens and yields every `batchSize` characters, dramatically
 * reducing event count (typically 10-20x fewer events).
 */
export async function* batchStream(
  stream: AsyncGenerator<string, unknown>,
  batchSize = 20
): AsyncGenerator<string> {
  let buf = "";
  for await (const token of stream) {
    buf += token;
    if (buf.length >= batchSize) {
      yield buf;
      buf = "";
    }
  }
  if (buf) yield buf;
}
