import { GoogleGenAI } from "@google/genai";
import type { AIRequestOptions, AIResponse } from "./types";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return client;
}

export async function callGemini(options: AIRequestOptions): Promise<AIResponse> {
  const ai = getClient();

  const systemPrompt = options.system ?? "";
  const contents = options.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents,
    config: {
      systemInstruction: systemPrompt || undefined,
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxTokens ?? 4096,
      responseMimeType: options.jsonMode ? "application/json" : undefined,
    },
  });

  const content = response.text ?? "";

  return {
    content,
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    usage: response.usageMetadata
      ? {
          inputTokens: response.usageMetadata.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
        }
      : undefined,
  };
}

export async function* streamGemini(
  options: AIRequestOptions
): AsyncGenerator<string, AIResponse> {
  const ai = getClient();

  const systemPrompt = options.system ?? "";
  const contents = options.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));

  const response = await ai.models.generateContentStream({
    model: "gemini-3.1-pro-preview",
    contents,
    config: {
      systemInstruction: systemPrompt || undefined,
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxTokens ?? 4096,
    },
  });

  let fullText = "";
  for await (const chunk of response) {
    const text = chunk.text ?? "";
    if (text) {
      fullText += text;
      yield text;
    }
  }

  return {
    content: fullText,
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
  };
}
