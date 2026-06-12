"use client";

import { useState } from "react";
import {
  type Paper,
  type VariableRelation,
  directionColors,
  directionLabels,
} from "./types";

interface AnalysisResultViewProps {
  content: string | null;
  papers?: Paper[];
  /** Scrolls to a paper card by 1-based index (handles windowed rendering). */
  onScrollToPaper: (oneBasedIndex: number) => void;
}

export function AnalysisResultView({ content, papers, onScrollToPaper }: AnalysisResultViewProps) {
  if (!content) return null;

  // Try to parse as JSON with relations (parse only — JSX is built outside the try/catch)
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Not JSON — render as plain text (possibly markdown-like)
  }

  if (parsed && typeof parsed === "object") {
    const relations = (parsed as { relations?: unknown }).relations;
    if (relations && Array.isArray(relations)) {
      return <RelationsView relations={relations as VariableRelation[]} papers={papers} onScrollToPaper={onScrollToPaper} />;
    }
    // Other JSON structures — render as formatted text
    return (
      <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap leading-relaxed">
        {JSON.stringify(parsed, null, 2)}
      </div>
    );
  }

  return (
    <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap leading-relaxed">
      {content}
    </div>
  );
}

function RelationsView({ relations, papers, onScrollToPaper }: { relations: VariableRelation[]; papers?: Paper[]; onScrollToPaper: (oneBasedIndex: number) => void }) {
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  function scrollToPaper(index: number) {
    // Paper indices are 1-based in the LLM output
    onScrollToPaper(index);
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground mb-2">
        共提取 {relations.length} 组变量关系
      </div>
      {relations.map((rel, i) => {
        const dirClass = directionColors[rel.direction ?? ""] ?? "text-gray-600 bg-gray-50 border-gray-200";
        const dirLabel = directionLabels[rel.direction ?? ""] ?? rel.direction ?? "未知";
        const sourceKey = `rel-${i}`;

        return (
          <div key={i} className="border border-border/60 rounded-lg p-3 bg-card hover:shadow-sm transition-shadow">
            {/* Main relationship: IV → DV */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs font-medium border border-emerald-200">
                IV: {rel.independentVar}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${dirClass}`}>
                {dirLabel === "正向" ? "→ +" : dirLabel === "负向" ? "→ −" : "→ ?"} {dirLabel}
              </span>
              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-medium border border-blue-200">
                DV: {rel.dependentVar}
              </span>
              {/* Source paper badges */}
              {rel.sources && rel.sources.length > 0 && (
                <span className="ml-auto flex items-center gap-1">
                  {rel.sources.map((src) => (
                    <button
                      key={src}
                      onClick={() => scrollToPaper(src)}
                      className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-medium border border-gray-300 hover:bg-teal/10 hover:text-teal hover:border-teal/30 transition-colors cursor-pointer"
                      title={papers && papers[src - 1] ? papers[src - 1].title : `Paper [${src}]`}
                    >
                      [{src}]
                    </button>
                  ))}
                </span>
              )}
            </div>

            {/* Mediators & Moderators */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rel.mediators && rel.mediators.length > 0 && rel.mediators.map((m, j) => (
                <span key={`med-${j}`} className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] border border-amber-200">
                  中介: {m}
                </span>
              ))}
              {rel.moderators && rel.moderators.length > 0 && rel.moderators.map((m, j) => (
                <span key={`mod-${j}`} className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px] border border-purple-200">
                  调节: {m}
                </span>
              ))}
            </div>

            {/* Effect size & Sample context */}
            {(rel.effectSize || rel.sampleContext) && (
              <div className="mt-1.5 text-[10px] text-muted-foreground flex gap-3">
                {rel.effectSize && <span>效应量: {rel.effectSize}</span>}
                {rel.sampleContext && <span>样本: {rel.sampleContext}</span>}
              </div>
            )}

            {/* Expandable source details */}
            {rel.sources && rel.sources.length > 0 && papers && (
              <div className="mt-1.5">
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => setExpandedSource(expandedSource === sourceKey ? null : sourceKey)}
                >
                  {expandedSource === sourceKey ? "收起来源" : `查看来源 (${rel.sources.length} 篇)`}
                </button>
                {expandedSource === sourceKey && (
                  <div className="mt-1 space-y-1">
                    {rel.sources.map((src) => {
                      const paper = papers[src - 1];
                      if (!paper) return null;
                      return (
                        <div
                          key={src}
                          className="text-[10px] pl-2 border-l-2 border-teal/30 cursor-pointer hover:bg-teal/5 rounded-r py-0.5"
                          onClick={() => scrollToPaper(src)}
                        >
                          <span className="font-medium text-teal">[{src}]</span>{" "}
                          <span className="text-foreground/80">{paper.title}</span>
                          <span className="text-muted-foreground ml-1">
                            ({paper.year ?? "N/A"}{paper.venue ? ` — ${paper.venue}` : ""})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
