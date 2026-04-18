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
  AIProviderSelect,
  type AIProvider,
} from "@/components/ai-provider-select";

interface Author {
  name: string;
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
}

interface SearchMeta {
  total: number;
  sources: Array<{ source: string; count: number }>;
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

export default function PaperSearchPage() {
  const [query, setQuery] = useState("");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<AIProvider>("gemini");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setAnalysisResult(null);

    try {
      const res = await fetch("/api/papers/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 30 }),
      });

      if (!res.ok) throw new Error("Search failed");

      const data = await res.json();
      setPapers(data.papers);
      setMeta(data.meta);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyze(type: "variables" | "review" | "ideas") {
    if (papers.length === 0) return;
    setAnalyzing(true);
    setAnalysisResult(null);

    const content = papers
      .slice(0, 15)
      .map(
        (p, i) =>
          `[${i + 1}] ${p.title}\n${p.authors.map((a) => a.name).join(", ")} (${p.year ?? "N/A"})\n${p.abstract ?? "No abstract"}`
      )
      .join("\n\n---\n\n");

    try {
      if (type === "review") {
        // Stream review generation
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
用中文、学术写作风格。`,
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
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.text) {
                    result += data.text;
                    setAnalysisResult(result);
                  }
                } catch {
                  // skip parse errors
                }
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">文献检索</h1>
          <p className="text-muted-foreground mt-1">
            多源聚合搜索，自动去重整合
          </p>
        </div>
        <AIProviderSelect value={aiProvider} onChange={setAiProvider} />
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <Input
          placeholder="输入研究主题，如 servant leadership and performance"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={loading}>
          {loading ? "搜索中..." : "搜索"}
        </Button>
      </form>

      {/* Source Stats + AI Actions */}
      {meta && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              共找到 {meta.total} 篇文献
            </span>
            <div className="flex gap-2">
              {meta.sources.map((s) => (
                <Badge
                  key={s.source}
                  variant="secondary"
                  className={sourceColors[s.source]}
                >
                  {sourceLabels[s.source] ?? s.source}: {s.count}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleAnalyze("variables")}
              disabled={analyzing}
            >
              提取变量关系
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleAnalyze("review")}
              disabled={analyzing}
            >
              生成文献综述
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleAnalyze("ideas")}
              disabled={analyzing}
            >
              生成研究想法
            </Button>
          </div>
        </div>
      )}

      {/* AI Analysis Result */}
      {(analysisResult || analyzing) && (
        <Card className="border-primary/20">
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
                    gemini: "Gemini 2.5 Flash",
                    chatgpt: "GPT-4o Mini",
                    deepseek: "DeepSeek Chat",
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
        <div className="space-y-4">
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

      {/* Results */}
      {!loading && papers.length > 0 && (
        <div className="space-y-3">
          {papers.map((paper, i) => (
            <Card
              key={i}
              className="transition-colors hover:border-foreground/10"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <CardTitle className="text-base leading-snug">
                      {paper.title}
                    </CardTitle>
                    <CardDescription className="mt-1.5">
                      {paper.authors
                        .slice(0, 3)
                        .map((a) => a.name)
                        .join(", ")}
                      {paper.authors.length > 3 && " et al."}
                      {paper.year && ` (${paper.year})`}
                      {paper.venue && ` — ${paper.venue}`}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="outline" className="text-xs">
                      引用 {paper.citationCount}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className={`text-xs ${sourceColors[paper.source] ?? ""}`}
                    >
                      {sourceLabels[paper.source] ?? paper.source}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              {paper.abstract && (
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {paper.abstract}
                  </p>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline">
                      添加到文献库
                    </Button>
                    {paper.openAccessPdf && (
                      <a
                        href={paper.openAccessPdf}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button size="sm" variant="ghost">
                          下载 PDF
                        </Button>
                      </a>
                    )}
                    {paper.doi && (
                      <a
                        href={`https://doi.org/${paper.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button size="sm" variant="ghost">
                          DOI
                        </Button>
                      </a>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && papers.length === 0 && meta && (
        <div className="text-center py-12 text-muted-foreground">
          未找到相关文献，请尝试其他关键词
        </div>
      )}
    </div>
  );
}
