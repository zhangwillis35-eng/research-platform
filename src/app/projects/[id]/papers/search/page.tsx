"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AIProviderSelect,
  type AIProvider,
} from "@/components/ai-provider-select";

interface Author {
  name: string;
}

interface JournalBadges {
  ft50: boolean;
  utd24: boolean;
  abs4star: boolean;
  badges: string[];
}

interface Paper {
  title: string;
  abstract?: string;
  authors: Author[];
  year?: number;
  venue?: string;
  citationCount: number;
  doi?: string;
  source: string;
  openAccessPdf?: string;
  unpaywallUrl?: string;
  connectedPapersUrl?: string;
  journalRanking?: JournalBadges;
}

interface SearchMeta {
  total: number;
  sources: Array<{ source: string; count: number }>;
}

type SortBy = "citations" | "year_desc" | "year_asc" | "relevance";
type SearchMode = "precision" | "broad" | "both";

const sourceLabels: Record<string, string> = {
  semantic_scholar: "Semantic Scholar",
  openalex: "OpenAlex",
  google_scholar: "Google Scholar",
};

const sourceColors: Record<string, string> = {
  semantic_scholar: "bg-blue-100 text-blue-800",
  openalex: "bg-green-100 text-green-800",
  google_scholar: "bg-orange-100 text-orange-800",
};

const rankingColors: Record<string, string> = {
  UTD24: "bg-red-600 text-white",
  FT50: "bg-amber-500 text-white",
  "ABS 4*": "bg-purple-600 text-white",
};

function sortPapers(papers: Paper[], sortBy: SortBy): Paper[] {
  const sorted = [...papers];
  switch (sortBy) {
    case "citations":
      return sorted.sort((a, b) => b.citationCount - a.citationCount);
    case "year_desc":
      return sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    case "year_asc":
      return sorted.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
    case "relevance":
    default:
      return sorted; // keep original order (relevance from API)
  }
}

