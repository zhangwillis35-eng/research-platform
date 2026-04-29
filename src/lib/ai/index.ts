import type { AIProvider, AIRequestOptions, AIResponse } from "./types";
import { callClaude, streamClaude } from "./claude-client";
import { callGemini, streamGemini } from "./gemini-client";
import { callDeepSeek, streamDeepSeek } from "./deepseek-client";
import { callOpenAI, streamOpenAI } from "./openai-client";

export type { AIProvider, AIRequestOptions, AIResponse } from "./types";
export { PROVIDER_MODELS } from "./types";

export const AI_PROVIDERS: {
  id: AIProvider;
  name: string;
  description: string;
}[] = [
  {
    id: "deepseek-fast",
    name: "DeepSeek V4 Flash",
    description: "最快的分析模型，结构化提取首选",
  },
  {
    id: "deepseek-pro",
    name: "DeepSeek V4 Pro",
    description: "DeepSeek 最强模型，深度分析",
  },
  {
    id: "gemini-pro",
    name: "Gemini 3.1 Pro",
    description: "Google 最强模型，深度分析首选（大陆需代理）",
  },
  {
    id: "gemini",
    name: "Gemini 3.0 Flash",
    description: "Google Gemini，快速且能力强（大陆需代理）",
  },
  {
    id: "chatgpt",
    name: "GPT-4o",
    description: "OpenAI 旗舰模型（大陆需代理）",
  },
  {
    id: "deepseek",
    name: "DeepSeek R1",
    description: "DeepSeek 推理模型，深度思考（较慢）",
  },
  {
    id: "claude",
    name: "Claude Sonnet 4",
    description: "Anthropic Claude，结构化输出强（大陆需代理）",
  },
];

export async function callAI(options: AIRequestOptions): Promise<AIResponse> {
  switch (options.provider) {
    case "claude":
      return callClaude(options);
    case "gemini":
    case "gemini-pro":
    case "gemini-flash":
      return callGemini(options);
    case "deepseek":
    case "deepseek-fast":
    case "deepseek-pro":
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
    case "gemini-pro":
    case "gemini-flash":
      return yield* streamGemini(options);
    case "deepseek":
    case "deepseek-fast":
    case "deepseek-pro":
      return yield* streamDeepSeek(options);
    case "chatgpt":
      return yield* streamOpenAI(options);
    default:
      throw new Error(`Unknown provider: ${options.provider}`);
  }
}
