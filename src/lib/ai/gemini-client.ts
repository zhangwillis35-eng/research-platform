/**
 * Gemini client — REST API with proxy support.
 * Reads API key from .env file directly to avoid shell env override.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import type { AIRequestOptions, AIResponse } from "./types";
import { PROVIDER_MODELS } from "./types";
import { proxyFetch } from "./proxy-fetch";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

function getModel(provider: string): string {
  return PROVIDER_MODELS[provider as keyof typeof PROVIDER_MODELS] ?? "gemini-2.5-flash";
}

/**
 * Read GEMINI_API_KEY directly from .env file.
 * This is necessary because Claude Code injects its own GEMINI_API_KEY
 * into the shell, which overrides Next.js .env loading.
 */
function getApiKey(): string {
  // Strategy 1: Read directly from .env file (most reliable)
  try {
    const envPath = resolve(process.cwd(), ".env");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.trim().match(/^GEMINI_API_KEY=["']?(.+?)["']?$/);
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch {
    // .env file not found
  }

  // Strategy 2: Fall back to process.env
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set in .env or environment");
  console.warn("[gemini] Using process.env key — may be wrong if Claude Code is running");
  return key;
}

function buildRequestBody(options: AIRequestOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: options.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    generationConfig: {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxTokens ?? 8192,
      ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  if (options.system) {
    body.systemInstruction = { parts: [{ text: options.system }] };
  }

  return body;
}

export async function callGemini(options: AIRequestOptions): Promise<AIResponse> {
  const apiKey = getApiKey();
  const model = getModel(options.provider);
  const body = buildRequestBody(options);
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`;

  console.log(`[gemini] Calling ${model} with key ${apiKey.slice(0, 10)}...`);

  const res = await proxyFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[gemini] API error ${res.status}: ${errText.slice(0, 200)}`);
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const thinkingParts = parts.filter(p => p.thought).map(p => p.text ?? "").join("");
  const contentParts = parts.filter(p => !p.thought).map(p => p.text ?? "").join("");

  return {
    content: contentParts,
    thinking: thinkingParts || undefined,
    provider: options.provider,
    model,
    usage: data.usageMetadata
      ? {
          inputTokens: data.usageMetadata.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
        }
      : undefined,
  };
}

export async function* streamGemini(
  options: AIRequestOptions
): AsyncGenerator<string, AIResponse> {
  const apiKey = getApiKey();
  const model = getModel(options.provider);
  const body = buildRequestBody(options);
  const url = `${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const res = await proxyFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini stream error ${res.status}: ${errText.slice(0, 300)}`);
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
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (text) {
          fullText += text;
          yield text;
        }
      } catch {
        // skip
      }
    }
  }

  return {
    content: fullText,
    provider: options.provider,
    model,
  };
}
