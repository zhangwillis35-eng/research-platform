export type AIProvider = "claude" | "gemini" | "gemini-pro" | "gemini-flash" | "deepseek" | "deepseek-fast" | "deepseek-pro" | "chatgpt" | "qwen" | "glm";

// Map provider IDs to actual model names
export const PROVIDER_MODELS: Record<AIProvider, string> = {
  "gemini": "gemini-3-flash-preview",
  "gemini-pro": "gemini-3.1-pro-preview",
  "gemini-flash": "gemini-3-flash-preview",
  claude: "claude-sonnet-4-20250514",
  chatgpt: "gpt-4o",
  deepseek: "deepseek-reasoner",
  "deepseek-fast": "deepseek-v4-flash",
  "deepseek-pro": "deepseek-v4-pro",
  qwen: "qwen-plus",
  glm: "glm-4-plus",
};

export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIRequestOptions {
  provider: AIProvider;
  messages: AIMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /** Disable thinking/reasoning for faster structured extraction (DeepSeek only) */
  noThinking?: boolean;
}

export interface AIResponse {
  content: string;
  thinking?: string;
  provider: AIProvider;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}
