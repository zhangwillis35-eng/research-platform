"use client";

import { useState, useEffect } from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AIProviderSelect,
  type AIProvider,
} from "@/components/ai-provider-select";
import {
  AnalysisEngineSelect,
  type AnalysisEngine,
} from "@/components/analysis-engine-select";
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";
import { consumeCrossFeatureData } from "@/lib/cross-feature";

interface Paper {
  id: string;
  title: string;
  abstract?: string;
  authors: { name: string }[];
  year?: number;
  venue?: string;
  citationCount: number;
  isSelected: boolean;
  fullText?: string | null;
  pdfFileName?: string | null;
}

interface OutlineSection {
  heading: string;
  perspective: string;
  keyFindings: string[];
  paperRefs: number[];
}

interface ReviewOutline {
  title: string;
  perspectives: string[];
  sections: OutlineSection[];
  gaps: string[];
  futureDirections: string[];
}

type Phase = "idle" | "outlining" | "writing" | "done";

export default function ReviewGeneratePage() {
  const params = useParams();
  const projectId = params.id as string;

  const NS = `review-${projectId}`;
  const [topic, setTopic] = usePersistedState<string>(NS, "topic", "");
  const [provider, setProvider] = usePersistedState<AIProvider>(NS, "provider", "deepseek-fast");
  const [outline, setOutline] = usePersistedState<ReviewOutline | null>(NS, "outline", null);
  const [reviewText, setReviewText] = usePersistedState<string>(NS, "reviewText", "");
  const [papers, setPapers] = usePersistedState<Paper[]>(NS, "papers", []);
  const [analysisEngine, setAnalysisEngine] = usePersistedState<AnalysisEngine>(NS, "engine", "builtin");

  // Transient state
  const [phase, setPhase] = useState<Phase>("idle");
  const [papersLoading, setPapersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crossFeatureBanner, setCrossFeatureBanner] = useState<string | null>(null);
  const xAbort = useAbort();

  // Load papers with full text from project library
  useEffect(() => {
    setPapersLoading(true);
    fetch(`/api/papers?projectId=${projectId}&source=fulltext`)
      .then((r) => r.json())
      .then((d) => setPapers(d.papers ?? []))
      .catch(() => {})
      .finally(() => setPapersLoading(false));
  }, [projectId]);

  // Check for cross-feature data (field takeaways context)
  useEffect(() => {
    const data = consumeCrossFeatureData("review", projectId);
    if (data) {
      setCrossFeatureBanner("来自「领域要点」的分析结果已导入，可作为综述撰写的参考");
      sessionStorage.setItem(`${NS}:crossContext`, data.content);
    }
  }, [projectId]);

  const activePapers = papers;

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || activePapers.length === 0) return;

    const signal = xAbort.reset();
    setError(null);
    setOutline(null);
    setReviewText("");

    // Optional: STORM pre-analysis
    if (analysisEngine === "storm") {
      setPhase("outlining");
      try {
        const stormRes = await fetch("/api/integrations/storm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "analyze",
            topic,
            papers: activePapers.slice(0, 25).map((p) => ({
              title: p.title, abstract: p.abstract, year: p.year, venue: p.venue,
              fullText: p.fullText?.slice(0, 5000),
            })),
          }),
          signal,
        });
        if (stormRes.ok) {
          await stormRes.json();
        }
      } catch { /* continue */ }
    }

    // Generate outline + stream review
    setPhase("outlining");

    const papersForReview = activePapers.map((p) => ({
      ...p,
      fullText: p.fullText?.slice(0, 5000),
    }));

    try {
      const reviewRes = await fetch("/api/research/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, papers: papersForReview, provider }),
        signal,
      });

      if (!reviewRes.ok) throw new Error("综述生成失败");

      const reader = reviewRes.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let text = "";
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "outline") {
                setOutline(data.outline);
                setPhase("writing");
              } else if (data.type === "text") {
                text += data.text;
                setReviewText(text);
              } else if (data.type === "done") {
                setPhase("done");
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") { setPhase("idle"); return; }
      setError(String(err));
      setPhase("idle");
    }
  }

  const phaseLabels: Record<Phase, string> = {
    idle: "",
    outlining: "正在生成大纲...",
    writing: "正在撰写综述...",
    done: "综述生成完成",
  };

  return (
    <div className="space-y-6">
      {crossFeatureBanner && (
        <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
          <span>{crossFeatureBanner}</span>
          <button onClick={() => setCrossFeatureBanner(null)} className="text-blue-400 hover:text-blue-600">&times;</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href={`/projects/${projectId}/review`} className="text-xs text-muted-foreground hover:text-foreground">
              ← 文献综述
            </Link>
          </div>
          <h1 className="font-heading text-2xl font-bold">
            综述初稿生成
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            STORM 式多视角综述 · 自动大纲 · 流式撰写
          </p>
        </div>
        <AnalysisEngineSelect value={analysisEngine} onChange={setAnalysisEngine} />
        <AIProviderSelect value={provider} onChange={setProvider} />
      </div>

      {/* Paper source panel */}
      <Card className="border-teal/20 bg-teal/[0.02]">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-teal">数据来源：项目文献库（已上传原文）</span>
              {papersLoading ? (
                <Skeleton className="h-5 w-20" />
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  {papers.length} 篇文献{papers.filter((p) => p.isSelected).length > 0 &&
                    ` · ${papers.filter((p) => p.isSelected).length} 篇核心`}
                </Badge>
              )}
            </div>
            <Link href={`/projects/${projectId}/papers/search`}>
              <Button size="sm" variant="outline" className="h-7 text-xs">
                去检索更多文献
              </Button>
            </Link>
          </div>

          {papers.length > 0 && (
            <div className="flex items-center gap-4 text-xs">
              <span className="text-muted-foreground ml-auto">
                将分析 {activePapers.length} 篇文献
              </span>
            </div>
          )}

          {!papersLoading && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
              {papers.length === 0
                ? "暂无已上传原文的文献。"
                : `当前 ${papers.length} 篇已上传原文。`}
              本功能仅基于已上传 PDF 原文的文献进行分析，请确保在{" "}
              <Link href={`/projects/${projectId}/papers`} className="underline font-medium">文献库</Link>{" "}
              中上传所需文献的 PDF 全文。
            </p>
          )}
        </CardContent>
      </Card>

      {/* Input */}
      <form onSubmit={handleGenerate} className="space-y-3">
        <div className="flex gap-3">
          <Input
            placeholder="输入研究主题，如：数字化转型与组织韧性"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="flex-1"
            disabled={phase !== "idle" && phase !== "done"}
          />
          <Button
            type="submit"
            disabled={(phase !== "idle" && phase !== "done") || activePapers.length === 0}
            className="bg-teal text-teal-foreground hover:bg-teal/90"
          >
            生成综述
          </Button>
          <StopButton show={phase !== "idle" && phase !== "done"} onClick={xAbort.abort} />
        </div>
      </form>

      {/* Progress */}
      {phase !== "idle" && (
        <div className="flex items-center gap-3 text-sm">
          <div className="flex gap-1">
            {(["outlining", "writing", "done"] as Phase[]).map((p, i, arr) => (
              <div
                key={p}
                className={`h-1.5 w-10 rounded-full transition-colors ${
                  arr.indexOf(phase) >= i ? "bg-teal" : "bg-border"
                }`}
              />
            ))}
          </div>
          <span className={`${phase === "done" ? "text-teal" : "text-muted-foreground animate-pulse"}`}>
            {phaseLabels[phase]}
          </span>
          {activePapers.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {activePapers.length} 篇文献
            </Badge>
          )}
        </div>
      )}

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-[280px_1fr] gap-6">
        {/* Outline sidebar */}
        {outline && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">综述大纲</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {outline.sections.map((s, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-teal font-bold shrink-0">
                      {i + 1}.
                    </span>
                    <div>
                      <p className="font-medium leading-snug">{s.heading}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {s.perspective} · {s.paperRefs.length} 篇引用
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {outline.gaps.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-amber-600">研究空白</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {outline.gaps.map((gap, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      • {gap}
                    </p>
                  ))}
                </CardContent>
              </Card>
            )}

            {outline.futureDirections.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-teal">未来方向</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {outline.futureDirections.map((dir, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      • {dir}
                    </p>
                  ))}
                </CardContent>
              </Card>
            )}

            {outline.perspectives.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {outline.perspectives.map((p) => (
                  <Badge key={p} variant="secondary" className="text-[10px]">
                    {p}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Review text */}
        {(reviewText || phase === "outlining") && (
          <Card className="min-h-[400px]">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-heading">
                  {outline?.title ?? topic}
                </CardTitle>
                {phase === "done" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(reviewText);
                    }}
                  >
                    复制全文
                  </Button>
                )}
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              {reviewText ? (
                <div className="prose prose-sm max-w-none text-foreground leading-relaxed whitespace-pre-wrap">
                  {reviewText}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground animate-pulse">
                  正在生成大纲，请稍候...
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Empty state */}
        {phase === "idle" && !outline && (
          <Card className="min-h-[400px] flex items-center justify-center lg:col-span-2">
            <CardContent className="text-center text-muted-foreground">
              <div className="text-4xl mb-4">📝</div>
              {papers.length > 0 ? (
                <>
                  <p className="font-medium">输入研究主题，基于 {activePapers.length} 篇已上传原文的文献生成综述</p>
                  <p className="text-sm mt-2 max-w-md mx-auto">
                    基于文献库全文 → 识别研究视角 → 生成结构化大纲 → 流式撰写带引文的完整综述
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">暂无已上传原文的文献</p>
                  <p className="text-sm mt-2 max-w-md mx-auto">
                    请先在「文献库」中上传 PDF 文献，然后返回此页面生成综述。
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