export default function PaperSearchPage() {
  const [query, setQuery] = useState("");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<AIProvider>("gemini");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("citations");
  const [searchMode, setSearchMode] = useState<SearchMode>("both");
  const [filterRanking, setFilterRanking] = useState<string>("all");
  const [deepSearching, setDeepSearching] = useState(false);
  const [researchPlan, setResearchPlan] = useState<{ mainQuestion: string; subQuestions: string[]; perspectives: string[] } | null>(null);
  const [selectedPapers, setSelectedPapers] = useState<Set<number>>(new Set());

  function togglePaper(index: number) {
    setSelectedPapers((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectAll() {
    if (selectedPapers.size === displayedPapers.length) {
      setSelectedPapers(new Set());
    } else {
      setSelectedPapers(new Set(displayedPapers.map((_, i) => i)));
    }
  }

  function exportForNotebookLM() {
    const selected = displayedPapers.filter((_, i) => selectedPapers.has(i));
    const exportData = {
      papers: selected.map((p) => ({
        title: p.title,
        doi: p.doi,
        openAccessPdf: p.openAccessPdf,
        unpaywallUrl: p.unpaywallUrl,
        venue: p.venue,
        year: p.year,
        rankings: p.journalRanking?.badges,
      })),
      urls: selected
        .map((p) => p.openAccessPdf || p.unpaywallUrl || (p.doi ? `https://doi.org/${p.doi}` : null))
        .filter(Boolean),
    };

    // Download as JSON
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scholarflow-papers-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setAnalysisResult(null);

    try {
      if (searchMode === "both") {
        // Run precision + broad search in parallel
        const [precisionRes, broadRes] = await Promise.all([
          fetch("/api/papers/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `"${query}"`, // exact phrase for precision
              limit: 20,
            }),
          }),
          fetch("/api/papers/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query, // natural language for broad
              limit: 30,
            }),
          }),
        ]);

        const precisionData = precisionRes.ok ? await precisionRes.json() : { papers: [], meta: { total: 0, sources: [] } };
        const broadData = broadRes.ok ? await broadRes.json() : { papers: [], meta: { total: 0, sources: [] } };

        // Merge and deduplicate
        const allPapers = [...precisionData.papers, ...broadData.papers];
        const seen = new Map<string, Paper>();
        for (const p of allPapers) {
          const key = p.doi?.toLowerCase() || p.title?.toLowerCase().slice(0, 80);
          if (!seen.has(key)) seen.set(key, p);
        }
        const merged = Array.from(seen.values());
        setPapers(merged);
        setMeta({
          total: merged.length,
          sources: broadData.meta?.sources ?? [],
        });
      } else {
        const searchQuery = searchMode === "precision" ? `"${query}"` : query;
        const res = await fetch("/api/papers/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: searchQuery, limit: 30 }),
        });

        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setPapers(data.papers);
        setMeta(data.meta);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleDeepSearch() {
    if (!query.trim()) return;
    setDeepSearching(true);
    setError(null);
    setResearchPlan(null);
    setAnalysisResult(null);

    try {
      const res = await fetch("/api/research/deep-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: query, provider: aiProvider }),
      });
      if (!res.ok) throw new Error("Deep search failed");
      const data = await res.json();
      setPapers(data.papers);
      setResearchPlan(data.plan);
      setMeta({
        total: data.stats.afterDedup,
        sources: [
          { source: "deep_search", count: data.stats.afterDedup },
        ],
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setDeepSearching(false);
    }
  }

  async function handleAnalyze(type: "variables" | "review" | "ideas") {
    if (displayedPapers.length === 0) return;
    setAnalyzing(true);
    setAnalysisResult(null);

    const content = displayedPapers
      .slice(0, 15)
      .map(
        (p, i) =>
          `[${i + 1}] ${p.title}\n${p.authors.map((a) => a.name).join(", ")} (${p.year ?? "N/A"})${p.venue ? ` — ${p.venue}` : ""}${p.journalRanking?.badges?.length ? ` [${p.journalRanking.badges.join(", ")}]` : ""}\n${p.abstract ?? "No abstract"}`
      )
      .join("\n\n---\n\n");

    try {
      if (type === "review") {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: aiProvider,
            system: `你是管理学文献综述专家。基于用户提供的文献信息，生成结构化文献综述。请按以下结构：
1. 研究主题聚类
2. 时间演进脉络
3. 研究Gap
4. 未来方向
注意标注各文献的期刊等级（UTD24/FT50/ABS4*），用中文、学术写作风格。`,
            messages: [{ role: "user", content }],
          }),
        });

        if (!res.ok) throw new Error("Analysis failed");
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let result = "";
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            for (const line of chunk.split("\n")) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.text) {
                    result += data.text;
                    setAnalysisResult(result);
                  }
                } catch { /* skip */ }
              }
            }
          }
        }
      } else {
        const res = await fetch("/api/ai/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: aiProvider, type, content }),
        });
        if (!res.ok) throw new Error("Analysis failed");
        const data = await res.json();
        setAnalysisResult(
          typeof data.result === "string"
            ? data.result
            : JSON.stringify(data.result, null, 2)
        );
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  // Apply sort and filter
  let displayedPapers = sortPapers(papers, sortBy);
  if (filterRanking !== "all") {
    displayedPapers = displayedPapers.filter((p) =>
      p.journalRanking?.badges?.includes(filterRanking)
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-serif-sc)] text-2xl font-bold">
            文献检索
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            多源聚合搜索 · 精准/广度双模式 · 期刊排名标注
          </p>
        </div>
        <AIProviderSelect value={aiProvider} onChange={setAiProvider} />
      </div>

      {/* Search Bar + Mode */}
      <form onSubmit={handleSearch} className="space-y-3">
        <div className="flex gap-3">
          <Input
            placeholder="输入研究主题，如 digital transformation organizational resilience"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={loading || deepSearching} className="bg-teal text-teal-foreground hover:bg-teal/90">
            {loading ? "搜索中..." : "搜索"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleDeepSearch}
            disabled={loading || deepSearching || !query.trim()}
          >
            {deepSearching ? "深度研究中..." : "深度研究"}
          </Button>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">检索模式：</span>
          <div className="flex gap-1">
            {[
              { value: "both" as const, label: "精准+广度" },
              { value: "precision" as const, label: "精准检索" },
              { value: "broad" as const, label: "广度检索" },
            ].map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => setSearchMode(mode.value)}
                className={`px-3 py-1 rounded-md transition-colors ${
                  searchMode === mode.value
                    ? "bg-teal/10 text-teal font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      </form>

      {/* Controls bar */}
      {meta && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              共 {displayedPapers.length} 篇
              {filterRanking !== "all" && ` (筛选自 ${papers.length} 篇)`}
            </span>
            <div className="flex gap-1.5">
              {meta.sources.map((s) => (
                <Badge
                  key={s.source}
                  variant="secondary"
                  className={`text-xs ${sourceColors[s.source] ?? ""}`}
                >
                  {sourceLabels[s.source] ?? s.source}: {s.count}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Sort */}
            <Select value={sortBy} onValueChange={(v) => v && setSortBy(v as SortBy)}>
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

            {/* Filter by ranking */}
            <Select value={filterRanking} onValueChange={(v) => v && setFilterRanking(v)}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部期刊</SelectItem>
                <SelectItem value="UTD24">仅 UTD24</SelectItem>
                <SelectItem value="FT50">仅 FT50</SelectItem>
                <SelectItem value="ABS 4*">仅 ABS 4*</SelectItem>
              </SelectContent>
            </Select>

            {/* AI Actions */}
            <Separator orientation="vertical" className="h-6" />
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleAnalyze("variables")} disabled={analyzing}>
              提取变量
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleAnalyze("review")} disabled={analyzing}>
              生成综述
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleAnalyze("ideas")} disabled={analyzing}>
              生成想法
            </Button>
          </div>
        </div>
      )}

      {/* Research Plan (from deep search) */}
      {researchPlan && (
        <Card className="border-teal/20 bg-teal/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-teal">深度研究计划</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="font-medium">{researchPlan.mainQuestion}</p>
            <div>
              <p className="text-xs text-muted-foreground mb-1">子问题：</p>
              {researchPlan.subQuestions.map((q, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  {i + 1}. {q}
                </p>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {researchPlan.perspectives.map((p) => (
                <Badge key={p} variant="secondary" className="text-[10px]">
                  {p}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Analysis Result */}
      {(analysisResult || analyzing) && (
        <Card className="border-teal/20 bg-teal/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              AI 分析结果
              {analyzing && (
                <span className="text-xs text-muted-foreground animate-pulse">
                  分析中...
                </span>
              )}
              <Badge variant="secondary" className="text-xs ml-auto">
                {
                  {
                    gemini: "Gemini 3.1 Pro",
                    chatgpt: "GPT-5",
                    deepseek: "DeepSeek Reasoning",
                    claude: "Claude Sonnet 4",
                  }[aiProvider]
                }
              </Badge>
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">
              {analysisResult}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Selection bar */}
      {!loading && displayedPapers.length > 0 && selectedPapers.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-teal/5 border border-teal/20 rounded-lg text-sm">
          <span className="font-medium text-teal">
            已选 {selectedPapers.size} 篇
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportForNotebookLM}>
            导出并上传到 NotebookLM
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedPapers(new Set())}>
            清除选择
          </Button>
        </div>
      )}

      {/* Results */}
      {!loading && displayedPapers.length > 0 && (
        <div className="space-y-2">
          {/* Select all */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={selectedPapers.size === displayedPapers.length && displayedPapers.length > 0}
              onChange={selectAll}
              className="accent-teal"
            />
            <span>全选</span>
          </div>
          {displayedPapers.map((paper, i) => (
            <div
              key={i}
              className="group border border-border/50 rounded-lg p-4 hover:border-teal/20 transition-all duration-150 bg-card"
            >
              {/* Title row */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedPapers.has(i)}
                  onChange={() => togglePaper(i)}
                  className="accent-teal mt-1 shrink-0"
                />
                <div className="flex items-start justify-between gap-3 flex-1 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-[15px] leading-snug group-hover:text-teal transition-colors">
                      {paper.title}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <CardDescription className="text-xs">
                      {paper.authors
                        .slice(0, 3)
                        .map((a) => a.name)
                        .join(", ")}
                      {paper.authors.length > 3 && " et al."}
                      {paper.year && ` (${paper.year})`}
                      {paper.venue && ` — ${paper.venue}`}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  {/* Journal ranking badges */}
                  {paper.journalRanking?.badges && paper.journalRanking.badges.length > 0 && (
                    <div className="flex gap-1">
                      {paper.journalRanking.badges.map((badge) => (
                        <Badge
                          key={badge}
                          className={`text-[10px] px-1.5 py-0 font-bold ${rankingColors[badge] ?? "bg-gray-500 text-white"}`}
                        >
                          {badge}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    引用 {paper.citationCount.toLocaleString()}
                  </span>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] ${sourceColors[paper.source] ?? ""}`}
                  >
                    {sourceLabels[paper.source] ?? paper.source}
                  </Badge>
                </div>
              </div>

              {/* Abstract */}
              {paper.abstract && (
                <p className="text-sm text-muted-foreground line-clamp-2 mt-2.5">
                  {paper.abstract}
                </p>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 mt-3">
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  添加到文献库
                </Button>
                {(paper.openAccessPdf || paper.unpaywallUrl) && (
                  <a
                    href={paper.openAccessPdf || paper.unpaywallUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-green-600">
                      PDF (Open Access)
                    </Button>
                  </a>
                )}
                {paper.doi && (
                  <a
                    href={`https://doi.org/${paper.doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="sm" variant="ghost" className="h-7 text-xs">
                      DOI
                    </Button>
                  </a>
                )}
                {paper.connectedPapersUrl && (
                  <a
                    href={paper.connectedPapersUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-teal">
                      Connected Papers
                    </Button>
                  </a>
                )}
                {paper.doi && (
                  <a
                    href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="sm" variant="ghost" className="h-7 text-xs">
                      Google Scholar
                    </Button>
                  </a>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-purple-600"
                  onClick={() => {
                    const apiKey = localStorage.getItem("obsidian_api_key");
                    if (!apiKey) { alert("请先在项目设置中配置 Obsidian API Key"); return; }
                    fetch("/api/integrations/obsidian", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "push-paper",
                        config: { apiKey },
                        paper: {
                          title: paper.title,
                          authors: paper.authors.map((a) => a.name).join(", "),
                          year: paper.year,
                          venue: paper.venue,
                          doi: paper.doi,
                          abstract: paper.abstract,
                          rankings: paper.journalRanking?.badges,
                        },
                      }),
                    });
                  }}
                >
                  → Obsidian
                </Button>
              </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && displayedPapers.length === 0 && meta && (
        <div className="text-center py-12 text-muted-foreground">
          {filterRanking !== "all"
            ? `无 ${filterRanking} 期刊文献，尝试切换筛选条件`
            : "未找到相关文献，请尝试其他关键词"}
        </div>
      )}
    </div>
  );
}
