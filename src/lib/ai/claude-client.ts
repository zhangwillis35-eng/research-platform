/**
 * Claude client — REST API with proxy support.
 */
import type { AIRequestOptions, AIResponse } from "./types";
import { proxyFetch } from "./proxy-fetch";
import { getEnv } from "@/lib/env";

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const CLAUDE_BASE = "https://api.anthropic.com/v1";

function getApiKey(): string {
  const key = getEnv("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return key;
}

export async function callClaude(options: AIRequestOptions): Promise<AIResponse> {
  const apiKey = getApiKey();

  const messages = options.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const res = await proxyFetch(`${CLAUDE_BASE}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.3,
      system: options.system ?? "",
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  return {
    content: data.content[0]?.type === "text" ? data.content[0].text : "",
    provider: "claude",
    model: data.model,
    usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
  };
}

export async function* streamClaude(
  options: AIRequestOptions
): AsyncGenerator<string, AIResponse> {
  const apiKey = getApiKey();

  const messages = options.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const res = await proxyFetch(`${CLAUDE_BASE}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.3,
      system: options.system ?? "",
      messages,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude stream error ${res.status}: ${errText.slice(0, 300)}`);
  }

  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  const reader = res.body as unknown as AsyncIterable<Buffer | Uint8Array>;
  let buffer = "";

  for await (const chunk of reader) {
    buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      try {
        const event = JSON.parse(jsonStr) as {
          type: string;
          delta?: { type: string; text?: string };
          usage?: { output_tokens: number };
          message?: { usage?: { input_tokens: number } };
        };
        if (event.type === "content_block_delta" && event.delta?.text) {
          fullText += event.delta.text;
          yield event.delta.text;
        }
        if (event.type === "message_delta" && event.usage) {
          outputTokens = event.usage.output_tokens;
        }
        if (event.type === "message_start" && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens;
        }
      } catch { /* skip */ }
    }
  }

  return {
    content: fullText,
    provider: "claude",
    model: CLAUDE_MODEL,
    usage: { inputTokens, outputTokens },
  };
}
