"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
import { consumeCrossFeatureData, setCrossFeatureData } from "@/lib/cross-feature";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useSavedAnalysis } from "@/hooks/use-saved-analysis";
import { AnalysisChat } from "@/components/analysis-chat";

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

interface Scores {
  novelty: number;
  feasibility: number;
  impact: number;
  overall: number;
}

interface PeerReview {
  strengths: string[];
  weaknesses: string[];
  questions: string[];
  verdict: string;
}

interface Idea {
  id: string;
  title: string;
  theory: string;
  context: string;
  method: string;
  hypothesis: string;
  contribution: string;
  scores: Scores;
  peerReview?: PeerReview;
}

interface Dimensions {
  theories: string[];
  contexts: string[];
  methods: string[];
  gaps: string[];
}

type Phase = "idle" | "loading-storm" | "generating" | "reviewing" | "done";

const verdictLabels: Record<string, { label: string; color: string }> = {
  strong_accept: { label: "强烈接收", color: "text-green-600" },
  accept: { label: "接收", color: "text-teal" },
  revise: { label: "修改后重审", color: "text-amber-600" },
  reject: { label: "拒绝", color: "text-red-600" },
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-teal rounded-full transition-all"
          style={{ width: `${value * 10}%` }}
        />
      </div>
      <span className="w-6 text-right tabular-nums font-medium">{value}</span>
    </div>
  );
}

