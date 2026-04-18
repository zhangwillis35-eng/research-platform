"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface Paper {
  id: string;
  title: string;
  authors: { name: string }[];
  year?: number;
  venue?: string;
  citationCount: number;
  doi?: string;
  isSelected: boolean;
  source: string;
}

export default function PapersPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/papers?projectId=${projectId}`)
      .then((r) => r.json())
      .then((data) => setPapers(data.papers ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  async function toggleSelected(paperId: string, current: boolean) {
    await fetch(`/api/papers/${paperId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isSelected: !current }),
    });
    setPapers((prev) =>
      prev.map((p) => (p.id === paperId ? { ...p, isSelected: !current } : p))
    );
  }

  async function deletePaper(paperId: string) {
    await fetch(`/api/papers/${paperId}`, { method: "DELETE" });
    setPapers((prev) => prev.filter((p) => p.id !== paperId));
  }

  const selected = papers.filter((p) => p.isSelected);
  const others = papers.filter((p) => !p.isSelected);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-serif-sc)] text-2xl font-bold">
            文献库
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {papers.length} 篇文献 · {selected.length} 篇核心文献
          </p>
        </div>
        <Link href={`/projects/${projectId}/papers/search`}>
          <Button className="bg-teal text-teal-foreground hover:bg-teal/90">
            + 检索文献
          </Button>
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : papers.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <div className="text-4xl mb-4">📄</div>
          <p className="font-medium">暂无文献</p>
          <p className="text-sm mt-2">前往「文献检索」搜索并添加文献</p>
        </div>
      ) : (
        <>
          {/* Core papers */}
          {selected.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-teal mb-3">
                核心文献（{selected.length}）
              </h2>
              <div className="space-y-2">
                {selected.map((p) => (
                  <PaperRow
                    key={p.id}
                    paper={p}
                    onToggle={() => toggleSelected(p.id, p.isSelected)}
                    onDelete={() => deletePaper(p.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Other papers */}
          {others.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">
                全部文献（{others.length}）
              </h2>
              <div className="space-y-2">
                {others.map((p) => (
                  <PaperRow
                    key={p.id}
                    paper={p}
                    onToggle={() => toggleSelected(p.id, p.isSelected)}
                    onDelete={() => deletePaper(p.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PaperRow({
  paper,
  onToggle,
  onDelete,
}: {
  paper: Paper;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 border border-border/50 rounded-lg hover:border-border transition-colors">
      <input
        type="checkbox"
        checked={paper.isSelected}
        onChange={onToggle}
        className="accent-teal shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{paper.title}</p>
        <p className="text-xs text-muted-foreground">
          {paper.authors?.slice(0, 2).map((a) => a.name).join(", ")}
          {paper.year ? ` (${paper.year})` : ""}
          {paper.venue ? ` — ${paper.venue}` : ""}
        </p>
      </div>
      <Badge variant="outline" className="text-[10px] shrink-0">
        引用 {paper.citationCount}
      </Badge>
      <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={onDelete}>
        删除
      </Button>
    </div>
  );
}
