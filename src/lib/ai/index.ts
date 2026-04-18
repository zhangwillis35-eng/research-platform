import type { AIProvider, AIRequestOptions, AIResponse } from "./types";
import { callClaude, streamClaude } from "./claude-client";
import { callGemini, streamGemini } from "./gemini-client";
import { callDeepSeek, streamDeepSeek } from "./deepseek-client";
import { callOpenAI, streamOpenAI } from "./openai-client";

export type { AIProvider, AIRequestOptions, AIResponse } from "./types";

export const AI_PROVIDERS: {
  id: AIProvider;
  name: string;
  description: string;
}[] = [
  {
    id: "gemini",
    name: "Gemini 3.1 Pro",
    description: "Google Gemini，最新预览版，能力强劲",
  },
  {
    id: "chatgpt",
    name: "GPT-5",
    description: "OpenAI 最新旗舰模型",
  },
  {
    id: "deepseek",
    name: "DeepSeek Reasoning",
    description: "DeepSeek 推理模型，深度思考能力强",
  },
  {
    id: "claude",
    name: "Claude Sonnet 4",
    description: "Anthropic Claude，结构化输出强",
  },
];

export async function callAI(options: AIRequestOptions): Promise<AIResponse> {
  switch (options.provider) {
    case "claude":
      return callClaude(options);
    case "gemini":
      return callGemini(options);
    case "deepseek":
      return callDeepSeek(options);
    case "chatgpt":
      return callOpenAI(options);
    default:
      throw new Error(`Unknown provider: ${options.provider}`);
  }
}

export async function* streamAI(
  options: AIRequestOptions
): AsyncGenerator<string, AIResponse> {
  switch (options.provider) {
    case "claude":
      return yield* streamClaude(options);
    case "gemini":
      return yield* streamGemini(options);
    case "deepseek":
      return yield* streamDeepSeek(options);
    case "chatgpt":
      return yield* streamOpenAI(options);
    default:
      throw new Error(`Unknown provider: ${options.provider}`);
  }
}
