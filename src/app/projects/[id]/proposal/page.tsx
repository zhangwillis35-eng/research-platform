"use client";

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import { usePersistedState } from "@/hooks/use-persisted-state";
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
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";

interface Paper {
  id: string;
  title: string;
  abstract?: string;
  authors: { name: string }[];
  year?: number;
  venue?: string;
  doi?: string;
  citationCount: number;
  isSelected: boolean;
  fullText?: string | null;
  pdfFileName?: string | null;
}

export default function ProposalPage() {
  const params = useParams();
  const projectId = params.id as string;

  const NS = `proposal-${projectId}`;
  const [aiProvider, setAiProvider] = usePersistedState<AIProvider>(NS, "provider", "deepseek-pro");
  const [papers, setPapers] = usePersistedState<Paper[]>(NS, "papers", []);
  const [analysisEngine, setAnalysisEngine] = usePersistedState<"storm" | "notebooklm">(NS, "engine", "storm");
  const [proposalText, setProposalText] = usePersistedState<string>(NS, "proposalText", "");
  const [topic, setTopic] = usePersistedState<string>(NS, "topic", "");
  const [ideas, setIdeas] = usePersistedState<string>(NS, "ideas", "");

  // Transient
  const [papersLoading, setPapersLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const xAbort = useAbort();

  // Load papers from library on mount
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
    if (!topic.trim() || activePapers.length === 0) return;
    const signal = xAbort.reset();
    setLoading(true);
    setProposalText("");

    try {
      // Optional: external analysis engine
      let externalContext = "";
      if (analysisEngine === "storm") {
        setLoadingPhase("STORM 文献深度分析...");
        try {
          const stormRes = await fetch("/api/integrations/storm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "analyze",
              topic,
              papers: activePapers.slice(0, 25).map((p) => ({
                title: p.title, abstract: p.abstract, year: p.year, venue: p.venue,
                fullText: p.fullText?.slice(0, 3000),
              })),
            }),
            signal,
          });
          if (stormRes.ok) {
            const data = await stormRes.json();
            if (data.article) externalContext = data.article;
          }
        } catch { /* continue */ }
      } else if (analysisEngine === "notebooklm") {
        setLoadingPhase("NotebookLM 全文深度分析...");
        const notebookId = localStorage.getItem("notebooklm_notebook_id") || "";
        if (notebookId) {
          try {
            const nlmRes = await fetch("/api/integrations/notebooklm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "analyze", topic, type: "review", notebookId }),
              signal,
            });
            if (nlmRes.ok) {
              const data = await nlmRes.json();
              if (data.combined) externalContext = data.combined;
            }
          } catch { /* continue */ }
        }
      }

      setLoadingPhase("AI 撰写 Proposal...");

      const papersToSend = activePapers.slice(0, 20).map((p) => ({
        title: p.title,
        abstract: externalContext
          ? (p.abstract ?? "") + "\n\n[深度分析补充]\n" + externalContext
          : p.abstract,
        authors: p.authors,
        year: p.year,
        venue: p.venue,
        doi: p.doi,
        fullText: p.fullText?.slice(0, 5000),
      }));

      const res = await fetch("/api/research/proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          papers: papersToSend,
          ideas: ideas.trim() ? ideas.split("\n").filter(Boolean) : undefined,
          provider: aiProvider,
        }),
        signal,
      });

      if (!res.ok) throw new Error("Generation failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      setLoadingPhase("");
      const decoder = new TextDecoder();
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
            if (data.text) {
              text += data.text;
              setProposalText(text);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") { setLoading(false); setLoadingPhase(""); return; }
      setProposalText(`生成失败: ${String(err)}`);
    } finally {
      setLoading(false);
      setLoadingPhase("");
    }
  }

  function handleExport() {
    const blob = new Blob([proposalText], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proposal-${topic.replace(/\s+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportRefs() {
    if (activePapers.length === 0) return;
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
          style: "apa",
        }),
      });
      const data = await res.json();
      if (data.citations) {
        const refList = data.citations
          .map((c: string, i: number) => `[${i + 1}] ${c}`)
          .join("\n\n");
        const blob = new Blob([refList], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "references-apa.txt";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      alert("导出失败");
    }
  }

  const sections = proposalText.split(/(?=^## )/m).filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">
            Research Proposal
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            基于文献库 · AI 辅助生成结构化研究计划书
          </p>
        </div>
        <AIProviderSelect value={aiProvider} onChange={setAiProvider} />
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
                将引用 {activePapers.length} 篇文献
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

      {/* Topic + ideas input */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">研究主题</label>
            <input
              type="text"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
              placeholder="如：AI washing 对投资者信任与企业估值的影响研究"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">
              研究想法 <span className="text-muted-foreground font-normal text-xs">（可选，来自「研究想法」模块）</span>
            </label>
            <textarea
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background resize-none"
              placeholder="可粘贴在「研究想法」中生成的研究假设和贡献点，每行一个"
              rows={3}
              value={ideas}
              onChange={(e) => setIdeas(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={handleExportRefs}
                disabled={activePapers.length === 0}
              >
                导出参考文献 (APA)
              </Button>
            </div>
            <Button
              size="sm"
              className="h-8 text-xs bg-teal text-teal-foreground hover:bg-teal/90"
              onClick={handleGenerate}
              disabled={loading || !topic.trim() || activePapers.length === 0}
            >
              {loading ? (loadingPhase || "撰写中...") : "生成 Proposal"}
            </Button>
            <StopButton show={loading} onClick={xAbort.abort} />
          </div>
        </CardContent>
      </Card>

      {/* Output */}
      {proposalText && (
        <div className="flex gap-4">
          <div className="w-48 shrink-0">
            <div className="sticky top-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground mb-2">章节导航</p>
              {sections.map((sec, i) => {
                const title = sec.match(/^## (.+)/m)?.[1] ?? `Section ${i + 1}`;
                return (
                  <button
                    key={i}
                    className="block text-left w-full text-xs px-2 py-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground truncate"
                    onClick={() => document.getElementById(`section-${i}`)?.scrollIntoView({ behavior: "smooth" })}
                  >
                    {title}
                  </button>
                );
              })}
              <Separator className="my-2" />
              <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={handleExport}>导出 Markdown</Button>
              <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={() => { navigator.clipboard.writeText(proposalText); }}>复制全文</Button>
            </div>
          </div>

          <Card className="flex-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                Research Proposal
                {loading && <span className="text-xs text-muted-foreground animate-pulse">撰写中...</span>}
                <Badge variant="secondary" className="text-xs ml-auto">{activePapers.length} 篇引用文献</Badge>
              </CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="pt-6" ref={contentRef}>
              <div className="prose prose-sm max-w-none">
                {sections.map((sec, i) => (
                  <div key={i} id={`section-${i}`} className="mb-8">
                    <div
                      className="whitespace-pre-wrap text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{
                        __html: sec
                          .replace(/^## (.+)/gm, '<h2 class="text-lg font-bold text-primary mt-6 mb-3 font-heading">$1</h2>')
                          .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground">$1</strong>')
                          .replace(/\[([^\]]+)\]/g, '<span class="text-teal font-medium">[$1]</span>'),
                      }}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {!proposalText && !loading && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <p className="text-2xl mb-2">📝</p>
            <p className="text-sm text-muted-foreground">
              输入研究主题，AI 将基于已上传的文献原文生成结构化 Research Proposal
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              包含：引言 · 文献综述 · 理论框架 · 假设推导 · 研究方法 · 预期贡献 · 参考文献
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
