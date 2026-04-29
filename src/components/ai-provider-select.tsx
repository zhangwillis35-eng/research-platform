"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AIProvider = "claude" | "gemini" | "gemini-pro" | "gemini-flash" | "deepseek" | "deepseek-fast" | "deepseek-pro" | "chatgpt";

const providers: {
  id: AIProvider;
  name: string;
  tag: string;
  tagColor: string;
  blocked?: boolean; // 大陆无法直连
}[] = [
  {
    id: "deepseek-fast",
    name: "DeepSeek V4 Flash",
    tag: "最快",
    tagColor: "text-blue-500",
  },
  {
    id: "deepseek-pro",
    name: "DeepSeek V4 Pro",
    tag: "最强",
    tagColor: "text-blue-700",
  },
  {
    id: "gemini-pro",
    name: "Gemini 3.1 Pro",
    tag: "需代理",
    tagColor: "text-red-400",
    blocked: true,
  },
  {
    id: "gemini",
    name: "Gemini 3.0 Flash",
    tag: "需代理",
    tagColor: "text-red-400",
    blocked: true,
  },
  {
    id: "chatgpt",
    name: "GPT-4o",
    tag: "需代理",
    tagColor: "text-red-400",
    blocked: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek R1",
    tag: "深度推理",
    tagColor: "text-blue-600",
  },
  {
    id: "claude",
    name: "Claude Sonnet 4",
    tag: "需代理",
    tagColor: "text-red-400",
    blocked: true,
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
    <Select value={value} onValueChange={(v) => v && onChange(v as AIProvider)}>
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
