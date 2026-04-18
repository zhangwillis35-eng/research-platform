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

type Phase = "idle" | "searching" | "outlining" | "writing" | "done";

export default function ReviewGeneratePage() {
  const [topic, setTopic] = useState("");
  const [provider, setProvider] = useState<AIProvider>("gemini");
  const [phase, setPhase] = useState<Phase>("idle");
  const [outline, setOutline] = useState<ReviewOutline | null>(null);
  const [reviewText, setReviewText] = useState("");
  const [paperCount, setPaperCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;

    setError(null);
    setOutline(null);
    setReviewText("");

    // Step 1: Deep search for papers
    setPhase("searching");
    let papers;
    try {
      const searchRes = await fetch("/api/research/deep-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, provider }),
      });
      if (!searchRes.ok) throw new Error("文献检索失败");
      const searchData = await searchRes.json();
      papers = searchData.papers;
      setPaperCount(papers.length);
    } catch (err) {
      setError(String(err));
      setPhase("idle");
      return;
    }

    if (!papers.length) {
      setError("未找到相关文献，请换一个主题");
      setPhase("idle");
      return;
    }

    // Step 2: Generate outline + stream review
    setPhase("outlining");
    try {
      const reviewRes = await fetch("/api/research/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, papers, provider }),
      });

      if (!reviewRes.ok) throw new Error("综述生成失败");

      const reader = reviewRes.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let text = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split("\n")) {
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
      setError(String(err));
      setPhase("idle");
    }
  }

  const phaseLabels: Record<Phase, string> = {
    idle: "",
    searching: "正在检索文献...",
    outlining: "正在生成大纲...",
    writing: "正在撰写综述...",
    done: "综述生成完成",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-serif-sc)] text-2xl font-bold">
            AI 文献综述
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            STORM 式多视角综述 · 自动检索 · 引文追踪
          </p>
        </div>
        <AIProviderSelect value={provider} onChange={setProvider} />
      </div>

      {/* Input */}
      <form onSubmit={handleGenerate} className="flex gap-3">
        <Input
          placeholder="输入研究主题，如：数字化转型与组织韧性"
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
          生成综述
        </Button>
      </form>

      {/* Progress */}
      {phase !== "idle" && (
        <div className="flex items-center gap-3 text-sm">
          <div className="flex gap-1">
            {(["searching", "outlining", "writing", "done"] as Phase[]).map((p, i) => (
              <div
                key={p}
                className={`h-1.5 w-12 rounded-full transition-colors ${
                  ["searching", "outlining", "writing", "done"].indexOf(phase) >= i
                    ? "bg-teal"
                    : "bg-border"
                }`}
              />
            ))}
          </div>
          <span className={`${phase === "done" ? "text-teal" : "text-muted-foreground animate-pulse"}`}>
            {phaseLabels[phase]}
          </span>
          {paperCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {paperCount} 篇文献
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
                <CardTitle className="text-base font-[family-name:var(--font-serif-sc)]">
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
              <p className="font-medium">输入研究主题，一键生成多视角文献综述</p>
              <p className="text-sm mt-2 max-w-md mx-auto">
                平台会自动检索多源文献 → 识别研究视角 → 生成结构化大纲 → 流式撰写带引文的完整综述
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
