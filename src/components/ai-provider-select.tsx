"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AIProvider = "claude" | "gemini" | "deepseek" | "chatgpt";

const providers = [
  {
    id: "gemini" as const,
    name: "Gemini 3.1 Pro",
    tag: "Google",
    tagColor: "text-green-600",
  },
  {
    id: "chatgpt" as const,
    name: "GPT-5",
    tag: "OpenAI",
    tagColor: "text-emerald-600",
  },
  {
    id: "deepseek" as const,
    name: "DeepSeek Reasoning",
    tag: "推理",
    tagColor: "text-blue-600",
  },
  {
    id: "claude" as const,
    name: "Claude Sonnet 4",
    tag: "Anthropic",
    tagColor: "text-orange-600",
  },
];

export function AIProviderSelect({
  value,
  onChange,
}: {
  value: AIProvider;
  onChange: (value: AIProvider) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AIProvider)}>
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="选择 AI 模型" />
      </SelectTrigger>
      <SelectContent>
        {providers.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="flex items-center gap-2">
              {p.name}
              <span className={`text-xs ${p.tagColor}`}>{p.tag}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
