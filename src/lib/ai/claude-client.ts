import Anthropic from "@anthropic-ai/sdk";
import type { AIRequestOptions, AIResponse } from "./types";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function callClaude(options: AIRequestOptions): Promise<AIResponse> {
  const anthropic = getClient();

  const messages = options.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.3,
    system: options.system ?? "",
    messages,
  });

  const content =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  return {
    content,
    provider: "claude",
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

export async function* streamClaude(
  options: AIRequestOptions
): AsyncGenerator<string, AIResponse> {
  const anthropic = getClient();

  const messages = options.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.3,
    system: options.system ?? "",
    messages,
  });

  let fullText = "";
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      fullText += event.delta.text;
      yield event.delta.text;
    }
  }

  const finalMessage = await stream.finalMessage();
  return {
    content: fullText,
    provider: "claude",
    model: finalMessage.model,
    usage: {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    },
  };
}
