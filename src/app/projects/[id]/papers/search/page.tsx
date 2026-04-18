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

interface JournalMeta {
  impactFactor?: number;
  sjrQuartile?: string;
  ssci: boolean;
  sci: boolean;
  casZone?: string;
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
  journalMeta?: JournalMeta;
}

interface SearchMeta {
  total: number;
  sources: Array<{ source: string; count: number }>;
}

type SortBy = "citations" | "year_desc" | "year_asc" | "relevance";

interface SearchPlan {
  translatedInput?: string;
  keyTerms: string[];
  synonyms: Record<string, string[]>;
  precisionQueries: string[];
  broadQueries: string[];
}

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
  SSCI: "bg-blue-600 text-white",
  SCI: "bg-cyan-600 text-white",
  Q1: "bg-emerald-600 text-white",
  Q2: "bg-lime-600 text-white",
  Q3: "bg-yellow-600 text-white",
  Q4: "bg-gray-500 text-white",
  "中科院一区": "bg-red-700 text-white",
  "中科院二区": "bg-orange-600 text-white",
  "中科院三区": "bg-sky-600 text-white",
  "中科院四区": "bg-gray-400 text-white",
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
  const [filterRanking, setFilterRanking] = useState<string>("all");
  const [searchPlan, setSearchPlan] = useState<SearchPlan | null>(null);
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
    setSearchPlan(null);

    try {
      // Use smart search: AI extracts keywords + generates synonyms
      const res = await fetch("/api/research/smart-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, provider: aiProvider, limit: 20 }),
      });

      if (!res.ok) {
        // Fallback to basic search if smart search fails
        const fallbackRes = await fetch("/api/papers/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, limit: 30 }),
        });
        if (!fallbackRes.ok) throw new Error("Search failed");
        const fallbackData = await fallbackRes.json();
        setPapers(fallbackData.papers);
        setMeta(fallbackData.meta);
        return;
      }

      const data = await res.json();
      setPapers(data.papers);
      setSearchPlan(data.plan);
      setMeta({
        total: data.stats.total,
        sources: Object.entries(data.stats.byQuery).map(([source, count]) => ({
          source,
          count: count as number,
        })),
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
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
          let sseBuffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() ?? "";
            for (const line of lines) {
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

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <Input
          placeholder="输入研究主题（中英文均可），如：AI washing 与企业信息披露"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={loading} className="bg-teal text-teal-foreground hover:bg-teal/90">
          {loading ? "智能搜索中..." : "智能搜索"}
        </Button>
      </form>

      {/* Search Plan Display */}
      {searchPlan && (
        <Card className="border-teal/20 bg-teal/[0.02]">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm text-teal">检索策略</CardTitle>
              <span className="text-[10px] text-muted-foreground">AI 自动提取关键词 + 同义词扩展</span>
            </div>

            {/* Translation */}
            {searchPlan.translatedInput && (
              <p className="text-xs text-muted-foreground">
                翻译: <span className="text-foreground font-medium">{searchPlan.translatedInput}</span>
              </p>
            )}

            {/* Key terms + synonyms */}
            <div className="space-y-2">
              {searchPlan.keyTerms.map((term) => (
                <div key={term} className="flex items-start gap-2 text-xs">
                  <Badge className="bg-teal text-teal-foreground text-[10px] shrink-0">{term}</Badge>
                  {searchPlan.synonyms[term]?.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-muted-foreground">同义词:</span>
                      {searchPlan.synonyms[term].map((syn) => (
                        <Badge key={syn} variant="secondary" className="text-[10px]">{syn}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Actual queries sent */}
            <div className="border-t border-border/50 pt-2 space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium">精准检索式：</p>
              {searchPlan.precisionQueries.map((q, i) => (
                <p key={i} className="text-[11px] font-mono text-foreground/80 pl-2">{q}</p>
              ))}
              <p className="text-[10px] text-muted-foreground font-medium mt-1">广度检索式（含同义词）：</p>
              {searchPlan.broadQueries.map((q, i) => (
                <p key={i} className="text-[11px] font-mono text-foreground/80 pl-2 break-all">{q}</p>
              ))}
              {/* Quick links to other databases */}
              <div className="flex items-center gap-2 pt-2 border-t border-border/30 mt-2">
                <span className="text-[10px] text-muted-foreground">在其他平台搜索：</span>
                <a
                  href={`https://kns.cnki.net/kns8s/search?classid=WD0FTY92&korder=SU&kw=${encodeURIComponent(searchPlan.keyTerms.join(" "))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-orange-600 hover:underline font-medium"
                >
                  知网 CNKI
                </a>
                <a
                  href={`https://scholar.google.com/scholar?q=${encodeURIComponent(searchPlan.precisionQueries.join(" "))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-blue-600 hover:underline font-medium"
                >
                  Google Scholar
                </a>
                <a
                  href={`https://www.webofscience.com/wos/alldb/basic-search?q=${encodeURIComponent(searchPlan.keyTerms.join(" "))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-purple-600 hover:underline font-medium"
                >
                  Web of Science
                </a>
                <a
                  href={`https://www.scopus.com/results/results.uri?sort=r-f&src=s&sid=scholarflow&sot=a&sdt=a&sl=30&s=TITLE-ABS-KEY(${encodeURIComponent(searchPlan.keyTerms.join(" AND "))})`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-teal hover:underline font-medium"
                >
                  Scopus
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
              {/* Row 1: checkbox + title */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedPapers.has(i)}
                  onChange={() => togglePaper(i)}
                  className="accent-teal mt-1.5 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-[15px] leading-snug group-hover:text-teal transition-colors">
                    {paper.title}
                  </h3>
                  {/* Row 2: authors + year + venue */}
                  <p className="text-xs text-muted-foreground mt-1">
                    {paper.authors.slice(0, 3).map((a) => a.name).join(", ")}
                    {paper.authors.length > 3 && " et al."}
                    {paper.year && ` (${paper.year})`}
                    {paper.venue && ` — ${paper.venue}`}
                  </p>
                  {/* Row 3: abstract */}
                  {paper.abstract && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-2">
                      {paper.abstract}
                    </p>
                  )}
                  {/* Row 4: actions (left) + badges (right) */}
                  <div className="flex items-center justify-between mt-3 gap-2">
                    {/* Left: action buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button size="sm" variant="outline" className="h-6 text-[11px] px-2">
                        添加到文献库
                      </Button>
                      {(paper.openAccessPdf || paper.unpaywallUrl) && (
                        <a href={paper.openAccessPdf || paper.unpaywallUrl} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2 text-green-600">PDF</Button>
                        </a>
                      )}
                      {paper.doi && (
                        <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2">DOI</Button>
                        </a>
                      )}
                      {paper.connectedPapersUrl && (
                        <a href={paper.connectedPapersUrl} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2 text-teal">Related</Button>
                        </a>
                      )}
                      <a href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2">Scholar</Button>
                      </a>
                      <a href={`https://kns.cnki.net/kns8s/search?classid=WD0FTY92&korder=SU&kw=${encodeURIComponent(paper.title)}`} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2 text-orange-600">知网</Button>
                      </a>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px] px-2 text-purple-600"
                        onClick={() => {
                          const obsUrl = localStorage.getItem("obsidian_base_url") || "https://127.0.0.1:27124";
                          const apiKey = localStorage.getItem("obsidian_api_key") || "";
                          const filename = paper.title.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
                          const notePath = `ScholarFlow/Papers/${filename}.md`;
                          const content = `---\ntitle: "${paper.title}"\nyear: ${paper.year ?? "unknown"}\nvenue: "${paper.venue ?? ""}"\ndoi: "${paper.doi ?? ""}"\ntags: [paper]\n---\n\n# ${paper.title}\n\n${paper.authors.map((a) => a.name).join(", ")} (${paper.year ?? "N/A"})\n${paper.venue ?? ""}\n\n## 摘要\n${paper.abstract ?? "_No abstract_"}\n`;
                          const hdrs: HeadersInit = { "Content-Type": "text/markdown" };
                          if (apiKey) hdrs["Authorization"] = `Bearer ${apiKey}`;
                          fetch(`${obsUrl}/vault/${encodeURIComponent(notePath)}`, { method: "PUT", headers: hdrs, body: content })
                            .then(() => alert("已推送到 Obsidian"))
                            .catch(() => alert("推送失败"));
                        }}
                      >
                        Obsidian
                      </Button>
                    </div>
                    {/* Right: metadata + badges */}
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      {paper.journalMeta?.impactFactor != null && (
                        <span className="text-[10px] font-mono text-teal font-bold whitespace-nowrap">
                          IF {paper.journalMeta.impactFactor.toFixed(1)}
                        </span>
                      )}
                      {paper.journalRanking?.badges?.map((badge) => (
                        <Badge
                          key={badge}
                          className={`text-[9px] px-1 py-0 font-bold leading-tight ${rankingColors[badge] ?? "bg-gray-400 text-white"}`}
                        >
                          {badge}
                        </Badge>
                      ))}
                      <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                        {paper.citationCount.toLocaleString()} 引用
                      </span>
                    </div>
                  </div>
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
