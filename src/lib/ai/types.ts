export type AIProvider = "claude" | "gemini" | "deepseek" | "chatgpt";

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
}

export interface AIResponse {
  content: string;
  provider: AIProvider;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}
