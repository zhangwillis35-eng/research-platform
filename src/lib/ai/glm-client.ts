/**
 * GLM (智谱清言) client — Zhipu AI's LLM.
 * Uses OpenAI-compatible endpoint.
 */
import type { AIRequestOptions, AIResponse } from "./types";
import { proxyFetch, combineSignals } from "./proxy-fetch";
import { fetchWithRetry } from "@/lib/retry-fetch";
import { getEnv } from "@/lib/env";

const GLM_BASE = "https://open.bigmodel.cn/api/paas/v4";

function getApiKey(): string {
  const key = getEnv("GLM_API_KEY");
  if (!key) throw new Error("GLM_API_KEY not set");
  return key;
}

function baseHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    Connection: "keep-alive",
  };
}

function buildBody(options: AIRequestOptions, stream: boolean) {
  const messages: Array<{ role: string; content: string }> = [];
  if (options.system) messages.push({ role: "system", content: options.system });
  for (const m of options.messages) {
    if (m.role === "system") continue;
    messages.push({ role: m.role, content: m.content });
  }

  const body: Record<string, unknown> = {
    model: "glm-4-plus",
    messages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.3,
  };

  if (stream) {
    body.stream = true;
  }

  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  return body;
}

export async function callGLM(options: AIRequestOptions): Promise<AIResponse> {
  const apiKey = getApiKey();
  const body = buildBody(options, false);

  const res = await fetchWithRetry(
    `${GLM_BASE}/chat/completions`,
    {
      method: "POST",
      headers: baseHeaders(apiKey),
      body: JSON.stringify(body),
    },
    {
      maxRetries: 3,
      retryOn: [429, 503],
      timeoutMs: options.timeoutMs ?? 60000,
      signal: options.signal,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GLM API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? "",
    provider: options.provider,
    model: data.model,
    usage: data.usage
      ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens ?? 0 }
      : undefined,
  };
}

export async function* streamGLM(
  options: AIRequestOptions
): AsyncGenerator<string, AIResponse> {
  const apiKey = getApiKey();
  const body = buildBody(options, true);

  // Streaming: caller signal + 300s cap — streams can take minutes but must not hang forever
  const res = await proxyFetch(`${GLM_BASE}/chat/completions`, {
    method: "POST",
    headers: baseHeaders(apiKey),
    body: JSON.stringify(body),
    signal: combineSignals(options.signal, options.timeoutMs ?? 300_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GLM stream error ${res.status}: ${errText.slice(0, 300)}`);
  }

  let fullText = "";
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  const reader = res.body as unknown as AsyncIterable<Buffer | Uint8Array>;
  let buffer = "";

  for await (const chunk of reader) {
    buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr) as {
          choices: Array<{ delta: { content?: string } }>;
          usage?: { prompt_tokens: number; completion_tokens: number };
        };
        const text = parsed.choices[0]?.delta?.content ?? "";
        if (text) { fullText += text; yield text; }
        if (parsed.usage) {
          usage = { inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens ?? 0 };
        }
      } catch { /* skip */ }
    }
  }

  return { content: fullText, provider: options.provider, model: "glm-4-plus", usage };
}