export default function IdeasGeneratePage() {
  const params = useParams();
  const projectId = params.id as string;

  const [provider, setProvider] = usePersistedState<AIProvider>(`ideas-${projectId}`, "aiProvider", "deepseek-fast");
  const [phase, setPhase] = useState<Phase>("idle");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [papersLoading, setPapersLoading] = useState(true);
  const [analysisEngine, setAnalysisEngine] = usePersistedState<AnalysisEngine>(`ideas-${projectId}`, "engine", "builtin");
  const [dimensions, setDimensions] = usePersistedState<Dimensions | null>(`ideas-${projectId}`, "dimensions", null);
  const [ideas, setIdeas] = usePersistedState<Idea[]>(`ideas-${projectId}`, "ideas", []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [obsidianPushed, setObsidianPushed] = useState<Set<string>>(new Set());
  const [crossFeatureBanner, setCrossFeatureBanner] = useState<string | null>(null);
  const xAbort = useAbort();

  const { savedData: savedIdeas, savedAt: ideasSavedAt, save: saveIdeas, loaded: ideasLoaded } = useSavedAnalysis<{ dimensions: any; ideas: any[] }>(projectId, "ideas");

  // Restore saved data on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ideasLoaded && savedIdeas && ideas.length === 0) {
      if (savedIdeas.ideas) setIdeas(savedIdeas.ideas as any);
      if (savedIdeas.dimensions) setDimensions(savedIdeas.dimensions as any);
    }
  }, [ideasLoaded, savedIdeas]);

  // Check for cross-feature data (gaps from field analysis)
  useEffect(() => {
    const data = consumeCrossFeatureData("ideas", projectId);
    if (data) {
      setCrossFeatureBanner(`来自「${data.source === "field-takeaways" ? "领域要点" : data.source}」的研究空白已导入，可作为想法生成的种子`);
      // Pre-fill could be used as context for idea generation
      sessionStorage.setItem(`ideas-${projectId}:crossContext`, data.content);
    }
  }, [projectId]);

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

  async function handleGenerate() {
    if (activePapers.length === 0) return;

    const signal = xAbort.reset();
    setError(null);
    setDimensions(null);
    setIdeas([]);
    setExpandedId(null);

    // Optional external engine analysis
    let engineContext = "";
    if (analysisEngine === "storm") {
      setPhase("loading-storm");
      try {
        const { callStormAPI } = await import("@/lib/storm-client");
        const stormData = await callStormAPI({
          action: "analyze", topic: "研究想法生成",
          papers: activePapers.map((p) => ({ title: p.title, abstract: p.abstract })),
        }, signal);
        if (stormData.combined) engineContext = stormData.combined;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") { setPhase("idle"); return; }
        /* continue without STORM */
      }
    }
    setPhase("generating");
    try {
      const res = await fetch("/api/research/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          papers: activePapers.map((p) => ({
            ...p,
            fullText: p.fullText?.slice(0, 5000),
          })),
          provider,
          withPeerReview: true,
          engineContext: engineContext || undefined,
        }),
        signal,
      });
      if (!res.ok) throw new Error("想法生成失败");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalDimensions: Dimensions | null = null;
      let finalIdeas: Idea[] = [];

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.phase === "ideas") {
                // Ideas ready — show immediately, then start peer reviews
                finalDimensions = event.dimensions;
                finalIdeas = event.ideas;
                setDimensions(event.dimensions);
                setIdeas(event.ideas);
                setPhase("reviewing");
              } else if (event.phase === "review") {
                // Patch individual idea with peer review as it arrives
                setIdeas((prev) =>
                  prev.map((idea) =>
                    idea.id === event.ideaId
                      ? { ...idea, peerReview: event.review }
                      : idea
                  )
                );
                finalIdeas = finalIdeas.map((idea) =>
                  idea.id === event.ideaId
                    ? { ...idea, peerReview: event.review }
                    : idea
                );
              } else if (event.phase === "done") {
                setPhase("done");
                if (finalDimensions) {
                  saveIdeas({ dimensions: finalDimensions, ideas: finalIdeas });
                }
              } else if (event.phase === "error") {
                throw new Error(event.error);
              }
            } catch (parseErr) {
              // skip malformed events
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") { setPhase("idle"); return; }
      setError(String(err));
      setPhase("idle");
    }
  }

  async function pushToObsidian(idea: Idea) {
    try {
      const obsUrl = localStorage.getItem("obsidian_base_url") || "http://127.0.0.1:27123";
      const apiKey = localStorage.getItem("obsidian_api_key") || "";
      const filename = idea.title.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
      const path = `ScholarFlow/Ideas/${filename}.md`;

      const review = idea.peerReview;
      const content = `---\ntitle: "${idea.title}"\ntheory: "${idea.theory}"\ncontext: "${idea.context}"\nmethod: "${idea.method}"\nnovelty: ${idea.scores.novelty}\nfeasibility: ${idea.scores.feasibility}\nimpact: ${idea.scores.impact}\noverall: ${idea.scores.overall}\ntags: [research-idea]\n---\n\n# ${idea.title}\n\n## 研究设计\n- **理论**: ${idea.theory}\n- **情境**: ${idea.context}\n- **方法**: ${idea.method}\n\n## 核心假设\n${idea.hypothesis}\n\n## 预期贡献\n${idea.contribution}\n\n## 评分\n| 维度 | 分数 |\n|------|------|\n| 新颖性 | ${idea.scores.novelty}/10 |\n| 可行性 | ${idea.scores.feasibility}/10 |\n| 影响力 | ${idea.scores.impact}/10 |\n| **综合** | **${idea.scores.overall}/10** |\n${review ? `\n## 模拟同行评审\n\n### 优点\n${review.strengths.map((s) => `- ${s}`).join("\n")}\n\n### 不足\n${review.weaknesses.map((w) => `- ${w}`).join("\n")}\n\n### 审稿人问题\n${review.questions.map((q) => `- ${q}`).join("\n")}\n\n**评审意见**: ${review.verdict}\n` : ""}\n---\n*Generated by ScholarFlow*\n`;

      const hdrs: HeadersInit = { "Content-Type": "text/markdown" };
      if (apiKey) hdrs["Authorization"] = `Bearer ${apiKey}`;

      const res = await fetch(`${obsUrl}/vault/${encodeURIComponent(path)}`, {
        method: "PUT",
        headers: hdrs,
        body: content,
      });
      if (res.ok) {
        setObsidianPushed((prev) => new Set([...prev, idea.id]));
      }
    } catch {
      // silently fail
    }
  }

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
          <h1 className="font-heading text-2xl font-bold">
            研究想法生成
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            基于文献库 · 理论×情境×方法 · 模拟同行评审
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
              <span className="text-muted-foreground ml-auto">
                将分析 {activePapers.length} 篇文献（STORM 引擎）
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

      {/* Generate button + progress */}
      <div className="flex items-center gap-4">
        <Button
          onClick={handleGenerate}
          disabled={(phase !== "idle" && phase !== "done") || activePapers.length === 0}
          className="bg-teal text-teal-foreground hover:bg-teal/90"
        >
          生成研究想法 <span className="text-[10px] opacity-60">~40s</span>
        </Button>
        <StopButton show={phase === "loading-storm" || phase === "generating" || phase === "reviewing"} onClick={xAbort.abort} />

        {phase !== "idle" && (
          <div className="flex items-center gap-3 text-sm">
            {(["loading-storm", "generating", "reviewing", "done"] as Phase[]).map((p, i) => {
              const phaseOrder = ["loading-storm", "generating", "reviewing", "done"];
              const currentIdx = phaseOrder.indexOf(phase);
              const active = currentIdx >= i;
              return (
                <div key={p} className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      active ? "bg-teal text-teal-foreground" : "bg-border text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <span className={`hidden sm:inline ${phase === p ? "text-foreground" : "text-muted-foreground"}`}>
                    {["引擎分析", "生成想法", "同行评审", "完成"][i]}
                  </span>
                  {i < 3 && <span className="text-border">—</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Dimensions matrix */}
      {dimensions && (
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { label: "理论", items: dimensions.theories, color: "text-blue-600" },
            { label: "情境", items: dimensions.contexts, color: "text-green-600" },
            { label: "方法", items: dimensions.methods, color: "text-purple-600" },
          ].map(({ label, items, color }) => (
            <Card key={label}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm ${color}`}>{label}维度</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((item, i) => (
                    <Badge key={i} variant="secondary" className="text-[11px]">
                      {item.split(":")[0]}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dimensions?.gaps && dimensions.gaps.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-700">识别的研究空白</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {dimensions.gaps.map((gap, i) => (
                <p key={i} className="text-xs text-amber-800">• {gap}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ideas */}
      {ideas.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
              生成的研究想法
              {ideasSavedAt && <span className="text-[10px] text-muted-foreground">已保存 {new Date(ideasSavedAt).toLocaleString("zh-CN")}</span>}
            </h2>
            <span className="text-xs text-muted-foreground">
              按综合评分排序 · 前2名含模拟评审{phase === "reviewing" && " · 评审生成中..."}
            </span>
          </div>

          {ideas.map((idea, rank) => {
            const isExpanded = expandedId === idea.id;
            return (
              <Card
                key={idea.id}
                className={`transition-all duration-200 ${
                  isExpanded ? "border-teal/30 shadow-sm" : "hover:border-border"
                }`}
              >
                <CardHeader
                  className="pb-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : idea.id)}
                >
                  <div className="flex items-start gap-3">
                    <span className={`text-lg font-bold tabular-nums shrink-0 ${
                      rank < 3 ? "text-teal" : "text-muted-foreground"
                    }`}>
                      #{rank + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base leading-snug">
                        {idea.title}
                      </CardTitle>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <Badge variant="secondary" className="text-[10px] bg-blue-50 text-blue-700">
                          {idea.theory.split(":")[0]}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] bg-green-50 text-green-700">
                          {idea.context.split(":")[0]}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] bg-purple-50 text-purple-700">
                          {idea.method.split(":")[0]}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-2xl font-bold tabular-nums text-teal">
                        {idea.scores.overall.toFixed(1)}
                      </span>
                      <span className="text-xs text-muted-foreground block">/10</span>
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <>
                    <Separator />
                    <CardContent className="pt-4 space-y-4">
                      <div className="max-w-xs space-y-1.5">
                        <ScoreBar label="新颖性" value={idea.scores.novelty} />
                        <ScoreBar label="可行性" value={idea.scores.feasibility} />
                        <ScoreBar label="影响力" value={idea.scores.impact} />
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="font-medium mb-1">核心假设</p>
                          <p className="text-muted-foreground">{idea.hypothesis}</p>
                        </div>
                        <div>
                          <p className="font-medium mb-1">预期贡献</p>
                          <p className="text-muted-foreground">{idea.contribution}</p>
                        </div>
                      </div>

                      {!idea.peerReview && rank < 2 && phase === "reviewing" && (
                        <div className="bg-muted/20 rounded-lg px-4 py-3 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="inline-block w-1.5 h-1.5 bg-teal rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="inline-block w-1.5 h-1.5 bg-teal rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="inline-block w-1.5 h-1.5 bg-teal rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          <span className="ml-1">同行评审生成中...</span>
                        </div>
                      )}
                      {idea.peerReview && (
                        <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-medium">模拟同行评审</h4>
                            <Badge
                              variant="secondary"
                              className={`text-[10px] ${
                                verdictLabels[idea.peerReview.verdict]?.color ?? ""
                              }`}
                            >
                              {verdictLabels[idea.peerReview.verdict]?.label ?? idea.peerReview.verdict}
                            </Badge>
                          </div>
                          <div className="grid sm:grid-cols-2 gap-3 text-xs">
                            <div>
                              <p className="font-medium text-green-700 mb-1">优点</p>
                              {idea.peerReview.strengths.map((s, i) => (
                                <p key={i} className="text-muted-foreground">+ {s}</p>
                              ))}
                            </div>
                            <div>
                              <p className="font-medium text-red-600 mb-1">不足</p>
                              {idea.peerReview.weaknesses.map((w, i) => (
                                <p key={i} className="text-muted-foreground">- {w}</p>
                              ))}
                            </div>
                          </div>
                          {idea.peerReview.questions.length > 0 && (
                            <div className="text-xs">
                              <p className="font-medium text-amber-600 mb-1">审稿人问题</p>
                              {idea.peerReview.questions.map((q, i) => (
                                <p key={i} className="text-muted-foreground">? {q}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Link
                          href={`/projects/${projectId}/papers/search`}
                          onClick={() => {
                            setCrossFeatureData("search", projectId, "research-idea", JSON.stringify({
                              title: idea.title,
                              theory: idea.theory,
                              context: idea.context,
                              method: idea.method,
                              hypothesis: idea.hypothesis,
                              contribution: idea.contribution,
                              scores: idea.scores,
                            }));
                          }}
                        >
                          <Button size="sm" variant="outline" className="text-xs border-teal/40 text-teal hover:bg-teal/10">
                            搜索相关文献
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            pushToObsidian(idea);
                          }}
                          disabled={obsidianPushed.has(idea.id)}
                        >
                          {obsidianPushed.has(idea.id) ? "已推送" : "推送到 Obsidian"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(
                              `${idea.title}\n\n理论: ${idea.theory}\n情境: ${idea.context}\n方法: ${idea.method}\n\n假设: ${idea.hypothesis}\n\n贡献: ${idea.contribution}`
                            );
                          }}
                        >
                          复制
                        </Button>
                      </div>
                    </CardContent>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {phase === "idle" && ideas.length === 0 && papers.length > 0 && (
        <Card className="min-h-[200px] flex items-center justify-center">
          <CardContent className="text-center text-muted-foreground">
            <div className="text-4xl mb-4">💡</div>
            <p className="font-medium">点击「生成研究想法」，基于文献库中的 {activePapers.length} 篇文献生成</p>
            <p className="text-sm mt-2 max-w-md mx-auto">
              流程：维度提取（理论×情境×方法）→ 组合生成 → 评分排序 → 模拟同行评审
            </p>
          </CardContent>
        </Card>
      )}

      {/* Analysis Chat */}
      {ideas.length > 0 && (
        <AnalysisChat
          namespace={`ideas-${projectId}`}
          projectId={projectId}
          analysisContext={ideas.map(idea => `${idea.title}: ${idea.hypothesis} (${idea.contribution})`).join("\n\n")}
          systemPrompt="你是管理学研究想法分析助手。用户可以对生成的研究想法提出优化意见或深入探讨。"
          provider={provider}
          paperTitles={papers.map(p => p.title)}
        />
      )}

    </div>
  );
}
