export type AIProvider = "claude" | "gemini" | "gemini-pro" | "gemini-flash" | "deepseek" | "deepseek-fast" | "deepseek-pro" | "chatgpt";

// Map provider IDs to actual model names
export const PROVIDER_MODELS: Record<AIProvider, string> = {
  "gemini": "gemini-3-flash-preview",      // default / fast
  "gemini-pro": "gemini-3.1-pro-preview", // most capable
  "gemini-flash": "gemini-3-flash-preview", // fast
  claude: "claude-sonnet-4-20250514",
  chatgpt: "gpt-4o",
  deepseek: "deepseek-reasoner",           // deep reasoning, slow (deprecated 2026/07)
  "deepseek-fast": "deepseek-v4-flash",   // V4 Flash: fastest structured extraction
  "deepseek-pro": "deepseek-v4-pro",      // V4 Pro: strongest DeepSeek model
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
