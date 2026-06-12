/**
 * Qwen (通义千问) client — Alibaba Cloud's LLM via DashScope API.
 * Uses OpenAI-compatible endpoint.
 */
import type { AIRequestOptions, AIResponse } from "./types";
import { proxyFetch, combineSignals } from "./proxy-fetch";
import { fetchWithRetry } from "@/lib/retry-fetch";
import { getEnv } from "@/lib/env";

const QWEN_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";

function getApiKey(): string {
  const key = getEnv("QWEN_API_KEY");
  if (!key) throw new Error("QWEN_API_KEY not set");
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
  const messages: Array<{ role: string; content: unknown }> = [];
  if (options.system) {
    // Use cache_control for system prompts > ~1024 tokens (90% cost reduction on cache hit)
    if (options.system.length > 3000) {
      messages.push({
        role: "system",
        content: [{ type: "text", text: options.system, cache_control: { type: "ephemeral" } }],
      });
    } else {
      messages.push({ role: "system", content: options.system });
    }
  }
  for (const m of options.messages) {
    if (m.role === "system") continue;
    messages.push({ role: m.role, content: m.content });
  }

  const body: Record<string, unknown> = {
    model: "qwen-plus",
    messages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.3,
  };

  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  return body;
}

export async function callQwen(options: AIRequestOptions): Promise<AIResponse> {
  const apiKey = getApiKey();
  const body = buildBody(options, false);

  const res = await fetchWithRetry(
    `${QWEN_BASE}/chat/completions`,
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
    throw new Error(`Qwen API error ${res.status}: ${errText.slice(0, 300)}`);
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

export async function* streamQwen(
  options: AIRequestOptions
): AsyncGenerator<string, AIResponse> {
  const apiKey = getApiKey();
  const body = buildBody(options, true);

  // Streaming: caller signal + 300s cap — streams can take minutes but must not hang forever
  const res = await proxyFetch(`${QWEN_BASE}/chat/completions`, {
    method: "POST",
    headers: baseHeaders(apiKey),
    body: JSON.stringify(body),
    signal: combineSignals(options.signal, options.timeoutMs ?? 300_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Qwen stream error ${res.status}: ${errText.slice(0, 300)}`);
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

  return { content: fullText, provider: options.provider, model: "qwen-plus", usage };
}
