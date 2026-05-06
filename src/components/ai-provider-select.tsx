"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AIProvider = "claude" | "gemini" | "gemini-pro" | "gemini-flash" | "deepseek" | "deepseek-fast" | "deepseek-pro" | "chatgpt" | "qwen" | "glm";

const providers: {
  id: AIProvider;
  name: string;
  tag: string;
  tagColor: string;
  disabled?: boolean;
}[] = [
  { id: "deepseek-fast", name: "DeepSeek V4 Flash", tag: "最快", tagColor: "text-blue-500" },
  { id: "deepseek-pro", name: "DeepSeek V4 Pro", tag: "最强", tagColor: "text-blue-700" },
  { id: "deepseek", name: "DeepSeek R1", tag: "深度推理", tagColor: "text-blue-600" },
  { id: "qwen", name: "通义千问 Qwen Plus", tag: "国产", tagColor: "text-orange-500" },
  { id: "glm", name: "智谱 GLM-4 Plus", tag: "国产", tagColor: "text-purple-500" },
  { id: "gemini-pro", name: "Gemini 3.1 Pro", tag: "需代理", tagColor: "text-red-400" },
  { id: "gemini", name: "Gemini 3.0 Flash", tag: "需代理", tagColor: "text-red-400" },
  { id: "chatgpt", name: "GPT-4o", tag: "暂停", tagColor: "text-gray-400", disabled: true },
  { id: "claude", name: "Claude Sonnet 4", tag: "暂停", tagColor: "text-gray-400", disabled: true },
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
          <SelectItem key={p.id} value={p.id} disabled={p.disabled}>
            <span className={`flex items-center gap-2 ${p.disabled ? "opacity-40" : ""}`}>
              {p.name}
              <span className={`text-xs ${p.tagColor}`}>{p.tag}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
