/**
 * Client-side STORM API helper — consumes SSE stream from /api/integrations/storm.
 * Handles keepalive pings and extracts the result.
 */
export async function callStormAPI(
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ article?: string; combined?: string; status: string; error?: string }> {
  const res = await fetch("/api/integrations/storm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return { status: "error", error: err.error ?? `HTTP ${res.status}` };
  }

  // JSON response (for "check" action)
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await res.json();
  }

  // SSE response (for "analyze" action)
  if (!res.body) return { status: "error", error: "No response body" };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result: Record<string, unknown> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === "result") {
          result = evt;
        } else if (evt.type === "error") {
          return { status: "error", error: evt.error };
        }
        // ping events are silently ignored
      } catch { /* skip */ }
    }
  }

  return {
    article: result.article as string | undefined,
    combined: result.article as string | undefined, // alias
    status: (result.status as string) ?? "success",
    error: result.error as string | undefined,
  };
}
