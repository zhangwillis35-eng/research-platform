import OpenAI from "openai";
import type { AIRequestOptions, AIResponse } from "./types";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export async function callOpenAI(options: AIRequestOptions): Promise<AIResponse> {
  const openai = getClient();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (options.system) {
    messages.push({ role: "system", content: options.system });
  }
  for (const m of options.messages) {
    if (m.role === "system") continue;
    messages.push({
      role: m.role as "user" | "assistant",
      content: m.content,
    });
  }

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 4096,
    response_format: options.jsonMode ? { type: "json_object" } : undefined,
  });

  const content = response.choices[0]?.message?.content ?? "";

  return {
    content,
    provider: "chatgpt",
    model: response.model,
    usage: response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
        }
      : undefined,
  };
}

export async function* streamOpenAI(
  options: AIRequestOptions
): AsyncGenerator<string, AIResponse> {
  const openai = getClient();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (options.system) {
    messages.push({ role: "system", content: options.system });
  }
  for (const m of options.messages) {
    if (m.role === "system") continue;
    messages.push({
      role: m.role as "user" | "assistant",
      content: m.content,
    });
  }

  const stream = await openai.chat.completions.create({
    model: "gpt-5",
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 4096,
    stream: true,
  });

  let fullText = "";
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (text) {
      fullText += text;
      yield text;
    }
  }

  return {
    content: fullText,
    provider: "chatgpt",
    model: "gpt-5",
  };
}
