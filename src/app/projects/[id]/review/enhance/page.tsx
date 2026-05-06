"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
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
import {
  AnalysisEngineSelect,
  type AnalysisEngine,
} from "@/components/analysis-engine-select";
import { AnalysisChat } from "@/components/analysis-chat";
import type {
  DraftAnalysis,
  GapAnalysis,
  RevisionPlan,
  EnhancePhase,
} from "@/lib/research/review-enhance";

interface Paper {
  id: string;
  title: string;
  abstract?: string | null;
  authors: { name: string }[];
  year?: number;
  venue?: string;
  fullText?: string | null;
}

export default function ReviewEnhancePage() {
  const params = useParams();
  const projectId = params.id as string;
  const NS = `enhance-${projectId}`;

  // Persisted state
  const [provider, setProvider] = usePersistedState<AIProvider>(NS, "provider", "deepseek-fast");
  const [engine, setEngine] = usePersistedState<AnalysisEngine>(NS, "engine", "builtin");
  const [draftText, setDraftText] = usePersistedState<string>(NS, "draftText", "");
  const [draftAnalysis, setDraftAnalysis] = usePersistedState<DraftAnalysis | null>(NS, "draftAnalysis", null);
  const [gapAnalysis, setGapAnalysis] = usePersistedState<GapAnalysis | null>(NS, "gapAnalysis", null);
  const [revisionPlan, setRevisionPlan] = usePersistedState<RevisionPlan | null>(NS, "revisionPlan", null);
  const [enhancedReview, setEnhancedReview] = usePersistedState<string>(NS, "enhancedReview", "");
  const [journalLang, setJournalLang] = usePersistedState<"en" | "zh">(NS, "journalLang", "en");

  // Transient state
  const [phase, setPhase] = useState<EnhancePhase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [libraryPapers, setLibraryPapers] = useState<Paper[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const xAbort = useAbort();
  const fileRef = useRef<HTMLInputElement>(null);

  // Restore phase from persisted data
  useEffect(() => {
    if (enhancedReview) setPhase("done");
    else if (revisionPlan) setPhase("user-review");
    else if (gapAnalysis) setPhase("user-review");
    else if (draftAnalysis) setPhase("user-review");
    else if (draftText) setPhase("user-review");
    // else stays "idle"
  }, []);

  // Load library papers
  useEffect(() => {
    setLibraryLoading(true);
    fetch(`/api/papers?projectId=${projectId}&source=fulltext`)
      .then((r) => r.json())
      .then((d) => setLibraryPapers(d.papers ?? []))
      .catch(() => {})
      .finally(() => setLibraryLoading(false));
  }, [projectId]);

  // ─── Handlers ──────────────────────────────────

  async function handleUploadDocx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhase("uploading");
    setStatusMsg("正在提取 Word 文档内容...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/research/review-enhance", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("文档解析失败");
      const data = await res.json();
      setDraftText(data.text);
      setStatusMsg(`已提取 ${data.charCount.toLocaleString()} 字`);
      setPhase("user-review");
    } catch (err) {
      setStatusMsg("上传失败: " + String(err));
      setPhase("idle");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleAnalyzeDraft() {
    if (!draftText) return;
    setPhase("analyzing");
    setStatusMsg("AI 正在分析综述初稿...");
    const signal = xAbort.reset();

    try {
      const res = await fetch("/api/research/review-enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "analyze-draft",
          draftText,
          libraryPapers: libraryPapers.map(p => ({
            id: p.id, title: p.title, abstract: p.abstract,
            authors: p.authors, year: p.year, venue: p.venue,
          })),
          provider,
        }),
        signal,
      });

      await processSSE(res, (evt) => {
        if (evt.type === "status") setStatusMsg(evt.message as string);
        else if (evt.type === "analysis") {
          setDraftAnalysis(evt.data as DraftAnalysis);
          setPhase("user-review");
          setStatusMsg("");
        }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setStatusMsg("分析失败: " + String(err));
        setPhase("user-review");
      }
    }
  }

  async function handleSearchGaps() {
    if (!draftAnalysis) return;
    setPhase("searching");
    setStatusMsg("正在检索补充文献...");
    const signal = xAbort.reset();

    try {
      const res = await fetch("/api/research/review-enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "search-gaps",
          keywords: draftAnalysis.keywords,
          citedRefs: draftAnalysis.citedReferences,
          projectId,
          journalLang,
          draftAnalysis,
          libraryPapers: libraryPapers.map(p => ({
            id: p.id, title: p.title, abstract: p.abstract,
            authors: p.authors, year: p.year, venue: p.venue,
          })),
          provider,
        }),
        signal,
      });

      await processSSE(res, (evt) => {
        if (evt.type === "status") setStatusMsg(evt.message as string);
        else if (evt.type === "gaps") {
          setGapAnalysis(evt.data as GapAnalysis);
          setPhase("user-review");
          setStatusMsg("");
        }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setStatusMsg("检索失败: " + String(err));
        setPhase("user-review");
      }
    }
  }

  async function handleGeneratePlan() {
    if (!draftAnalysis || !gapAnalysis) return;
    setPhase("planning");
    setStatusMsg("正在生成修改计划...");
    const signal = xAbort.reset();

    try {
      const res = await fetch("/api/research/review-enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate-plan",
          draftText: draftText.slice(0, 8000),
          draftAnalysis,
          gapAnalysis,
          libraryPapers: libraryPapers.map(p => ({
            id: p.id, title: p.title, abstract: p.abstract,
            authors: p.authors, year: p.year, venue: p.venue,
          })),
          provider,
          engine,
        }),
        signal,
      });

      await processSSE(res, (evt) => {
        if (evt.type === "status") setStatusMsg(evt.message as string);
        else if (evt.type === "plan") {
          setRevisionPlan(evt.data as RevisionPlan);
          setPhase("user-review");
          setStatusMsg("");
        }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setStatusMsg("生成失败: " + String(err));
        setPhase("user-review");
      }
    }
  }

  async function handleRewrite() {
    if (!revisionPlan) return;
    setPhase("rewriting");
    setStatusMsg("AI 正在优化综述...");
    setEnhancedReview("");
    const signal = xAbort.reset();

    try {
      const searchPapers = (gapAnalysis?.newPapers ?? []).map(p => ({
        title: p.title, authors: p.authors, year: p.year,
        venue: p.venue, abstract: p.abstract,
      }));

      const res = await fetch("/api/research/review-enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rewrite",
          draftText,
          revisionPlan,
          libraryPapers: libraryPapers.slice(0, 20).map(p => ({
            id: p.id, title: p.title, abstract: p.abstract,
            authors: p.authors, year: p.year, venue: p.venue,
            fullText: p.fullText?.slice(0, 5000),
          })),
          searchPapers,
          provider,
        }),
        signal,
      });

      let text = "";
      await processSSE(res, (evt) => {
        if (evt.type === "status") setStatusMsg(evt.message as string);
        else if (evt.type === "text") {
          text += evt.text as string;
          setEnhancedReview(text);
        } else if (evt.type === "done") {
          setPhase("done");
          setStatusMsg("");
        }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setStatusMsg("改写失败: " + String(err));
        if (enhancedReview) setPhase("done");
        else setPhase("user-review");
      }
    }
  }

  async function handleExportWord() {
    const { generateReviewDocx, downloadBlob } = await import("@/lib/docx-export");
    const blob = await generateReviewDocx(draftAnalysis?.topic ?? "文献综述", enhancedReview);
    downloadBlob(blob, `综述优化-${new Date().toISOString().slice(0, 10)}.docx`);
  }

  function handleReset() {
    if (!confirm("确定重置所有数据？将清除已上传的初稿和所有分析结果。")) return;
    setDraftText("");
    setDraftAnalysis(null);
    setGapAnalysis(null);
    setRevisionPlan(null);
    setEnhancedReview("");
    setPhase("idle");
    setStatusMsg("");
  }

  // ─── SSE Parser ────────────────────────────────

  async function processSSE(
    res: Response,
    onEvent: (evt: Record<string, unknown>) => void,
  ) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
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
          onEvent(JSON.parse(line.slice(6)));
        } catch { /* skip */ }
      }
    }
  }

  // ─── Progress steps ────────────────────────────

  const steps = [
    { key: "upload", label: "上传初版" },
    { key: "analyze", label: "分析" },
    { key: "search", label: "检索" },
    { key: "plan", label: "修改计划" },
    { key: "done", label: "优化完成" },
  ];

  function currentStep(): number {
    if (enhancedReview) return 4;
    if (revisionPlan) return 3;
    if (gapAnalysis) return 3;
    if (draftAnalysis) return 2;
    if (draftText) return 1;
    return 0;
  }

  const actionBadge: Record<string, { label: string; color: string }> = {
    add: { label: "新增", color: "bg-green-100 text-green-800" },
    expand: { label: "扩展", color: "bg-blue-100 text-blue-800" },
    restructure: { label: "调整", color: "bg-amber-100 text-amber-800" },
    keep: { label: "保留", color: "bg-gray-100 text-gray-600" },
  };

  const severityColor: Record<string, string> = {
    high: "text-red-600",
    medium: "text-amber-600",
    low: "text-gray-500",
  };

  const isWorking = ["uploading", "analyzing", "searching", "gap-analysis", "planning", "rewriting"].includes(phase);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/projects/${projectId}/review`} className="text-xs text-muted-foreground hover:text-foreground">
            ← 文献综述
          </Link>
          <h1 className="font-heading text-2xl font-bold">综述优化</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            上传综述初版 Word 文档 + 文献库参考文献 → AI 分析、检索、改进 → 导出优化版
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AnalysisEngineSelect value={engine} onChange={setEngine} />
          <AIProviderSelect value={provider} onChange={setProvider} />
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className={`h-2 w-12 rounded-full transition-colors ${
              currentStep() >= i ? "bg-teal" : "bg-border"
            }`} />
            <span className={`text-[10px] whitespace-nowrap ${
              currentStep() >= i ? "text-teal font-medium" : "text-muted-foreground"
            }`}>{s.label}</span>
            {i < steps.length - 1 && <span className="text-border">→</span>}
          </div>
        ))}
      </div>

      {/* Data source panel */}
      <Card className="border-teal/20 bg-teal/[0.02]">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">文献库：</span>
                {libraryLoading ? (
                  <span className="text-xs text-muted-foreground">加载中...</span>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    {libraryPapers.length} 篇已上传原文
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">综述初版：</span>
                {draftText ? (
                  <Badge variant="secondary" className="text-[10px] bg-teal/10 text-teal">
                    已上传 ({draftText.length.toLocaleString()} 字)
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">未上传</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/projects/${projectId}/papers`}>
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  去文献库上传 PDF
                </Button>
              </Link>
              {(draftText || draftAnalysis) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={handleReset}>
                  重置
                </Button>
              )}
            </div>
          </div>

          {libraryPapers.length === 0 && !libraryLoading && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              请先在「文献库」中上传您撰写综述时引用的参考文献 PDF，以便 AI 进行对照分析。
            </p>
          )}
        </CardContent>
      </Card>

      {/* Status message */}
      {statusMsg && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {isWorking && <span className="inline-block w-4 h-4 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />}
          {statusMsg}
          <StopButton show={isWorking} onClick={xAbort.abort} />
        </div>
      )}

      {/* Phase 1: Upload Word */}
      {!draftText && phase === "idle" && (
        <Card className="min-h-[200px] flex items-center justify-center border-dashed border-2">
          <CardContent className="text-center p-8">
            <div className="text-4xl mb-4">📄</div>
            <p className="font-medium mb-2">上传文献综述初版（Word 文档）</p>
            <p className="text-sm text-muted-foreground mb-4">
              支持 .docx 格式，系统将提取文本内容进行分析
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".docx"
              className="hidden"
              onChange={handleUploadDocx}
            />
            <Button onClick={() => fileRef.current?.click()} className="bg-teal text-teal-foreground hover:bg-teal/90">
              选择 Word 文档
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Draft text preview + action buttons */}
      {draftText && !enhancedReview && (
        <div className="space-y-4">
          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {!draftAnalysis && (
              <Button onClick={handleAnalyzeDraft} disabled={isWorking} className="bg-teal text-teal-foreground hover:bg-teal/90 h-8 text-xs">
                分析初稿
              </Button>
            )}
            {draftAnalysis && !gapAnalysis && (
              <>
                <Button onClick={handleSearchGaps} disabled={isWorking} className="bg-teal text-teal-foreground hover:bg-teal/90 h-8 text-xs">
                  检索补充文献
                </Button>
                <select
                  value={journalLang}
                  onChange={(e) => setJournalLang(e.target.value as "en" | "zh")}
                  className="h-8 px-2 text-xs border border-input rounded bg-background"
                >
                  <option value="en">英文期刊</option>
                  <option value="zh">中文期刊</option>
                </select>
              </>
            )}
            {gapAnalysis && !revisionPlan && (
              <Button onClick={handleGeneratePlan} disabled={isWorking} className="bg-teal text-teal-foreground hover:bg-teal/90 h-8 text-xs">
                生成修改计划
              </Button>
            )}
            {revisionPlan && (
              <Button onClick={handleRewrite} disabled={isWorking} className="bg-teal text-teal-foreground hover:bg-teal/90 h-8 text-xs">
                执行优化
              </Button>
            )}
            <input
              type="file"
              accept=".docx"
              className="hidden"
              ref={fileRef}
              onChange={handleUploadDocx}
            />
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => fileRef.current?.click()}>
              重新上传初稿
            </Button>
          </div>

          {/* Draft Analysis Results */}
          {draftAnalysis && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">初稿分析结果</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <span className="font-medium text-teal">研究主题：</span>
                  {draftAnalysis.topic}
                </div>
                <div>
                  <span className="font-medium text-teal">主要主题：</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {draftAnalysis.keyThemes.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="font-medium text-teal">结构概要：</span>
                  <div className="mt-1 space-y-1">
                    {draftAnalysis.structureOutline.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-teal">{i + 1}.</span>
                        <span>{s.heading}</span>
                        <Badge variant="outline" className="text-[9px]">{s.citationCount} 引用</Badge>
                      </div>
                    ))}
                  </div>
                </div>
                {draftAnalysis.weakSections.length > 0 && (
                  <div>
                    <span className="font-medium text-amber-600">薄弱环节：</span>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {draftAnalysis.weakSections.map((w, i) => (
                        <li key={i}>- {w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  已引用 {draftAnalysis.citedReferences.length} 篇文献 · 文献库匹配 {draftAnalysis.libraryMatchCount} 篇 · 检索关键词: {draftAnalysis.keywords.join(", ")}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Gap Analysis Results */}
          {gapAnalysis && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Gap 分析结果</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {/* Coverage gaps */}
                {gapAnalysis.coverageGaps.length > 0 && (
                  <div>
                    <span className="font-medium text-amber-600">覆盖缺口：</span>
                    <div className="mt-1 space-y-2">
                      {gapAnalysis.coverageGaps.map((g, i) => (
                        <div key={i} className="bg-amber-50 border border-amber-200 rounded p-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-medium ${severityColor[g.severity]}`}>[{g.severity}]</span>
                            <span className="font-medium text-xs">{g.theme}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommended new papers */}
                {gapAnalysis.newPapers.length > 0 && (
                  <div>
                    <span className="font-medium text-teal">推荐补充文献（{gapAnalysis.newPapers.length}）：</span>
                    <div className="mt-1 space-y-2 max-h-[300px] overflow-y-auto">
                      {gapAnalysis.newPapers.map((p, i) => (
                        <div key={i} className="bg-teal/5 border border-teal/20 rounded p-2">
                          <p className="text-xs font-medium">{p.title} ({p.year})</p>
                          <p className="text-[10px] text-muted-foreground">{p.authors} — {p.venue}</p>
                          <p className="text-[10px] text-teal mt-0.5">建议添加到：{p.suggestedSection}</p>
                          <p className="text-[10px] text-muted-foreground">{p.relevanceReason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unused library papers */}
                {gapAnalysis.libraryUnused.length > 0 && (
                  <div>
                    <span className="font-medium text-blue-600">文献库中未引用的相关文献：</span>
                    <ul className="mt-1 text-xs text-muted-foreground space-y-0.5">
                      {gapAnalysis.libraryUnused.map((t, i) => (
                        <li key={i}>- {t}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Weak sections */}
                {gapAnalysis.weakSections.length > 0 && (
                  <div>
                    <span className="font-medium text-amber-600">需改进章节：</span>
                    <div className="mt-1 space-y-1">
                      {gapAnalysis.weakSections.map((w, i) => (
                        <div key={i} className="text-xs">
                          <span className="font-medium">{w.heading}:</span> {w.issue} → <span className="text-teal">{w.suggestion}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Revision Plan */}
          {revisionPlan && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">修改计划</CardTitle>
                  <Badge variant="secondary" className="text-[10px]">{revisionPlan.estimatedChanges}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">{revisionPlan.overallStrategy}</p>
                <div className="space-y-2">
                  {revisionPlan.sections.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded border border-border/50">
                      <Badge className={`text-[9px] shrink-0 ${actionBadge[s.action]?.color ?? ""}`}>
                        {actionBadge[s.action]?.label ?? s.action}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-xs font-medium">{s.heading}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{s.description}</p>
                        {s.papersToAdd.length > 0 && (
                          <p className="text-[10px] text-teal mt-0.5">
                            引入: {s.papersToAdd.join("; ")}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className={`text-[9px] shrink-0 ${severityColor[s.priority]}`}>
                        {s.priority}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Draft preview (collapsible) */}
          <DraftPreview text={draftText} />
        </div>
      )}

      {/* Phase 5: Enhanced review result */}
      {enhancedReview && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-heading">
                  {draftAnalysis?.topic ?? "优化后的文献综述"}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={handleExportWord}>
                    导出 Word
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => navigator.clipboard.writeText(enhancedReview)}>
                    复制全文
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={handleReset}>
                    重置
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none text-foreground leading-relaxed whitespace-pre-wrap">
                {enhancedReview}
              </div>
            </CardContent>
          </Card>

          {/* Revision plan summary (collapsed) */}
          {revisionPlan && (
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
                查看修改计划 ({revisionPlan.estimatedChanges})
              </summary>
              <div className="mt-2 space-y-1 pl-4">
                {revisionPlan.sections.filter(s => s.action !== "keep").map((s, i) => (
                  <div key={i}>
                    <Badge className={`text-[9px] ${actionBadge[s.action]?.color ?? ""}`}>
                      {actionBadge[s.action]?.label}
                    </Badge>{" "}
                    {s.heading}: {s.description}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Chat (available after analysis) */}
      {(draftAnalysis || enhancedReview) && (
        <AnalysisChat
          namespace={NS}
          analysisContext={enhancedReview || draftText.slice(0, 8000)}
          systemPrompt="You are a literature review enhancement expert. Help the user improve their literature review. Answer in Chinese. When the user asks for modifications, explain what you would change and why. Reference specific sections and papers."
          provider={provider}
          paperTitles={libraryPapers.map(p => p.title)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────

function DraftPreview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
        {open ? "收起" : "展开"}综述初稿预览 ({text.length.toLocaleString()} 字)
      </summary>
      <div className="mt-2 border border-border/50 rounded-lg p-4 bg-muted/20 max-h-[400px] overflow-y-auto">
        <pre className="text-xs leading-relaxed whitespace-pre-wrap font-[family-name:var(--font-sans)] text-foreground/80">
          {text}
        </pre>
      </div>
    </details>
  );
}
