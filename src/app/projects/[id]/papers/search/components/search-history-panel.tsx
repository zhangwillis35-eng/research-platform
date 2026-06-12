"use client";

import { type SearchHistoryItem } from "./types";

interface SearchHistoryPanelProps {
  collapsed: boolean;
  onSetCollapsed: (collapsed: boolean) => void;
  searchHistory: SearchHistoryItem[];
  activeSearchId: string;
  onNewConversation: () => void;
  onSelectHistory: (item: SearchHistoryItem) => void;
  onDeleteHistory: (item: SearchHistoryItem) => void;
}

export function SearchHistoryPanel({
  collapsed,
  onSetCollapsed,
  searchHistory,
  activeSearchId,
  onNewConversation,
  onSelectHistory,
  onDeleteHistory,
}: SearchHistoryPanelProps) {
  return (
    <div className={`shrink-0 transition-all duration-200 overflow-y-auto ${collapsed ? "w-10" : "w-56"}`}>
      <div className="space-y-2">
        {/* New conversation button */}
        {collapsed ? (
          <button
            onClick={onNewConversation}
            className="w-full border border-border/50 rounded-lg bg-card p-2 flex items-center justify-center text-teal hover:bg-teal/5 transition-colors"
            title="新建对话"
          >
            <span className="text-sm">+</span>
          </button>
        ) : (
          <button
            onClick={onNewConversation}
            className="w-full border border-teal/30 rounded-lg bg-teal/5 hover:bg-teal/10 transition-colors px-3 py-2 flex items-center gap-2 text-teal text-sm font-medium"
          >
            <span>+</span>
            <span>新建对话</span>
          </button>
        )}

        {/* History panel */}
        {collapsed ? (
          <div className="border border-border/50 rounded-lg bg-card overflow-hidden">
            <button
              onClick={() => onSetCollapsed(false)}
              className="w-full flex flex-col items-center gap-2 py-3 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="展开检索记录"
            >
              <span className="text-xs">»</span>
              <span className="text-[10px] tracking-widest" style={{ writingMode: "vertical-rl" }}>检索记录</span>
              {searchHistory.length > 0 && (
                <span className="text-[9px] bg-teal/10 text-teal rounded-full w-5 h-5 flex items-center justify-center">
                  {searchHistory.length}
                </span>
              )}
            </button>
          </div>
        ) : (
          <div className="border border-border/50 rounded-lg bg-card overflow-hidden">
            <div className="p-3 border-b border-border/50 flex items-center justify-between">
              <span className="text-sm font-medium">检索记录</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">{searchHistory.length} 条</span>
                <button
                  onClick={() => onSetCollapsed(true)}
                  className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="收起检索记录"
                >
                  <span className="text-xs">«</span>
                </button>
              </div>
            </div>
            <div className="max-h-[calc(100vh-160px)] overflow-y-auto">
              {searchHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3 text-center">暂无检索记录</p>
              ) : (
                searchHistory.map((h) => (
                  <div
                    key={h.id}
                    className={`group p-3 border-b border-border/30 cursor-pointer transition-colors ${activeSearchId === h.id ? "bg-teal/10 border-l-2 border-l-teal" : "hover:bg-muted/50"}`}
                    onClick={() => onSelectHistory(h)}
                  >
                    <p className="text-xs font-medium leading-snug line-clamp-2 group-hover:text-teal transition-colors">
                      {h.query}
                    </p>
                    {h.translatedQuery && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        → {h.translatedQuery}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] text-muted-foreground">
                        {h.paperCount} 篇 · {h.provider ?? ""}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-muted-foreground/60">
                          {new Date(h.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <button
                          className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400 hover:text-red-600 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteHistory(h);
                          }}
                          title="删除"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {h.keyTerms && (h.keyTerms as string[]).length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {(h.keyTerms as string[]).slice(0, 3).map((t) => (
                          <span key={t} className="text-[9px] px-1 py-0 rounded bg-teal/10 text-teal">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
