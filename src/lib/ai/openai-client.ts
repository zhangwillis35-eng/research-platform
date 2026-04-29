/**
 * OpenAI client — REST API with proxy support.
 */
import type { AIRequestOptions, AIResponse } from "./types";
import { proxyFetch } from "./proxy-fetch";
import { getEnv } from "@/lib/env";

const OPENAI_MODEL = "gpt-4o";
const OPENAI_BASE = "https://api.openai.com/v1";

function getApiKey(): string {
  const key = getEnv("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not set");
  return key;
}

export async function callOpenAI(options: AIRequestOptions): Promise<AIResponse> {
  const apiKey = getApiKey();

  const messages: Array<{ role: string; content: string }> = [];
  if (options.system) messages.push({ role: "system", content: options.system });
  for (const m of options.messages) {
    if (m.role === "system") continue;
    messages.push({ role: m.role, content: m.content });
  }

  const res = await proxyFetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4096,
      ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? "",
    provider: "chatgpt",
    model: data.model,
    usage: data.usage
      ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
      : undefined,
  };
}

export async function* streamOpenAI(
  options: AIRequestOptions
): AsyncGenerator<string, AIResponse> {
  const apiKey = getApiKey();

  const messages: Array<{ role: string; content: string }> = [];
  if (options.system) messages.push({ role: "system", content: options.system });
  for (const m of options.messages) {
    if (m.role === "system") continue;
    messages.push({ role: m.role, content: m.content });
  }

  const res = await proxyFetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI stream error ${res.status}: ${errText.slice(0, 300)}`);
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

  return { content: fullText, provider: "chatgpt", model: OPENAI_MODEL };
}
