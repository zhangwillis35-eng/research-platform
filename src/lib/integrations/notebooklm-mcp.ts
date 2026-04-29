/**
 * NotebookLM MCP HTTP client.
 *
 * Connects to the local notebooklm-mcp server running in HTTP mode.
 * Start server: notebooklm-mcp --transport http --port 27126 --query-timeout 120
 *
 * Uses MCP JSON-RPC over HTTP (streamable-http protocol).
 * Bypasses proxy for localhost connections.
 */

const MCP_URL = "http://127.0.0.1:27126/mcp";
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

let sessionId: string | null = null;
let initialized = false;

/**
 * Initialize the MCP session (required before any tool call).
 */
async function ensureInitialized(): Promise<void> {
  if (initialized && sessionId) return;

  // Initialize
  const initRes = await fetch(MCP_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "scholarflow", version: "1.0" },
      },
    }),
    // @ts-expect-error - Node.js fetch supports this
    dispatcher: undefined, // bypass proxy
  });

  // Extract session ID from response headers
  const sid = initRes.headers.get("mcp-session-id");
  if (sid) sessionId = sid;

  // Read the SSE response to consume it
  await initRes.text();

  // Send initialized notification
  await fetch(MCP_URL, {
    method: "POST",
    headers: {
      ...HEADERS,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });

  initialized = true;
  console.log(`[notebooklm-mcp] Initialized, session: ${sessionId}`);
}

/**
 * Call an MCP tool via JSON-RPC.
 */
async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  await ensureInitialized();

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      ...HEADERS,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(120000), // 2 min timeout for queries
  });

  const rawText = await res.text();

  // Parse SSE response — extract JSON from "data:" lines
  const dataLines = rawText
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice(6));

  for (const line of dataLines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.result?.content?.[0]?.text) {
        return parsed.result.content[0].text;
      }
      if (parsed.result?.isError) {
        throw new Error(parsed.result.content?.[0]?.text || "MCP tool error");
      }
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }

  throw new Error("No valid response from NotebookLM MCP");
}

// ─── Public API ──────────────────────────────────

export interface NotebookLMQueryResult {
  answer: string;
  conversationId?: string;
  citations?: Record<string, string>;
}

/**
 * Check if NotebookLM MCP server is available.
 */
export async function checkMCPHealth(): Promise<{
  available: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "scholarflow-health", version: "1.0" },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { available: false, error: `HTTP ${res.status}` };
    return { available: true };
  } catch (err) {
    return {
      available: false,
      error: `NotebookLM MCP 未运行。启动命令: notebooklm-mcp --transport http --port 27126`,
    };
  }
}

/**
 * Query a NotebookLM notebook.
 */
export async function queryNotebook(
  notebookId: string,
  query: string,
  conversationId?: string
): Promise<NotebookLMQueryResult> {
  const args: Record<string, unknown> = {
    notebook_id: notebookId,
    query,
  };
  if (conversationId) {
    args.conversation_id = conversationId;
  }

  const rawResult = await callTool("notebook_query", args);

  try {
    const parsed = JSON.parse(rawResult);
    return {
      answer: parsed.answer ?? rawResult,
      conversationId: parsed.conversation_id,
      citations: parsed.citations,
    };
  } catch {
    return { answer: rawResult };
  }
}

/**
 * List available notebooks.
 */
export async function listNotebooks(): Promise<
  Array<{ id: string; title: string }>
> {
  const rawResult = await callTool("notebook_list", {});
  try {
    const parsed = JSON.parse(rawResult);
    return parsed.notebooks ?? [];
  } catch {
    return [];
  }
}

/**
 * Run multiple queries against a notebook (for knowledge graph extraction).
 * Returns combined results.
 */
export async function batchQueryNotebook(
  notebookId: string,
  queries: Array<{ question: string; purpose: string }>
): Promise<string> {
  let conversationId: string | undefined;
  const answers: string[] = [];

  for (const q of queries) {
    try {
      const result = await queryNotebook(notebookId, q.question, conversationId);
      answers.push(`### ${q.purpose}\n\n${result.answer}`);
      conversationId = result.conversationId; // reuse session for context
    } catch (err) {
      console.error(`[notebooklm-mcp] Query failed: ${q.purpose}`, err);
      answers.push(`### ${q.purpose}\n\n(查询失败)`);
    }
  }

  return answers.join("\n\n---\n\n");
}
