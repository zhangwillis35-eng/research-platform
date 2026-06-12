"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StopButton } from "@/components/stop-button";
import {
  type SearchMeta,
  type SearchPlan,
  type SearchStats,
  type SortBy,
  sourceColors,
  sourceLabels,
} from "./types";

export type AnalysisType = "variables" | "review" | "ideas";

interface ResultsToolbarProps {
  papersCount: number;
  displayedCount: number;
  meta: SearchMeta | null;
  searchStats: SearchStats | null;
  searchPlan: SearchPlan | null;
  sortBy: SortBy;
  onSortByChange: (v: SortBy) => void;
  filterRankings: Set<string>;
  setFilterRankings: React.Dispatch<React.SetStateAction<Set<string>>>;
  searchBatches: Array<{ id: string; query: string; count: number; timestamp: Date }>;
  filterBatch: string;
  onFilterBatchChange: (v: string) => void;
  analyzing: boolean;
  onAnalyze: (type: AnalysisType) => void;
  onStopAnalyze: () => void;
}

/** Counts line + sort / ranking / batch filters + AI action buttons. */
export function ResultsToolbar({
  papersCount,
  displayedCount,
  meta,
  searchStats,
  searchPlan,
  sortBy,
  onSortByChange,
  filterRankings,
  setFilterRankings,
  searchBatches,
  filterBatch,
  onFilterBatchChange,
  analyzing,
  onAnalyze,
  onStopAnalyze,
}: ResultsToolbarProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground whitespace-nowrap">
          共 {displayedCount} 篇
          {(filterRankings.size > 0 || filterBatch !== "all" || (searchPlan?.filters && Object.keys(searchPlan.filters).length > 0)) &&
            papersCount !== displayedCount &&
            ` (从 ${papersCount} 篇中筛选)`}
          {searchStats?.relevanceScored && searchStats.totalBeforeRelevance > searchStats.total &&
            ` · AI过滤了 ${searchStats.totalBeforeRelevance - searchStats.total} 篇不相关文献`}
        </span>
        {meta?.sources.map((s) => {
          const label = sourceLabels[s.source] ?? s.source;
          const shortLabel = label.length > 35 ? label.slice(0, 32) + "..." : label;
          return (
            <Badge
              key={s.source}
              variant="secondary"
              className={`text-xs ${sourceColors[s.source] ?? ""}`}
              title={label}
            >
              {shortLabel}: {s.count}
            </Badge>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {/* Sort */}
        <Select value={sortBy} onValueChange={(v) => v && onSortByChange(v as SortBy)}>
          <SelectTrigger className="w-[150px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="citations">按引用量排序</SelectItem>
            <SelectItem value="year_desc">按年份（新→旧）</SelectItem>
            <SelectItem value="year_asc">按年份（旧→新）</SelectItem>
            <SelectItem value="relevance">按相关度排序</SelectItem>
          </SelectContent>
        </Select>

        {/* Filter by ranking — multi-select */}
        <div className="relative group">
          <button className="flex items-center gap-1 h-8 px-3 rounded-md border border-input bg-background text-xs hover:bg-accent">
            {filterRankings.size === 0 ? "全部期刊" : `${filterRankings.size} 项已选`}
            <span className="text-[10px] ml-1">▼</span>
          </button>
          <div className="absolute top-full left-0 mt-1 w-48 bg-popover border border-border rounded-md shadow-md z-50 hidden group-hover:block hover:block max-h-64 overflow-y-auto py-1">
            {filterRankings.size > 0 && (
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-accent"
                onClick={() => setFilterRankings(new Set())}
              >
                清除筛选
              </button>
            )}
            {[
              { value: "UTD24", label: "UTD24" },
              { value: "FT50", label: "FT50" },
              { value: "FMS", label: "FMS推荐" },
              { value: "SSCI", label: "SSCI" },
              { value: "SCI", label: "SCI" },
              { value: "CSSCI", label: "CSSCI 南大核心" },
              { value: "ABS 4*", label: "ABS 4*" },
              { value: "ABS 4", label: "ABS 4 及以上" },
              { value: "ABS 3", label: "ABS 3 及以上" },
              { value: "JCR Q1", label: "JCR Q1" },
              { value: "JCR Q2", label: "JCR Q1-Q2" },
              { value: "ABDC A*", label: "ABDC A*" },
              { value: "CCF A", label: "CCF A" },
              { value: "CCF B", label: "CCF A-B" },
              { value: "中科院一区", label: "中科院一区" },
              { value: "中科院二区", label: "中科院一二区" },
              { value: "arXiv", label: "arXiv 预印本" },
            ].map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterRankings.has(value)}
                  onChange={() => {
                    setFilterRankings(prev => {
                      const next = new Set(prev);
                      if (next.has(value)) next.delete(value);
                      else next.add(value);
                      return next;
                    });
                  }}
                  className="accent-teal w-3 h-3"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Filter by search batch */}
        {searchBatches.length > 0 && (
          <Select value={filterBatch} onValueChange={(v) => v && onFilterBatchChange(v)}>
            <SelectTrigger className="w-[200px] h-8 text-xs">
              <SelectValue placeholder="全部检索" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部检索（{papersCount} 篇）</SelectItem>
              {searchBatches.map((b, idx) => (
                <SelectItem key={b.id} value={b.id}>
                  第{idx + 1}轮: {b.query.slice(0, 15)}{b.query.length > 15 ? "..." : ""}（{b.count} 篇）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* AI Actions */}
        <Separator orientation="vertical" className="h-6" />
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onAnalyze("variables")} disabled={analyzing}>
          提取变量
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onAnalyze("review")} disabled={analyzing}>
          生成综述
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onAnalyze("ideas")} disabled={analyzing}>
          生成想法
        </Button>
        <StopButton show={analyzing} onClick={onStopAnalyze} label="停止分析" />
      </div>
    </div>
  );
}
