"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";

export type AnalysisEngine = "builtin" | "storm";

const engines: {
  id: AnalysisEngine;
  name: string;
  tag: string;
  tagColor: string;
  description: string;
  method: string;
}[] = [
  {
    id: "builtin",
    name: "Built-in AI",
    tag: "默认",
    tagColor: "text-emerald-500",
    description: "单次 LLM 调用，基于全文直接生成分析结果",
    method: "适合快速生成 · 结果连贯 · 速度最快",
  },
  {
    id: "storm",
    name: "STORM",
    tag: "多视角",
    tagColor: "text-purple-500",
    description: "斯坦福 STORM 框架，模拟多位专家视角迭代分析",
    method: "适合深度综述 · 多角度覆盖 · 质量更高",
  },
];

export function AnalysisEngineSelect({
  value,
  onChange,
}: {
  value: AnalysisEngine;
  onChange: (value: AnalysisEngine) => void;
  notebookConfigured?: boolean; // kept for API compat, unused
}) {
  const [open, setOpen] = useState(false);
  const current = engines.find((e) => e.id === value) ?? engines[0];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">分析引擎</span>
        <div className="relative group">
          <span className="text-[10px] text-muted-foreground cursor-help underline decoration-dotted">?</span>
          <div className="absolute left-0 bottom-full mb-1.5 w-56 p-2 bg-popover border border-border rounded-lg shadow-lg text-[10px] leading-relaxed text-muted-foreground opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 whitespace-normal">
            <p className="font-medium text-foreground mb-1">Built-in AI</p>
            <p className="mb-1.5">单次 LLM 直接分析，速度快、结果连贯，适合日常使用。</p>
            <p className="font-medium text-foreground mb-1">STORM</p>
            <p>模拟多位领域专家从不同视角反复讨论，迭代生成更全面深入的分析，质量更高但耗时更长。</p>
          </div>
        </div>
      </div>
      <Select value={value} onValueChange={(v) => v && onChange(v as AnalysisEngine)} open={open} onOpenChange={setOpen}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="选择分析引擎" />
        </SelectTrigger>
        <SelectContent>
          {engines.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  {e.name}
                  <span className={`text-xs ${e.tagColor}`}>{e.tag}</span>
                </span>
                <span className="text-[10px] text-muted-foreground">{e.method}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
