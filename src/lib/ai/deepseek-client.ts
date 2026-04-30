/**
 * DeepSeek client — supports R1 (reasoner) and V4 (chat/flash/pro) models.
 *
 * Optimizations:
 * - Connection keep-alive for reduced latency on concurrent calls
 * - stream_options.include_usage for streaming token tracking
 * - noThinking disables reasoning tokens (~2x faster for structured extraction)
 * - Prefix caching: system prompt placed first for automatic DeepSeek cache hits
 */
import type { AIRequestOptions, AIResponse } from "./types";
import { PROVIDER_MODELS } from "./types";
import { proxyFetch } from "./proxy-fetch";
import { getEnv } from "@/lib/env";

const DEEPSEEK_BASE = "https://api.deepseek.com";

function getApiKey(): string {
  const key = getEnv("DEEPSEEK_API_KEY");
  if (!key) throw new Error("DEEPSEEK_API_KEY not set");
  return key;
}

function getModel(provider: string): string {
  return PROVIDER_MODELS[provider as keyof typeof PROVIDER_MODELS] ?? "deepseek-chat";
}

function isReasonerModel(model: string): boolean {
  return model === "deepseek-reasoner";
}

/** Shared headers — keep-alive for connection reuse across concurrent calls */
function baseHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    Connection: "keep-alive",
  };
}

/** Build common request body for both streaming and non-streaming calls */
function buildBody(options: AIRequestOptions, model: string, isReasoner: boolean, stream: boolean) {
  const messages: Array<{ role: string; content: string }> = [];
  if (options.system) messages.push({ role: "system", content: options.system });
  for (const m of options.messages) {
    if (m.role === "system") continue;
    messages.push({ role: m.role, content: m.content });
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: options.maxTokens ?? (isReasoner ? 8192 : 4096),
  };

  if (stream) {
    body.stream = true;
    // Request usage stats in the final streaming chunk
    body.stream_options = { include_usage: true };
  }

  if (!isReasoner) {
    body.temperature = options.temperature ?? 0.3;
    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }
    // Disable thinking for structured extraction — skips reasoning tokens, ~2x faster
    if (options.noThinking) {
      body.thinking = { type: "disabled" };
    }
  }

  return body;
}

export async function callDeepSeek(options: AIRequestOptions): Promise<AIResponse> {
  const apiKey = getApiKey();
  const model = getModel(options.provider);
  const isReasoner = isReasonerModel(model);

  const body = buildBody(options, model, isReasoner, false);

  const res = await proxyFetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: baseHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string; reasoning_content?: string } }>;
    model: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? "",
    thinking: data.choices[0]?.message?.reasoning_content || undefined,
    provider: options.provider,
    model: data.model,
    usage: data.usage
      ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens ?? 0 }
      : undefined,
  };
}

export async function* streamDeepSeek(
  options: AIRequestOptions
): AsyncGenerator<string, AIResponse> {
  const apiKey = getApiKey();
  const model = getModel(options.provider);
  const isReasoner = isReasonerModel(model);

  const body = buildBody(options, model, isReasoner, true);

  const res = await proxyFetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: baseHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek stream error ${res.status}: ${errText.slice(0, 300)}`);
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

        // Content delta
        const text = parsed.choices[0]?.delta?.content ?? "";
        if (text) {
          fullText += text;
          yield text;
        }

        // Usage stats appear in the final chunk when stream_options.include_usage is set
        if (parsed.usage) {
          usage = {
            inputTokens: parsed.usage.prompt_tokens,
            outputTokens: parsed.usage.completion_tokens ?? 0,
          };
        }
      } catch { /* skip malformed chunks */ }
    }
  }

  return { content: fullText, provider: options.provider, model, usage };
}
