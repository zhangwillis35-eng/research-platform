"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AIProviderSelect,
  type AIProvider,
} from "@/components/ai-provider-select";

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

type Phase = "idle" | "searching" | "extracting" | "generating" | "done";

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
  const [topic, setTopic] = useState("");
  const [provider, setProvider] = useState<AIProvider>("gemini");
  const [phase, setPhase] = useState<Phase>("idle");
  const [dimensions, setDimensions] = useState<Dimensions | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [obsidianPushed, setObsidianPushed] = useState<Set<string>>(new Set());

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;

    setError(null);
    setDimensions(null);
    setIdeas([]);
    setExpandedId(null);

    // Step 1: Deep search
    setPhase("searching");
    let papers;
    try {
      const res = await fetch("/api/research/deep-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, provider }),
      });
      if (!res.ok) throw new Error("文献检索失败");
      const data = await res.json();
      papers = data.papers;
    } catch (err) {
      setError(String(err));
      setPhase("idle");
      return;
    }

    if (!papers.length) {
      setError("未找到相关文献");
      setPhase("idle");
      return;
    }

    // Step 2: Run idea pipeline
    setPhase("extracting");
    try {
      const res = await fetch("/api/research/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ papers, provider, withPeerReview: true }),
      });
      if (!res.ok) throw new Error("想法生成失败");
      const data = await res.json();
      setDimensions(data.dimensions);
      setPhase("generating");

      // Small delay for UI feedback
      await new Promise((r) => setTimeout(r, 300));
      setIdeas(data.ideas);
      setPhase("done");
    } catch (err) {
      setError(String(err));
      setPhase("idle");
    }
  }

  async function pushToObsidian(idea: Idea) {
    try {
      const res = await fetch("/api/integrations/obsidian", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "push-idea",
          config: {
            baseUrl: "http://127.0.0.1:27123",
            apiKey: localStorage.getItem("obsidian_api_key") ?? "",
          },
          idea: {
            ...idea,
            relatedPapers: [],
          },
        }),
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-serif-sc)] text-2xl font-bold">
            研究想法生成
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            六步管道 · 理论×情境×方法 · 模拟同行评审
          </p>
        </div>
        <AIProviderSelect value={provider} onChange={setProvider} />
      </div>

      {/* Input */}
      <form onSubmit={handleGenerate} className="flex gap-3">
        <Input
          placeholder="输入研究方向，如：ESG与企业创新"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="flex-1"
          disabled={phase !== "idle" && phase !== "done"}
        />
        <Button
          type="submit"
          disabled={phase !== "idle" && phase !== "done"}
          className="bg-teal text-teal-foreground hover:bg-teal/90"
        >
          生成想法
        </Button>
      </form>

      {/* Progress */}
      {phase !== "idle" && (
        <div className="flex items-center gap-3 text-sm">
          {(["searching", "extracting", "generating", "done"] as Phase[]).map((p, i) => (
            <div key={p} className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  ["searching", "extracting", "generating", "done"].indexOf(phase) >= i
                    ? "bg-teal text-teal-foreground"
                    : "bg-border text-muted-foreground"
                }`}
              >
                {i + 1}
              </div>
              <span className={`hidden sm:inline ${
                phase === p ? "text-foreground" : "text-muted-foreground"
              }`}>
                {["检索文献", "提取维度", "生成想法", "完成"][i]}
              </span>
              {i < 3 && <span className="text-border">—</span>}
            </div>
          ))}
        </div>
      )}

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
            <h2 className="font-[family-name:var(--font-serif-sc)] text-lg font-semibold">
              生成的研究想法
            </h2>
            <span className="text-xs text-muted-foreground">
              按综合评分排序 · 前3名含模拟评审
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
                      {/* Scores */}
                      <div className="max-w-xs space-y-1.5">
                        <ScoreBar label="新颖性" value={idea.scores.novelty} />
                        <ScoreBar label="可行性" value={idea.scores.feasibility} />
                        <ScoreBar label="影响力" value={idea.scores.impact} />
                      </div>

                      {/* Details */}
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

                      {/* Peer Review */}
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

                      {/* Actions */}
                      <div className="flex gap-2">
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
      {phase === "idle" && ideas.length === 0 && (
        <Card className="min-h-[300px] flex items-center justify-center">
          <CardContent className="text-center text-muted-foreground">
            <div className="text-4xl mb-4">💡</div>
            <p className="font-medium">输入研究方向，AI 生成创新研究想法</p>
            <p className="text-sm mt-2 max-w-md mx-auto">
              六步管道：文献检索 → 维度提取(理论×情境×方法) → 组合生成 → 评分排序 → 模拟同行评审
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
