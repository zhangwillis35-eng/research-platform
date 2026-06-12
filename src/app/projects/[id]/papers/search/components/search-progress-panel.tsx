"use client";

import { StopButton } from "@/components/stop-button";
import { type SearchProgressStep } from "./types";

interface SearchProgressPanelProps {
  loading: boolean;
  searchProgress: SearchProgressStep[];
  progressOpen: boolean;
  onToggleOpen: () => void;
  onStop: () => void;
}

/** Live search progress (while loading) + collapsed summary after completion. */
export function SearchProgressPanel({
  loading,
  searchProgress,
  progressOpen,
  onToggleOpen,
  onStop,
}: SearchProgressPanelProps) {
  return (
    <>
      {/* Search progress panel */}
      {loading && (
        <div className="border border-teal/20 rounded-lg bg-teal/5 overflow-hidden">
          <div className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-teal">
            <span className="flex items-center gap-2 cursor-pointer hover:opacity-80" onClick={onToggleOpen}>
              <span className="inline-block w-3.5 h-3.5 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
              检索进行中...
              <span className="text-[10px] text-muted-foreground">{progressOpen ? "▲ 收起" : "▼ 展开"}</span>
            </span>
            <StopButton show={loading} onClick={onStop} label="停止检索" />
          </div>
          {progressOpen && searchProgress.length > 0 && (
            <div className="px-4 pb-3 space-y-1.5 border-t border-teal/10">
              {searchProgress.map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {step.done ? (
                    <span className="text-teal mt-0.5 shrink-0">✓</span>
                  ) : (
                    <span className="inline-block w-3 h-3 border-2 border-teal/30 border-t-teal rounded-full animate-spin mt-0.5 shrink-0" />
                  )}
                  <span className={step.done ? "text-muted-foreground" : "text-foreground"}>
                    {step.message}
                  </span>
                </div>
              ))}
            </div>
          )}
          {progressOpen && searchProgress.length === 0 && (
            <div className="px-4 pb-3 border-t border-teal/10">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block w-3 h-3 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
                初始化搜索...
              </div>
            </div>
          )}
        </div>
      )}

      {/* Completed progress — collapsible after search finishes */}
      {!loading && searchProgress.length > 0 && (
        <div className="border border-border/50 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
            onClick={onToggleOpen}
          >
            <span className="flex items-center gap-1.5">
              <span className="text-teal">✓</span>
              检索完成 · {searchProgress.length} 个步骤
            </span>
            <span className="text-[10px]">{progressOpen ? "▲ 收起" : "▼ 展开"}</span>
          </button>
          {progressOpen && (
            <div className="px-4 pb-2.5 space-y-1 border-t border-border/30">
              {searchProgress.map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-teal mt-0.5 shrink-0">✓</span>
                  <span className="text-muted-foreground">{step.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
