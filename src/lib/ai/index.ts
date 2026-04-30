import type { AIProvider, AIRequestOptions, AIResponse } from "./types";
import { callClaude, streamClaude } from "./claude-client";
import { callGemini, streamGemini } from "./gemini-client";
import { callDeepSeek, streamDeepSeek } from "./deepseek-client";
import { callOpenAI, streamOpenAI } from "./openai-client";
import { logTokenUsage } from "../token-logger";

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

/** Context for token tracking — set per-request */
let _currentUserId: string | null = null;
let _currentEndpoint: string | null = null;

/** Set tracking context before AI calls in a request handler */
export function setAIContext(userId: string, endpoint?: string) {
  _currentUserId = userId;
  _currentEndpoint = endpoint ?? null;
}

function trackUsage(response: AIResponse) {
  if (_currentUserId && response.usage) {
    logTokenUsage({
      userId: _currentUserId,
      provider: response.provider,
      model: response.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      endpoint: _currentEndpoint ?? undefined,
    });
  }
}

export async function callAI(options: AIRequestOptions): Promise<AIResponse> {
  let response: AIResponse;
  switch (options.provider) {
    case "claude":
      response = await callClaude(options);
      break;
    case "gemini":
    case "gemini-pro":
    case "gemini-flash":
      response = await callGemini(options);
      break;
    case "deepseek":
    case "deepseek-fast":
    case "deepseek-pro":
      response = await callDeepSeek(options);
      break;
    case "chatgpt":
      response = await callOpenAI(options);
      break;
    default:
      throw new Error(`Unknown provider: ${options.provider}`);
  }
  trackUsage(response);
  return response;
}

export async function* streamAI(
  options: AIRequestOptions
): AsyncGenerator<string, AIResponse> {
  let gen: AsyncGenerator<string, AIResponse>;
  switch (options.provider) {
    case "claude":
      gen = streamClaude(options);
      break;
    case "gemini":
    case "gemini-pro":
    case "gemini-flash":
      gen = streamGemini(options);
      break;
    case "deepseek":
    case "deepseek-fast":
    case "deepseek-pro":
      gen = streamDeepSeek(options);
      break;
    case "chatgpt":
      gen = streamOpenAI(options);
      break;
    default:
      throw new Error(`Unknown provider: ${options.provider}`);
  }

  let result = await gen.next();
  while (!result.done) {
    yield result.value;
    result = await gen.next();
  }
  trackUsage(result.value);
  return result.value;
}
