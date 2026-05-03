"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AnalysisEngine = "builtin" | "storm" | "notebooklm";

const engines: {
  id: AnalysisEngine;
  name: string;
  tag: string;
  tagColor: string;
}[] = [
  {
    id: "builtin",
    name: "Built-in AI",
    tag: "默认",
    tagColor: "text-emerald-500",
  },
  {
    id: "storm",
    name: "STORM",
    tag: "多视角",
    tagColor: "text-purple-500",
  },
  {
    id: "notebooklm",
    name: "NotebookLM",
    tag: "源引用",
    tagColor: "text-orange-500",
  },
];

export function AnalysisEngineSelect({
  value,
  onChange,
  notebookConfigured,
}: {
  value: AnalysisEngine;
  onChange: (value: AnalysisEngine) => void;
  notebookConfigured?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as AnalysisEngine)}>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="选择分析引擎" />
      </SelectTrigger>
      <SelectContent>
        {engines.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            <span className="flex items-center gap-2">
              {e.name}
              <span className={`text-xs ${e.tagColor}`}>{e.tag}</span>
              {e.id === "notebooklm" && !notebookConfigured && (
                <span className="text-xs text-amber-500" title="需在设置中配置 Notebook URL">
                  ⚠
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
