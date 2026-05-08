"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useAbort } from "@/hooks/use-abort";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StopButton } from "@/components/stop-button";
import {
  AIProviderSelect,
  type AIProvider,
} from "@/components/ai-provider-select";
import type { AcademicTerm, PaperAnalysis, TranslateStreamEvent } from "@/lib/research/paper-translator";
import { generateTranslationDocx, downloadBlob } from "@/lib/docx-export";

interface Paper {
  id: string;
  title: string;
  abstract?: string | null;
  authors: { name: string }[];
  year?: number | null;
  venue?: string | null;
  fullText?: string | null;
  pdfFileName?: string | null;
}

type Phase =
  | "idle"
  | "translating"
  | "extracting-terms"
  | "analyzing"
  | "done";

type ActiveTab = "translation" | "terms" | "analysis";

export default function TranslatePage() {
  const params = useParams();
  const projectId = params.id as string;
  const NS = `translate-${projectId}`;

  const [provider, setProvider] = usePersistedState<AIProvider>(NS, "provider", "deepseek-fast");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [selectedPaperId, setSelectedPaperId] = usePersistedState<string>(NS, "paperId", "");
  const [phase, setPhase] = usePersistedState<Phase>(NS, "phase", "idle");
  const [translatedText, setTranslatedText] = usePersistedState<string>(NS, "translated", "");
  const [terms, setTerms] = usePersistedState<AcademicTerm[]>(NS, "terms", []);
  const [analysis, setAnalysis] = usePersistedState<PaperAnalysis | null>(NS, "analysis", null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("translation");
  const [sectionProgress, setSectionProgress] = useState({ current: 0, total: 0, heading: "" });
  const [exporting, setExporting] = useState(false);

  const { getSignal, abort, reset } = useAbort();
  const translatedRef = useRef("");

  // Load papers list (without fullText — fetch detail separately when translating)
  useEffect(() => {
    fetch(`/api/papers?projectId=${projectId}&source=catalog`)
      .then((r) => r.json())
      .then((d) => {
        const list: Paper[] = (d.papers ?? []).filter(
          (p: Paper) => p.fullText != null // __has_fulltext__ marker
        );
        setPapers(list);
      })
      .catch(console.error);
  }, [projectId]);

  const selectedPaper = papers.find((p) => p.id === selectedPaperId) ?? null;

  const handleStop = useCallback(() => {
    abort();
    setPhase("done");
  }, [abort]);

  async function handleTranslate() {
    if (!selectedPaper) return;
    reset();
    setPhase("translating");
    setTranslatedText("");
    setTerms([]);
    setAnalysis(null);
    translatedRef.current = "";
    setSectionProgress({ current: 0, total: 0, heading: "" });
    setActiveTab("translation");

    // Fetch fullText if not loaded yet
    let paperText = selectedPaper.fullText ?? "";
    if (!paperText || paperText === "__has_fulltext__") {
      try {
        const detail = await fetch(`/api/papers/${selectedPaper.id}`).then((r) => r.json());
        paperText = detail.paper?.fullText ?? "";
      } catch {
        setPhase("done");
        return;
      }
    }
    if (!paperText || paperText.trim().length < 100) {
      setPhase("done");
      return;
    }

    try {
      const res = await fetch("/api/research/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "translate",
          text: paperText,
          title: selectedPaper.title,
          provider,
        }),
        signal: getSignal(),
      });

      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as TranslateStreamEvent;
            if (event.phase === "section-start") {
              setSectionProgress({
                current: event.index + 1,
                total: event.total,
                heading: event.heading,
              });
              if (event.heading) {
                const hMarker = `\n\n## ${event.heading}\n\n`;
                translatedRef.current += hMarker;
                setTranslatedText(translatedRef.current);
              }
            } else if (event.phase === "chunk") {
              translatedRef.current += event.text;
              setTranslatedText(translatedRef.current);
            } else if (event.phase === "done") {
              // Start background tasks
              startBackgroundTasks(selectedPaper.title, paperText, translatedRef.current);
            } else if (event.phase === "error") {
              console.error("[translate] stream error:", event.error);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[translate]", err);
      }
      setPhase("done");
    }
  }

  async function startBackgroundTasks(title: string, paperText: string, finalText: string) {
    void finalText;

    // Extract terms
    setPhase("extracting-terms");
    try {
      const r = await fetch("/api/research/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "extract-terms",
          text: paperText.slice(0, 15000),
          title,
          provider,
        }),
      });
      if (r.ok) {
        const d = await r.json();
        setTerms(d.terms ?? []);
      }
    } catch {
      // non-critical
    }

    // Analyze paper
    setPhase("analyzing");
    try {
      const r = await fetch("/api/research/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "analyze",
          text: paperText.slice(0, 20000),
          title,
          provider,
        }),
      });
      if (r.ok) {
        const d = await r.json();
        setAnalysis(d.analysis ?? null);
      }
    } catch {
      // non-critical
    }

    setPhase("done");
  }

  async function handleExport() {
    if (!selectedPaper || !translatedText) return;
    setExporting(true);
    try {
      // Attempt to get a translated title from the first line
      const firstLine = translatedText.split("\n").find((l) => l.trim().length > 5) ?? selectedPaper.title;
      const translatedTitle = firstLine.replace(/^#+\s*/, "").trim().slice(0, 120);

      const blob = await generateTranslationDocx({
        originalTitle: selectedPaper.title,
        translatedTitle,
        authors: selectedPaper.authors?.map((a) => a.name).join(", "),
        year: selectedPaper.year ?? undefined,
        venue: selectedPaper.venue ?? undefined,
        translatedText,
        terms,
        analysis,
      });
      const filename = `[译文] ${selectedPaper.title.slice(0, 40)}.docx`;
      downloadBlob(blob, filename);
    } catch (err) {
      console.error("[export]", err);
    } finally {
      setExporting(false);
    }
  }

  const isRunning = phase === "translating" || phase === "extracting-terms" || phase === "analyzing";

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">文献翻译</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            英文学术论文 → 中文，含关键词核验与论文分析
          </p>
        </div>
        <AIProviderSelect value={provider} onChange={setProvider} />
      </div>

      {/* Paper selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">选择论文</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {papers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              文献库中暂无已上传原文的论文。请先在「文献库」上传 PDF 原文。
            </p>
          ) : (
            <select
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              value={selectedPaperId}
              onChange={(e) => {
                setSelectedPaperId(e.target.value);
                setPhase("idle");
                setTranslatedText("");
                setTerms([]);
                setAnalysis(null);
              }}
            >
              <option value="">— 请选择论文 —</option>
              {papers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                  {p.year ? ` (${p.year})` : ""}
                  {p.fullText ? ` [${Math.round(p.fullText.length / 1000)}k字符]` : ""}
                </option>
              ))}
            </select>
          )}

          {selectedPaper && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>
                <span className="font-medium">作者：</span>
                {selectedPaper.authors?.map((a) => a.name).join(", ") || "—"}
              </div>
              {selectedPaper.venue && (
                <div>
                  <span className="font-medium">期刊：</span>
                  {selectedPaper.venue}
                  {selectedPaper.year ? ` (${selectedPaper.year})` : ""}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleTranslate}
          disabled={!selectedPaper || isRunning}
          size="sm"
        >
          {phase === "idle" ? "开始翻译" : phase === "done" ? "重新翻译" : "翻译中..."}
        </Button>
        <StopButton show={isRunning} onClick={handleStop} />
        {translatedText && !isRunning && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? "导出中..." : "导出 Word"}
          </Button>
        )}
      </div>

      {/* Progress indicator */}
      {isRunning && (
        <div className="text-sm text-muted-foreground space-y-1">
          {phase === "translating" && sectionProgress.total > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {Array.from({ length: sectionProgress.total }, (_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 w-6 rounded-full transition-colors ${
                      i < sectionProgress.current
                        ? "bg-primary"
                        : i === sectionProgress.current - 1
                        ? "bg-primary/60 animate-pulse"
                        : "bg-muted"
                    }`}
                  />
                ))}
              </div>
              <span>
                第 {sectionProgress.current}/{sectionProgress.total} 节
                {sectionProgress.heading ? `：${sectionProgress.heading}` : ""}
              </span>
            </div>
          )}
          {phase === "extracting-terms" && (
            <div className="flex items-center gap-2">
              <span className="animate-pulse">●</span>
              正在提取并核验关键术语...
            </div>
          )}
          {phase === "analyzing" && (
            <div className="flex items-center gap-2">
              <span className="animate-pulse">●</span>
              正在分析论文...
            </div>
          )}
        </div>
      )}

      {/* Results tabs */}
      {(translatedText || terms.length > 0 || analysis) && (
        <div className="space-y-4">
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-border">
            {(
              [
                { key: "translation", label: "译文", show: !!translatedText },
                { key: "terms", label: `关键词 ${terms.length > 0 ? `(${terms.length})` : ""}`, show: true },
                { key: "analysis", label: "论文分析", show: true },
              ] as { key: ActiveTab; label: string; show: boolean }[]
            )
              .filter((t) => t.show)
              .map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === tab.key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
          </div>

          {/* Translation tab */}
          {activeTab === "translation" && translatedText && (
            <Card>
              <CardContent className="pt-4">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <pre
                    className="whitespace-pre-wrap font-sans text-sm leading-relaxed"
                    style={{ fontFamily: "inherit" }}
                  >
                    {translatedText}
                    {phase === "translating" && (
                      <span className="inline-block w-2 h-4 ml-0.5 bg-primary/70 animate-pulse align-middle" />
                    )}
                  </pre>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Terms tab */}
          {activeTab === "terms" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  学术关键词对照表
                  {phase === "extracting-terms" && (
                    <span className="ml-2 text-muted-foreground animate-pulse text-xs">提取中...</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {terms.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {phase === "extracting-terms"
                      ? "正在提取关键词..."
                      : "暂无关键词（翻译完成后自动提取）"}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground text-xs">
                          <th className="text-left py-2 pr-4 font-medium w-2/5">英文术语</th>
                          <th className="text-left py-2 pr-4 font-medium w-2/5">中文翻译</th>
                          <th className="text-left py-2 pr-2 font-medium w-1/10">类别</th>
                          <th className="text-left py-2 font-medium w-1/10">核验</th>
                        </tr>
                      </thead>
                      <tbody>
                        {terms.map((t, i) => {
                          const displayZh = t.correction ?? t.zh;
                          const catLabel =
                            t.category === "theory"
                              ? "理论"
                              : t.category === "method"
                              ? "方法"
                              : t.category === "concept"
                              ? "概念"
                              : "其他";
                          return (
                            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="py-2 pr-4 font-mono text-xs text-foreground/80">
                                {t.en}
                              </td>
                              <td className="py-2 pr-4">
                                <span className={t.isAccurate ? "" : "font-medium"}>
                                  {displayZh}
                                </span>
                                {!t.isAccurate && (
                                  <span className="ml-1 text-xs text-orange-500">（已修正）</span>
                                )}
                              </td>
                              <td className="py-2 pr-2">
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  {catLabel}
                                </Badge>
                              </td>
                              <td className="py-2">
                                <span
                                  className={`text-xs font-medium ${
                                    t.isAccurate ? "text-green-600" : "text-orange-500"
                                  }`}
                                >
                                  {t.isAccurate ? "✓" : "⚡"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Analysis tab */}
          {activeTab === "analysis" && (
            <div className="space-y-4">
              {!analysis ? (
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-sm text-muted-foreground">
                      {phase === "analyzing"
                        ? "正在分析论文..."
                        : "暂无分析（翻译完成后自动生成）"}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {(
                    [
                      { label: "研究概要", content: analysis.summary },
                      { label: "研究方法", content: analysis.methods },
                      { label: "学术贡献", content: analysis.contributions },
                      { label: "创新点", content: analysis.innovations },
                    ] as { label: string; content: string }[]
                  ).map(({ label, content }) => (
                    <Card key={label}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold">{label}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
                      </CardContent>
                    </Card>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
