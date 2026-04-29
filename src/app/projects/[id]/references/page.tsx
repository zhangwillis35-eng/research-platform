"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePersistedState } from "@/hooks/use-persisted-state";

type CitationStyle = "apa" | "mla" | "chicago" | "gb-t-7714" | "bibtex";

interface Paper {
  id: string;
  title: string;
  authors: { name: string }[];
  year?: number;
  venue?: string;
  doi?: string;
  folder?: string | null;
}

const STYLE_LABELS: Record<CitationStyle, string> = {
  apa: "APA 7th",
  mla: "MLA 9th",
  chicago: "Chicago",
  "gb-t-7714": "GB/T 7714",
  bibtex: "BibTeX",
};

export default function ReferencesPage() {
  const params = useParams();
  const projectId = params.id as string;
  const NS = `refs-${projectId}`;

  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [style, setStyle] = usePersistedState<CitationStyle>(NS, "style", "apa");
  const [citations, setCitations] = usePersistedState<string[]>(NS, "citations", []);
  const [generating, setGenerating] = useState(false);
  const [selectedIds, setSelectedIds] = usePersistedState<Set<string>>(NS, "selectedIds", new Set());
  const [copied, setCopied] = useState(false);

  // Load all catalog papers (not weekly)
  useEffect(() => {
    fetch(`/api/papers?projectId=${projectId}&source=catalog`)
      .then((r) => r.json())
      .then((d) => setPapers(d.papers ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  // Papers to generate references for
  const activePapers = selectedIds.size > 0
    ? papers.filter((p) => selectedIds.has(p.id))
    : papers;

  async function handleGenerate() {
    if (activePapers.length === 0) return;
    setGenerating(true);
    setCitations([]);

    try {
      const res = await fetch("/api/papers/cite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          papers: activePapers.map((p) => ({
            title: p.title,
            authors: p.authors,
            year: p.year,
            venue: p.venue,
            doi: p.doi,
          })),
          style,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setCitations(data.citations ?? []);
      }
    } catch {
      /* skip */
    } finally {
      setGenerating(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selectedIds.size === papers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(papers.map((p) => p.id)));
    }
  }

  function copyAll() {
    const text = citations.join("\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Sort citations alphabetically (standard for reference lists)
  const sortedCitations = [...citations].sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold">
          参考文献
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          从文献目录批量生成各类格式的参考文献列表
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Style selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">格式：</span>
          <div className="flex gap-1">
            {(Object.entries(STYLE_LABELS) as [CitationStyle, string][]).map(
              ([value, label]) => (
                <button
                  key={value}
                  onClick={() => { setStyle(value); setCitations([]); }}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                    style === value
                      ? "border-teal bg-teal/10 text-teal font-medium"
                      : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  {label}
                </button>
              )
            )}
          </div>
        </div>

        <div className="w-px h-6 bg-border/50" />

        {/* Select all */}
        <button
          onClick={selectAll}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {selectedIds.size === papers.length ? "取消全选" : "全选"}
          （{selectedIds.size > 0 ? `${selectedIds.size}/${papers.length}` : `${papers.length}`} 篇）
        </button>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            className="bg-teal text-teal-foreground hover:bg-teal/90 h-8 text-xs"
            onClick={handleGenerate}
            disabled={generating || activePapers.length === 0}
          >
            {generating ? "生成中..." : `生成 ${style.toUpperCase()} 参考文献`}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={async () => {
              const apiKey = localStorage.getItem("zotero_api_key");
              const userId = localStorage.getItem("zotero_user_id");
              if (!apiKey || !userId) { alert("请先在「设置」中配置 Zotero"); return; }
              try {
                const res = await fetch("/api/integrations/zotero", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "batch-add", apiKey, userId,
                    papers: activePapers.map(p => ({
                      title: p.title, authors: p.authors, year: p.year, venue: p.venue, doi: p.doi,
                    })),
                  }),
                });
                const data = await res.json();
                alert(`已导出 ${data.success ?? 0} 篇到 Zotero`);
              } catch { alert("导出失败"); }
            }}
            disabled={activePapers.length === 0}
          >
            导出到 Zotero
          </Button>
        </div>
      </div>

      {/* Paper selection list */}
      <div className="border border-border/50 rounded-lg divide-y divide-border/30 max-h-[300px] overflow-y-auto">
        {loading ? (
          <p className="text-sm text-muted-foreground p-4">加载中...</p>
        ) : papers.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4">
            文献目录为空，请先在「文献检索」中添加文献或在「文献库」中上传 PDF。
          </p>
        ) : (
          papers.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-3 px-3 py-2 text-xs hover:bg-muted/30 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedIds.size === 0 || selectedIds.has(p.id)}
                onChange={() => toggleSelect(p.id)}
                className="accent-teal w-3.5 h-3.5 shrink-0"
              />
              <span className="flex-1 min-w-0 truncate text-foreground/80">
                {p.title}
              </span>
              <span className="text-muted-foreground shrink-0">
                {p.authors?.[0]?.name}{p.authors?.length > 1 ? " et al." : ""}
                {p.year ? ` (${p.year})` : ""}
              </span>
              {p.doi && (
                <Badge variant="outline" className="text-[9px] shrink-0">DOI</Badge>
              )}
            </label>
          ))
        )}
      </div>

      {/* Generated citations */}
      {sortedCitations.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {STYLE_LABELS[style]} 参考文献（{sortedCitations.length} 篇）
            </h2>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={copyAll}
            >
              {copied ? "已复制 ✓" : "复制全部"}
            </Button>
          </div>

          <div className="border border-border/50 rounded-lg bg-muted/20 p-4 space-y-3 max-h-[50vh] overflow-y-auto">
            {style === "bibtex" ? (
              // BibTeX: monospace code block
              <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono text-foreground/80">
                {sortedCitations.join("\n\n")}
              </pre>
            ) : (
              // Other styles: numbered list with hanging indent
              <ol className="list-none space-y-2">
                {sortedCitations.map((c, i) => (
                  <li key={i} className="text-xs leading-relaxed text-foreground/80 pl-8 -indent-8">
                    [{i + 1}] {c}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
