"use client";

import { useState, useEffect } from "react";
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
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";
import { usePersistedState } from "@/hooks/use-persisted-state";

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

interface Theory {
  id: string;
  name: string;
  nameEn: string;
  coreConstructs: string[];
  assumptions: string[];
  boundaries: string[];
  papers: number[];
}

interface Connection {
  from: string;
  to: string;
  sharedConstructs: string[];
  integrationPotential: string;
  strength: "strong" | "moderate" | "weak";
}

interface Framework {
  title: string;
  description: string;
  centralTheory: string;
  layers: { name: string; theories: string[]; role: string }[];
}

const strengthColors: Record<string, string> = {
  strong: "bg-green-100 text-green-700",
  moderate: "bg-amber-100 text-amber-700",
  weak: "bg-gray-100 text-gray-600",
};

export default function TheoriesIntegratePage() {
  const params = useParams();
  const projectId = params.id as string;

  const [topic, setTopic] = useState("");
  const [provider, setProvider] = usePersistedState<AIProvider>(`theories-${projectId}`, "aiProvider", "gemini");
  const [loading, setLoading] = useState(false);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [papersLoading, setPapersLoading] = useState(true);
  const [analysisEngine, setAnalysisEngine] = useState<"storm" | "notebooklm">("storm");
  const [nlmStatus, setNlmStatus] = useState<string | null>(null);
  const [theories, setTheories] = usePersistedState<Theory[]>(`theories-${projectId}`, "theories", []);
  const [connections, setConnections] = usePersistedState<Connection[]>(`theories-${projectId}`, "connections", []);
  const [framework, setFramework] = usePersistedState<Framework | null>(`theories-${projectId}`, "framework", null);
  const [selectedTheory, setSelectedTheory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const xAbort = useAbort();

  // Load papers from project library
  useEffect(() => {
    setPapersLoading(true);
    fetch(`/api/papers?projectId=${projectId}&source=fulltext`)
      .then((r) => r.json())
      .then((d) => setPapers(d.papers ?? []))
      .catch(() => {})
      .finally(() => setPapersLoading(false));
  }, [projectId]);

  const activePapers = papers;

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    if (activePapers.length === 0) return;

    const signal = xAbort.reset();
    setLoading(true);
    setError(null);
    setTheories([]);
    setConnections([]);
    setFramework(null);

    try {
      // Optional: external engine analysis
      let nlmContext = "";
      if (analysisEngine === "storm") {
        setNlmStatus("正在通过 STORM 进行理论框架深度分析...");
        try {
          const stormRes = await fetch("/api/integrations/storm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "analyze",
              topic: topic || "理论框架分析",
              papers: activePapers.map((p) => ({ title: p.title, abstract: p.abstract })),
            }),
            signal,
          });
          if (stormRes.ok) {
            const stormData = await stormRes.json();
            if (stormData.combined) nlmContext = stormData.combined;
          }
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") throw err;
          /* continue without STORM */
        }
        setNlmStatus(null);
      }
      if (analysisEngine === "notebooklm") {
        setNlmStatus("正在通过 NotebookLM 进行理论框架深度分析...");
        const notebookId = localStorage.getItem("notebooklm_notebook_id") || "";
        if (notebookId) {
          try {
            const nlmRes = await fetch("/api/integrations/notebooklm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "analyze",
                topic: topic || "理论框架分析",
                type: "theories",
                notebookId,
              }),
              signal,
            });
            if (nlmRes.ok) {
              const nlmData = await nlmRes.json();
              if (nlmData.combined) nlmContext = nlmData.combined;
            }
          } catch (err) {
            if (err instanceof Error && err.name === "AbortError") throw err;
            /* continue without NLM */
          }
        }
        setNlmStatus(null);
      }

      const paperData = activePapers.slice(0, 20).map((p) => ({
        title: p.title,
        abstract: p.abstract ? (nlmContext ? p.abstract + "\n\n[NotebookLM 补充分析]\n" + nlmContext : p.abstract) : nlmContext || undefined,
        year: p.year,
        venue: p.venue,
        fullText: p.fullText?.slice(0, 5000),
      }));

      const res = await fetch("/api/research/theories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          papers: paperData,
          topic: topic || "基于文献库的理论整合",
          provider,
        }),
        signal,
      });
      if (!res.ok) throw new Error("理论分析失败");
      const data = await res.json();

      setTheories(data.theories ?? []);
      setConnections(data.connections ?? []);
      setFramework(data.framework ?? null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") { setLoading(false); return; }
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const selectedT = theories.find((t) => t.id === selectedTheory);
  const relatedConnections = selectedTheory
    ? connections.filter((c) => c.from === selectedTheory || c.to === selectedTheory)
    : connections;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">
            理论整合引擎
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            基于文献库 · 识别理论框架 · 发现跨理论连接 · 生成整合框架
          </p>
        </div>
        <AIProviderSelect value={provider} onChange={setProvider} />
      </div>

      {/* Paper source panel */}
      <Card className="border-teal/20 bg-teal/[0.02]">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-teal">数据来源：项目文献库</span>
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
              <select
                value={analysisEngine}
                onChange={(e) => setAnalysisEngine(e.target.value as "storm" | "notebooklm")}
                className="h-7 px-2 text-xs border border-input rounded-md bg-background"
              >
                <option value="storm">STORM（内置）</option>
                <option value="notebooklm">NotebookLM（外部）</option>
              </select>
              <span className="text-muted-foreground ml-auto">
                将分析 {activePapers.length} 篇文献
              </span>
            </div>
          )}

          {papers.length === 0 && !papersLoading && (
            <p className="text-xs text-amber-600">
              暂无已上传原文的文献。请先在「文献库」中上传 PDF 文献。
            </p>
          )}
        </CardContent>
      </Card>

      {/* Topic + generate */}
      <form onSubmit={handleAnalyze} className="flex gap-3">
        <Input
          placeholder="可选：输入具体研究主题以聚焦分析方向（留空则基于全部文献分析）"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={loading || activePapers.length === 0}
          className="bg-teal text-teal-foreground hover:bg-teal/90"
        >
          {loading ? (nlmStatus || "分析中...") : "分析理论"}
        </Button>
        <StopButton show={loading} onClick={xAbort.abort} />
      </form>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm">{error}</div>
      )}

      {theories.length > 0 && (
        <div className="grid lg:grid-cols-[1fr_320px] gap-6">
          {/* Main area */}
          <div className="space-y-6">
            {framework && (
              <Card className="border-teal/20 bg-teal/[0.02]">
                <CardHeader>
                  <CardTitle className="text-base font-heading">
                    {framework.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{framework.description}</p>
                  {framework.layers.map((layer, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-teal font-bold text-sm shrink-0 w-6">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium">{layer.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{layer.role}</p>
                        <div className="flex gap-1 mt-1">
                          {layer.theories.map((tId) => {
                            const t = theories.find((th) => th.id === tId);
                            return t ? (
                              <Badge key={tId} variant="secondary" className="text-[10px]">
                                {t.name}
                              </Badge>
                            ) : null;
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <div>
              <h2 className="font-heading text-lg font-semibold mb-3">
                跨理论连接
              </h2>
              <div className="space-y-3">
                {relatedConnections.map((c, i) => {
                  const fromT = theories.find((t) => t.id === c.from);
                  const toT = theories.find((t) => t.id === c.to);
                  return (
                    <div key={i} className="p-4 border border-border/50 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="secondary" className="text-xs">{fromT?.name ?? c.from}</Badge>
                        <span className="text-muted-foreground">↔</span>
                        <Badge variant="secondary" className="text-xs">{toT?.name ?? c.to}</Badge>
                        <Badge className={`text-[10px] ml-auto ${strengthColors[c.strength]}`}>
                          {c.strength === "strong" ? "强连接" : c.strength === "moderate" ? "中等" : "弱连接"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{c.integrationPotential}</p>
                      {c.sharedConstructs.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          <span className="text-xs text-muted-foreground">共享构念：</span>
                          {c.sharedConstructs.map((sc) => (
                            <Badge key={sc} variant="outline" className="text-[10px]">{sc}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Theory sidebar */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium">识别的理论（{theories.length}）</h2>
            {theories.map((t) => (
              <Card
                key={t.id}
                className={`cursor-pointer transition-all ${
                  selectedTheory === t.id ? "border-teal/30 shadow-sm" : "hover:border-border"
                }`}
                onClick={() => setSelectedTheory(selectedTheory === t.id ? null : t.id)}
              >
                <CardContent className="p-4 space-y-2">
                  <div>
                    <p className="font-medium text-sm">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.nameEn}</p>
                  </div>
                  {selectedTheory === t.id && (
                    <>
                      <Separator />
                      <div className="space-y-2 text-xs">
                        <div>
                          <p className="font-medium mb-1">核心构念</p>
                          <div className="flex flex-wrap gap-1">
                            {t.coreConstructs.map((c) => (
                              <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                            ))}
                          </div>
                        </div>
                        {t.assumptions.length > 0 && (
                          <div>
                            <p className="font-medium mb-1">关键假设</p>
                            {t.assumptions.map((a, i) => (
                              <p key={i} className="text-muted-foreground">• {a}</p>
                            ))}
                          </div>
                        )}
                        {t.boundaries.length > 0 && (
                          <div>
                            <p className="font-medium mb-1">边界条件</p>
                            {t.boundaries.map((b, i) => (
                              <p key={i} className="text-muted-foreground">• {b}</p>
                            ))}
                          </div>
                        )}
                        <p className="text-muted-foreground">引用文献: {t.papers.length} 篇</p>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && theories.length === 0 && !error && papers.length > 0 && (
        <Card className="min-h-[200px] flex items-center justify-center">
          <CardContent className="text-center text-muted-foreground">
            <div className="text-4xl mb-4">🔬</div>
            <p className="font-medium">点击「分析理论」，基于文献库中的 {activePapers.length} 篇文献分析</p>
            <p className="text-sm mt-2 max-w-md mx-auto">
              自动识别各文献的理论基础、核心构念和边界条件，发现跨理论连接点，生成整合框架
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
