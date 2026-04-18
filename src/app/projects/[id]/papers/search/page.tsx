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

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">文献检索</h1>
        <p className="text-muted-foreground mt-1">
          多源聚合搜索，自动去重整合
        </p>
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

      {/* Source Stats */}
      {meta && (
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
            <Card key={i} className="transition-colors hover:border-foreground/10">
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
