/**
 * DeepSeek client — supports both R1 (reasoner) and V3 (chat) models.
 *
 * - deepseek-reasoner: deep chain-of-thought reasoning, slow (~10-30s)
 * - deepseek-chat (V3): fast structured extraction, supports temperature + JSON mode (~1-3s)
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

export async function callDeepSeek(options: AIRequestOptions): Promise<AIResponse> {
  const apiKey = getApiKey();
  const model = getModel(options.provider);
  const isReasoner = isReasonerModel(model);

  const messages: Array<{ role: string; content: string }> = [];
  if (options.system) messages.push({ role: "system", content: options.system });
  for (const m of options.messages) {
    if (m.role === "system") continue;
    messages.push({ role: m.role, content: m.content });
  }

  // Build request body — R1 doesn't support temperature/response_format/thinking
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: options.maxTokens ?? (isReasoner ? 8192 : 4096),
  };

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

  const res = await proxyFetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
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
    stream: true,
  };

  if (!isReasoner) {
    body.temperature = options.temperature ?? 0.3;
    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }
    if (options.noThinking) {
      body.thinking = { type: "disabled" };
    }
  }

  const res = await proxyFetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek stream error ${res.status}: ${errText.slice(0, 300)}`);
  }

  let fullText = "";
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
        };
        const text = parsed.choices[0]?.delta?.content ?? "";
        if (text) {
          fullText += text;
          yield text;
        }
      } catch { /* skip */ }
    }
  }

  return { content: fullText, provider: options.provider, model };
}
