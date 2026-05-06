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
import type {
  DraftAnalysis,
  GapAnalysis,
  RevisionPlan,
  EnhancePhase,
  TopicGroup,
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

// ─── Revision Basket Item ────────────────────

interface BasketItem {
  id: string;
  action: "add" | "expand" | "deepen" | "restructure" | "add-paper" | "new-direction" | "strengthen" | "delete" | "custom";
  heading: string;
  description: string;
  papersToAdd: string[];
  source: "plan" | "chat";
  round: number;
}

// ─── Chat Message with extractable suggestions ──

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestions?: BasketItem[];
  modifiedReview?: string; // AI's directly modified review text
}

export default function ReviewEnhancePage() {
  const params = useParams();
  const projectId = params.id as string;
  const NS = `enhance-${projectId}`;

  // Persisted state
  const [provider, setProvider] = usePersistedState<AIProvider>(NS, "provider", "deepseek-fast");
  const [engine, setEngine] = usePersistedState<AnalysisEngine>(NS, "engine", "builtin");
  const [wordCountMin, setWordCountMin] = usePersistedState<number>(NS, "wcMin", 8000);
  const [wordCountMax, setWordCountMax] = usePersistedState<number>(NS, "wcMax", 12000);
  const [draftText, setDraftText] = usePersistedState<string>(NS, "draftText", "");
  const [draftAnalysis, setDraftAnalysis] = usePersistedState<DraftAnalysis | null>(NS, "draftAnalysis", null);
  const [gapAnalysis, setGapAnalysis] = usePersistedState<GapAnalysis | null>(NS, "gapAnalysis", null);
  const [revisionPlan, setRevisionPlan] = usePersistedState<RevisionPlan | null>(NS, "revisionPlan", null);
  const [enhancedReview, setEnhancedReview] = usePersistedState<string>(NS, "enhancedReview", "");
  const [journalLang, setJournalLang] = usePersistedState<"en" | "zh">(NS, "journalLang", "en");
  const [selectedKeywords, setSelectedKeywords] = usePersistedState<Set<string>>(NS, "selKw", new Set());
  const [customKeyword, setCustomKeyword] = useState("");
  const [basket, setBasket] = usePersistedState<BasketItem[]>(NS, "basket", []);
  const [chatMessages, setChatMessages] = usePersistedState<ChatMessage[]>(NS, "chatMsgs", []);

  // Transient state
  const [phase, setPhase] = useState<EnhancePhase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [libraryPapers, setLibraryPapers] = useState<Paper[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const [basketOpen, setBasketOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const xAbort = useAbort();
  const chatAbort = useAbort();
  const fileRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatRound = useRef(0);

  // Restore phase from persisted data
  useEffect(() => {
    if (enhancedReview) setPhase("done");
    else if (revisionPlan || gapAnalysis || draftAnalysis || draftText) setPhase("user-review");
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

  // Auto-scroll chat
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages]);

  // ─── Basket helpers ────────────────────────────

  function addToBasket(item: BasketItem) {
    setBasket(prev => prev.some(b => b.id === item.id) ? prev : [...prev, item]);
  }

  function removeFromBasket(id: string) {
    setBasket(prev => prev.filter(b => b.id !== id));
  }

  function isInBasket(id: string) {
    return basket.some(b => b.id === id);
  }

  function toggleBasketItem(item: BasketItem) {
    if (isInBasket(item.id)) removeFromBasket(item.id);
    else addToBasket(item);
  }

  // ─── Convert plan sections to basket items ─────

  function planToBasketItems(plan: RevisionPlan): BasketItem[] {
    return plan.sections.filter(s => s.action !== "keep").map((s, i) => ({
      id: `plan-${i}`,
      action: s.action as BasketItem["action"],
      heading: s.heading,
      description: s.description,
      papersToAdd: s.papersToAdd,
      source: "plan" as const,
      round: 0,
    }));
  }

  // ─── Handlers ──────────────────────────────────

  async function handleUploadDocx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhase("uploading");
    setStatusMsg("正在提取 Word 文档内容...");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/research/review-enhance", { method: "POST", body: formData });
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
          action: "analyze-draft", draftText, provider,
          libraryPapers: libraryPapers.map(p => ({ id: p.id, title: p.title, abstract: p.abstract, authors: p.authors, year: p.year, venue: p.venue })),
        }),
        signal,
      });
      await processSSE(res, (evt) => {
        if (evt.type === "status") setStatusMsg(evt.message as string);
        else if (evt.type === "analysis") {
          const analysis = evt.data as DraftAnalysis;
          setDraftAnalysis(analysis);
          setSelectedKeywords(new Set(analysis.keywords));
          setPhase("user-review");
          setStatusMsg("");
        }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") { setStatusMsg("分析失败: " + String(err)); setPhase("user-review"); }
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
          action: "search-gaps", keywords: Array.from(selectedKeywords), citedRefs: draftAnalysis.citedReferences,
          projectId, journalLang, draftAnalysis, provider,
          libraryPapers: libraryPapers.map(p => ({ id: p.id, title: p.title, abstract: p.abstract, authors: p.authors, year: p.year, venue: p.venue })),
        }),
        signal,
      });
      await processSSE(res, (evt) => {
        if (evt.type === "status") setStatusMsg(evt.message as string);
        else if (evt.type === "gaps") { setGapAnalysis(evt.data as GapAnalysis); setPhase("user-review"); setStatusMsg(""); }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") { setStatusMsg("检索失败: " + String(err)); setPhase("user-review"); }
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
          action: "generate-plan", draftText: draftText.slice(0, 8000), draftAnalysis, provider, engine,
          // Only pass user-selected papers from basket + gap analysis context (filtered by basket)
          selectedPapers: basket.filter(b => b.action === "add-paper").map(b => b.papersToAdd).flat(),
          gapAnalysis: {
            ...gapAnalysis,
            // Filter topicGroups to only include papers the user selected
            topicGroups: (gapAnalysis?.topicGroups ?? []).map(tg => ({
              ...tg,
              papers: tg.papers.filter(p => basket.some(b => b.papersToAdd?.includes(p.title))),
            })).filter(tg => tg.papers.length > 0),
          },
          libraryPapers: libraryPapers.map(p => ({ id: p.id, title: p.title, abstract: p.abstract, authors: p.authors, year: p.year, venue: p.venue })),
        }),
        signal,
      });
      await processSSE(res, (evt) => {
        if (evt.type === "status") setStatusMsg(evt.message as string);
        else if (evt.type === "plan") {
          const plan = evt.data as RevisionPlan;
          setRevisionPlan(plan);
          // Auto-add all non-keep items to basket
          const items = planToBasketItems(plan);
          setBasket(prev => {
            const existing = new Set(prev.map(b => b.id));
            return [...prev, ...items.filter(i => !existing.has(i.id))];
          });
          setPhase("user-review");
          setStatusMsg("");
        }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") { setStatusMsg("生成失败: " + String(err)); setPhase("user-review"); }
    }
  }

  async function handleRewrite() {
    if (basket.length === 0) { setStatusMsg("修改篮为空，请先勾选修改项"); return; }
    setPhase("rewriting");
    setStatusMsg("AI 正在根据修改篮执行优化...");
    setEnhancedReview("");
    const signal = xAbort.reset();
    try {
      const basketPlan: RevisionPlan = {
        sections: basket.map(b => ({ action: b.action === "add-paper" || b.action === "custom" ? "expand" : b.action, heading: b.heading, description: b.description, papersToAdd: b.papersToAdd, priority: "high" as const })),
        overallStrategy: `用户选择了 ${basket.length} 项修改，请严格按照这些修改执行。`,
        estimatedChanges: `${basket.length} 项修改`,
      };
      const searchPapers = (gapAnalysis?.newPapers ?? []).map(p => ({ title: p.title, authors: p.authors, year: p.year, venue: p.venue, abstract: p.abstract }));
      const res = await fetch("/api/research/review-enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rewrite", draftText, revisionPlan: basketPlan, provider,
          wordCount: { min: wordCountMin, max: wordCountMax },
          libraryPapers: libraryPapers.slice(0, 20).map(p => ({ id: p.id, title: p.title, abstract: p.abstract, authors: p.authors, year: p.year, venue: p.venue, fullText: p.fullText?.slice(0, 5000) })),
          searchPapers,
        }),
        signal,
      });
      let text = "";
      await processSSE(res, (evt) => {
        if (evt.type === "status") setStatusMsg(evt.message as string);
        else if (evt.type === "text") { text += evt.text as string; setEnhancedReview(text); }
        else if (evt.type === "done") { setPhase("done"); setStatusMsg(""); }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") { setStatusMsg("改写失败: " + String(err)); if (enhancedReview) setPhase("done"); else setPhase("user-review"); }
    }
  }

  async function handleExportWord() {
    const { generateReviewDocx, downloadBlob } = await import("@/lib/docx-export");
    const blob = await generateReviewDocx(draftAnalysis?.topic ?? "文献综述", enhancedReview);
    downloadBlob(blob, `综述优化-${new Date().toISOString().slice(0, 10)}.docx`);
  }

  function handleReset() {
    if (!confirm("确定重置？将清除所有数据。")) return;
    setDraftText(""); setDraftAnalysis(null); setGapAnalysis(null); setRevisionPlan(null);
    setEnhancedReview(""); setBasket([]); setChatMessages([]);
    setPhase("idle"); setStatusMsg("");
  }

  // ─── Chat: send + extract suggestions ──────────

  async function handleChatSend() {
    const text = chatInput.trim();
    if (!text || chatStreaming) return;
    setChatInput("");
    chatRound.current += 1;
    const round = chatRound.current;

    const userMsg: ChatMessage = { role: "user", content: text };
    const placeholder: ChatMessage = { role: "assistant", content: "..." };
    setChatMessages(prev => [...prev, userMsg, placeholder]);
    setChatStreaming(true);

    const signal = chatAbort.reset();
    try {
      const hasReview = !!enhancedReview;
      const reviewText = enhancedReview || draftText;

      const systemPrompt = hasReview
        ? `You are a literature review editor. The user has an enhanced review and wants you to directly modify it.

You have TWO modes:

MODE 1 — DIRECT EDIT: When the user asks to delete, add, modify, rewrite, or restructure any part of the review, output the COMPLETE modified review wrapped in <modified-review> tags:
<modified-review>
(完整的修改后综述文本，包含所有章节)
</modified-review>

After the tags, briefly explain what you changed (1-2 sentences).

MODE 2 — SUGGESTIONS: When the user asks for advice, recommendations, or analysis (NOT direct edits), format suggestions as:
【建议1】[action] 章节: 描述
where action is add/expand/restructure/add-paper.

RULES:
- The review text below is the COMPLETE current version. You CAN and SHOULD directly modify it.
- When editing, preserve all unchanged sections exactly as-is. Only modify what the user asks for.
- Answer in Chinese. Use markdown headings (##, ###).
- For deletions: simply remove the section/paragraph the user specifies.
- For additions: add new content at the appropriate location.
- For rewrites: replace the specified section with improved text.`
        : `You are a literature review enhancement expert helping refine revision plans.

Format suggestions as:
【建议1】[action] 章节: 描述
where action is add/expand/restructure/add-paper.

Answer in Chinese. Be specific and actionable.`;

      const context = [
        draftAnalysis ? `Research topic: ${draftAnalysis.topic}` : "",
        basket.length > 0 ? `\nRevision basket (${basket.length} items):\n${basket.map(b => `- [${b.action}] ${b.heading}: ${b.description}`).join("\n")}` : "",
        `\n## 当前综述全文 (${reviewText.length} 字)\n\n${reviewText.slice(0, 15000)}`,
      ].filter(Boolean).join("\n");

      const messages = [
        { role: "system" as const, content: systemPrompt + "\n\n" + context },
        ...chatMessages.filter(m => !m.suggestions).map(m => ({ role: m.role as "user" | "assistant", content: typeof m.content === "string" ? m.content.replace(/<modified-review>[\s\S]*<\/modified-review>/g, "[已输出修改版本]") : m.content })),
        { role: "user" as const, content: text },
      ];

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, messages }),
        signal,
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.text) {
              fullText += evt.text;
              setChatMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: fullText };
                return updated;
              });
            }
          } catch { /* skip */ }
        }
      }

      // Check for direct review modification
      const modifiedMatch = fullText.match(/<modified-review>([\s\S]*?)<\/modified-review>/);
      if (modifiedMatch) {
        const modifiedText = modifiedMatch[1].trim();
        // Store the modified version in the message for "apply" button
        setChatMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: fullText,
            modifiedReview: modifiedText,
          };
          return updated;
        });
      } else {
        // Parse suggestions from the response
        const suggestions = parseSuggestions(fullText, round);
        if (suggestions.length > 0) {
          setChatMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: fullText, suggestions };
            return updated;
          });
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setChatMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: "回答失败: " + String(err) };
          return updated;
        });
      }
    } finally {
      setChatStreaming(false);
    }
  }

  function parseSuggestions(text: string, round: number): BasketItem[] {
    const items: BasketItem[] = [];
    const regex = /【建议(\d+)】\s*\[(\w[\w-]*)\]\s*([^:：]+)[：:]\s*(.+?)(?=【建议|$)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const [, num, action, heading, desc] = match;
      items.push({
        id: `chat-r${round}-${num}`,
        action: (["add", "expand", "deepen", "restructure", "add-paper", "new-direction", "strengthen", "delete"].includes(action) ? action : "custom") as BasketItem["action"],
        heading: heading.trim(),
        description: desc.trim(),
        papersToAdd: [],
        source: "chat",
        round,
      });
    }
    return items;
  }

  // ─── SSE Parser ────────────────────────────────

  async function processSSE(res: Response, onEvent: (evt: Record<string, unknown>) => void) {
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
        try { onEvent(JSON.parse(line.slice(6))); } catch { /* skip */ }
      }
    }
  }

  // ─── UI helpers ────────────────────────────────

  const steps = [
    { key: "upload", label: "上传初版" },
    { key: "analyze", label: "分析" },
    { key: "search", label: "检索" },
    { key: "plan", label: "修改篮" },
    { key: "done", label: "优化完成" },
  ];

  function currentStep(): number {
    if (enhancedReview) return 4;
    if (basket.length > 0 || revisionPlan) return 3;
    if (gapAnalysis) return 3;
    if (draftAnalysis) return 2;
    if (draftText) return 1;
    return 0;
  }

  const actionBadge: Record<string, { label: string; color: string }> = {
    add: { label: "新增章节", color: "bg-green-100 text-green-800" },
    expand: { label: "扩展内容", color: "bg-blue-100 text-blue-800" },
    deepen: { label: "深入分析", color: "bg-cyan-100 text-cyan-800" },
    restructure: { label: "调整结构", color: "bg-amber-100 text-amber-800" },
    "add-paper": { label: "补充文献", color: "bg-purple-100 text-purple-800" },
    "new-direction": { label: "新方向", color: "bg-emerald-100 text-emerald-800" },
    strengthen: { label: "强化论证", color: "bg-rose-100 text-rose-800" },
    delete: { label: "删除", color: "bg-red-100 text-red-700" },
    keep: { label: "保留", color: "bg-gray-100 text-gray-600" },
    custom: { label: "自定义", color: "bg-indigo-100 text-indigo-800" },
  };

  const severityColor: Record<string, string> = { high: "text-red-600", medium: "text-amber-600", low: "text-gray-500" };
  const isWorking = ["uploading", "analyzing", "searching", "gap-analysis", "planning", "rewriting"].includes(phase);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/projects/${projectId}/review`} className="text-xs text-muted-foreground hover:text-foreground">← 文献综述</Link>
          <h1 className="font-heading text-2xl font-bold">综述优化</h1>
          <p className="text-muted-foreground mt-1 text-sm">上传 Word 初版 → AI 分析 → 勾选修改项到篮子 → 对话调整 → 执行优化 → 导出 Word</p>
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
            <div className={`h-2 w-12 rounded-full transition-colors ${currentStep() >= i ? "bg-teal" : "bg-border"}`} />
            <span className={`text-[10px] whitespace-nowrap ${currentStep() >= i ? "text-teal font-medium" : "text-muted-foreground"}`}>{s.label}</span>
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
                {libraryLoading ? <span className="text-xs text-muted-foreground">加载中...</span> : (
                  <Badge variant="secondary" className="text-[10px]">{libraryPapers.length} 篇已上传原文</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">综述初版：</span>
                {draftText ? <Badge variant="secondary" className="text-[10px] bg-teal/10 text-teal">已上传 ({draftText.length.toLocaleString()} 字)</Badge>
                  : <span className="text-xs text-muted-foreground">未上传</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/projects/${projectId}/papers`}>
                <Button size="sm" variant="outline" className="h-7 text-xs">去文献库上传 PDF</Button>
              </Link>
              {(draftText || draftAnalysis) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={handleReset}>重置</Button>
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
            <p className="text-sm text-muted-foreground mb-4">支持 .docx 格式</p>
            <input ref={fileRef} type="file" accept=".docx" className="hidden" onChange={handleUploadDocx} />
            <Button onClick={() => fileRef.current?.click()} className="bg-teal text-teal-foreground hover:bg-teal/90">选择 Word 文档</Button>
          </CardContent>
        </Card>
      )}

      {/* Main content area */}
      {draftText && !enhancedReview && (
        <div className="space-y-4">
          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {!draftAnalysis && (
              <Button onClick={handleAnalyzeDraft} disabled={isWorking} className="bg-teal text-teal-foreground hover:bg-teal/90 h-8 text-xs">分析初稿</Button>
            )}
            {draftAnalysis && !gapAnalysis && (
              <>
                <Button onClick={handleSearchGaps} disabled={isWorking || selectedKeywords.size === 0} className="bg-teal text-teal-foreground hover:bg-teal/90 h-8 text-xs">
                  检索补充文献（{selectedKeywords.size} 个方向）
                </Button>
                <select value={journalLang} onChange={(e) => setJournalLang(e.target.value as "en" | "zh")} className="h-8 px-2 text-xs border border-input rounded bg-background">
                  <option value="en">英文期刊</option>
                  <option value="zh">中文期刊</option>
                </select>
              </>
            )}
            {gapAnalysis && !revisionPlan && (
              <Button onClick={handleGeneratePlan} disabled={isWorking || basket.filter(b => b.action === "add-paper").length === 0} className="bg-teal text-teal-foreground hover:bg-teal/90 h-8 text-xs">
                基于已选文献生成修改计划（{basket.filter(b => b.action === "add-paper").length} 篇）
              </Button>
            )}
            {basket.length > 0 && (
              <>
                <Button onClick={handleRewrite} disabled={isWorking} className="bg-teal text-teal-foreground hover:bg-teal/90 h-8 text-xs">
                  执行优化（{basket.length} 项）
                </Button>
                <div className="flex items-center gap-1 shrink-0">
                  <input type="number" value={wordCountMin} onChange={(e) => setWordCountMin(Number(e.target.value) || 5000)}
                    className="w-16 h-8 px-2 text-xs border border-input rounded bg-background text-center" min={2000} max={30000} step={1000} title="最少字数" />
                  <span className="text-xs text-muted-foreground">-</span>
                  <input type="number" value={wordCountMax} onChange={(e) => setWordCountMax(Number(e.target.value) || 15000)}
                    className="w-16 h-8 px-2 text-xs border border-input rounded bg-background text-center" min={3000} max={50000} step={1000} title="最多字数" />
                  <span className="text-xs text-muted-foreground">字</span>
                </div>
              </>
            )}
            <input type="file" accept=".docx" className="hidden" ref={fileRef} onChange={handleUploadDocx} />
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => fileRef.current?.click()}>重新上传初稿</Button>
          </div>

          {/* ═══ Revision Basket (sticky) ═══ */}
          {(revisionPlan || basket.length > 0) && (
            <Card className="border-teal/40 bg-teal/[0.03]">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between cursor-pointer" onClick={() => setBasketOpen(!basketOpen)}>
                  <CardTitle className="text-sm flex items-center gap-2">
                    🧺 修改篮
                    <Badge className="bg-teal text-white text-[10px]">{basket.length} 项</Badge>
                  </CardTitle>
                  <span className="text-xs text-muted-foreground">{basketOpen ? "收起" : "展开"}</span>
                </div>
              </CardHeader>
              {basketOpen && (
                <CardContent className="space-y-2 pt-0">
                  {basket.length === 0 ? (
                    <p className="text-xs text-muted-foreground">篮子为空，请从下方计划或对话中勾选修改项</p>
                  ) : (
                    <>
                      {basket.map((item) => (
                        <div key={item.id} className="flex items-start gap-2 p-2 rounded border border-teal/20 bg-white text-xs">
                          <button onClick={() => removeFromBasket(item.id)} className="text-destructive hover:text-destructive/80 shrink-0 mt-0.5" title="移除">✕</button>
                          <Badge className={`text-[9px] shrink-0 ${actionBadge[item.action]?.color ?? ""}`}>{actionBadge[item.action]?.label ?? item.action}</Badge>
                          <div className="min-w-0">
                            <span className="font-medium">{item.heading}</span>
                            <span className="text-muted-foreground ml-1">{item.description.slice(0, 80)}{item.description.length > 80 ? "..." : ""}</span>
                            {item.source === "chat" && <Badge variant="outline" className="text-[8px] ml-1">对话 R{item.round}</Badge>}
                          </div>
                        </div>
                      ))}
                      <Button size="sm" variant="ghost" className="text-xs h-6 text-destructive" onClick={() => setBasket([])}>清空篮子</Button>
                    </>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {/* Draft Analysis */}
          {draftAnalysis && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">初稿分析</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div><span className="font-medium text-teal">研究主题：</span>{draftAnalysis.topic}</div>
                <div>
                  <span className="font-medium text-teal">主要主题：</span>
                  <div className="flex flex-wrap gap-1 mt-1">{draftAnalysis.keyThemes.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>
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
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{draftAnalysis.weakSections.map((w, i) => <li key={i}>- {w}</li>)}</ul>
                  </div>
                )}
                <div className="text-xs text-muted-foreground">已引 {draftAnalysis.citedReferences.length} 篇 · 文献库匹配 {draftAnalysis.libraryMatchCount} 篇</div>
              </CardContent>
            </Card>
          )}

          {/* ═══ Keyword Selection (between analysis and search) ═══ */}
          {draftAnalysis && !gapAnalysis && (
            <Card className="border-blue-200 bg-blue-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">选择检索方向（勾选 AI 推荐方向，或添加自定义方向）</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* AI recommended keywords */}
                <div className="flex flex-wrap gap-2">
                  {draftAnalysis.keywords.map((kw) => {
                    const checked = selectedKeywords.has(kw);
                    return (
                      <div
                        key={kw}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs cursor-pointer transition-colors ${
                          checked
                            ? "border-teal bg-teal/10 text-teal"
                            : "border-border/50 text-muted-foreground hover:border-border"
                        }`}
                        onClick={() => {
                          setSelectedKeywords(prev => {
                            const next = new Set(prev);
                            if (next.has(kw)) next.delete(kw); else next.add(kw);
                            return next;
                          });
                        }}
                      >
                        <input type="checkbox" checked={checked} readOnly className="accent-teal w-3 h-3" />
                        {kw}
                      </div>
                    );
                  })}
                </div>
                {/* Custom keyword input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customKeyword}
                    onChange={(e) => setCustomKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customKeyword.trim()) {
                        setSelectedKeywords(prev => new Set([...prev, customKeyword.trim()]));
                        setCustomKeyword("");
                      }
                    }}
                    placeholder="输入自定义检索方向，回车添加..."
                    className="flex-1 h-8 px-3 text-xs border border-input rounded bg-background"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={!customKeyword.trim()}
                    onClick={() => {
                      if (customKeyword.trim()) {
                        setSelectedKeywords(prev => new Set([...prev, customKeyword.trim()]));
                        setCustomKeyword("");
                      }
                    }}
                  >
                    添加
                  </Button>
                </div>
                {/* Custom keywords (not from AI) */}
                {Array.from(selectedKeywords).filter(kw => !draftAnalysis.keywords.includes(kw)).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-muted-foreground">自定义：</span>
                    {Array.from(selectedKeywords).filter(kw => !draftAnalysis.keywords.includes(kw)).map(kw => (
                      <span key={kw} className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-blue-300 bg-blue-50 text-blue-700 text-[10px]">
                        {kw}
                        <button onClick={() => setSelectedKeywords(prev => { const n = new Set(prev); n.delete(kw); return n; })} className="text-blue-400 hover:text-blue-600">&times;</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <button onClick={() => setSelectedKeywords(new Set(draftAnalysis.keywords))} className="hover:text-foreground">全选推荐</button>
                  <span>·</span>
                  <button onClick={() => setSelectedKeywords(new Set())} className="hover:text-foreground">清空</button>
                  <span className="ml-auto">已选 {selectedKeywords.size} 个方向</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Gap Analysis */}
          {gapAnalysis && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  Gap 分析 · {gapAnalysis.newPapers.length} 篇推荐文献 · {gapAnalysis.topicGroups?.length ?? 0} 个话题
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {/* Coverage gaps */}
                {gapAnalysis.coverageGaps.length > 0 && (
                  <div>
                    <span className="font-medium text-amber-600">覆盖缺口：</span>
                    <div className="mt-1 space-y-1">{gapAnalysis.coverageGaps.map((g, i) => (
                      <div key={i} className="bg-amber-50 border border-amber-200 rounded p-2">
                        <span className={`text-xs font-medium ${severityColor[g.severity]}`}>[{g.severity}]</span>{" "}
                        <span className="text-xs font-medium">{g.theme}</span>
                        <p className="text-[10px] text-muted-foreground">{g.description}</p>
                      </div>
                    ))}</div>
                  </div>
                )}

                {/* Topic-grouped papers with checkboxes */}
                {(gapAnalysis.topicGroups ?? []).map((tg, ti) => (
                  <TopicGroupCard key={ti} group={tg} groupIndex={ti} basket={basket} onTogglePaper={(paper) => {
                    const item: BasketItem = {
                      id: `gap-${ti}-${paper.title.slice(0, 20)}`,
                      action: "add-paper",
                      heading: tg.topic,
                      description: `引入 ${paper.title} (${paper.year})`,
                      papersToAdd: [paper.title],
                      source: "plan",
                      round: 0,
                    };
                    toggleBasketItem(item);
                  }} isInBasket={(paper) => basket.some(b => b.papersToAdd?.includes(paper.title))} />
                ))}

                {/* Fallback: flat list if no topic groups */}
                {(!gapAnalysis.topicGroups || gapAnalysis.topicGroups.length === 0) && gapAnalysis.newPapers.length > 0 && (
                  <div>
                    <span className="font-medium text-teal">推荐补充文献（{gapAnalysis.newPapers.length}）：</span>
                    <div className="mt-1 space-y-1 max-h-[300px] overflow-y-auto">{gapAnalysis.newPapers.map((p, i) => (
                      <div key={i} className="bg-teal/5 border border-teal/20 rounded p-2">
                        <p className="text-xs font-medium">{p.title} ({p.year})</p>
                        <p className="text-[10px] text-muted-foreground">{p.authors} — {p.venue}</p>
                      </div>
                    ))}</div>
                  </div>
                )}

                {gapAnalysis.libraryUnused.length > 0 && (
                  <div>
                    <span className="font-medium text-blue-600">文献库未引用：</span>
                    <ul className="mt-1 text-xs text-muted-foreground">{gapAnalysis.libraryUnused.map((t, i) => <li key={i}>- {t}</li>)}</ul>
                  </div>
                )}

                {gapAnalysis.weakSections.length > 0 && (
                  <div>
                    <span className="font-medium text-amber-600">需改进章节：</span>
                    <div className="mt-1 space-y-1">{gapAnalysis.weakSections.map((w, i) => (
                      <div key={i} className="text-xs"><span className="font-medium">{w.heading}:</span> {w.issue} → <span className="text-teal">{w.suggestion}</span></div>
                    ))}</div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ═══ Revision Plan with Checkboxes ═══ */}
          {revisionPlan && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">修改计划（勾选添加到修改篮）</CardTitle>
                  <Badge variant="secondary" className="text-[10px]">{revisionPlan.estimatedChanges}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-xs text-muted-foreground">{revisionPlan.overallStrategy}</p>
                {revisionPlan.sections.map((s, i) => {
                  const itemId = `plan-${i}`;
                  const checked = isInBasket(itemId);
                  const item: BasketItem = {
                    id: itemId, action: s.action as BasketItem["action"], heading: s.heading,
                    description: s.description, papersToAdd: s.papersToAdd, source: "plan", round: 0,
                  };
                  return (
                    <div key={i} className={`flex items-start gap-2 p-2 rounded border transition-colors ${checked ? "border-teal/40 bg-teal/5" : "border-border/50"}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleBasketItem(item)}
                        className="accent-teal shrink-0 mt-1"
                      />
                      <Badge className={`text-[9px] shrink-0 ${actionBadge[s.action]?.color ?? ""}`}>{actionBadge[s.action]?.label ?? s.action}</Badge>
                      <div className="min-w-0">
                        <p className="text-xs font-medium">{s.heading}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{s.description}</p>
                        {s.papersToAdd.length > 0 && <p className="text-[10px] text-teal mt-0.5">引入: {s.papersToAdd.join("; ")}</p>}
                      </div>
                      <Badge variant="outline" className={`text-[9px] shrink-0 ${severityColor[s.priority]}`}>{s.priority}</Badge>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Draft preview */}
          <DraftPreview text={draftText} />
        </div>
      )}

      {/* ═══ Enhanced Review Result ═══ */}
      {enhancedReview && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-heading">{draftAnalysis?.topic ?? "优化后的文献综述"}</CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={handleExportWord}>导出 Word</Button>
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => navigator.clipboard.writeText(enhancedReview)}>复制全文</Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={handleReset}>重置</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none text-foreground leading-relaxed whitespace-pre-wrap">{enhancedReview}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═══ Chat with Suggestion Extraction ═══ */}
      {(draftAnalysis || enhancedReview) && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">AI 对话（建议会自动提取为可勾选修改项）</CardTitle>
              {chatMessages.length > 0 && (
                <button onClick={() => setChatMessages([])} className="text-xs text-muted-foreground hover:text-foreground">清空对话</button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Messages */}
            <div ref={chatScrollRef} className="max-h-[400px] overflow-y-auto space-y-3">
              {chatMessages.map((msg, i) => {
                // Strip <modified-review> tags from display, show clean explanation
                const displayContent = msg.content
                  .replace(/<modified-review>[\s\S]*?<\/modified-review>/g, "")
                  .trim();
                return (
                  <div key={i}>
                    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                        msg.role === "user" ? "bg-teal text-white" : "bg-muted"
                      }`}>
                        {displayContent || (msg.modifiedReview ? "已生成修改版本，点击下方按钮应用。" : msg.content)}
                      </div>
                    </div>
                    {/* Apply modified review button */}
                    {msg.modifiedReview && (
                      <div className="mt-2 ml-2 flex items-center gap-2">
                        <Button
                          size="sm"
                          className="bg-teal text-teal-foreground hover:bg-teal/90 h-7 text-xs"
                          onClick={() => {
                            setEnhancedReview(msg.modifiedReview!);
                            setStatusMsg("已应用修改");
                            setTimeout(() => setStatusMsg(""), 2000);
                          }}
                        >
                          应用修改到综述
                        </Button>
                        <span className="text-[10px] text-muted-foreground">
                          修改版 {msg.modifiedReview.length.toLocaleString()} 字
                        </span>
                      </div>
                    )}
                    {/* Extracted suggestions with checkboxes */}
                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="mt-2 ml-2 space-y-1">
                        <p className="text-[10px] text-teal font-medium">提取的修改建议（勾选添加到修改篮）：</p>
                        {msg.suggestions.map((s) => {
                          const checked = isInBasket(s.id);
                          return (
                            <div key={s.id} className={`flex items-start gap-2 p-1.5 rounded border text-xs transition-colors ${checked ? "border-teal/40 bg-teal/5" : "border-border/30"}`}>
                              <input type="checkbox" checked={checked} onChange={() => toggleBasketItem(s)} className="accent-teal shrink-0 mt-0.5" />
                              <Badge className={`text-[8px] shrink-0 ${actionBadge[s.action]?.color ?? ""}`}>{actionBadge[s.action]?.label ?? s.action}</Badge>
                              <span><span className="font-medium">{s.heading}</span>: {s.description}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
                placeholder={enhancedReview ? "直接输入修改指令，如「删掉8.2节」「把第3段改短」「补充一段关于跨文化的讨论」..." : "输入修改意见，AI 会生成可勾选的修改建议..."}
                className="flex-1 min-h-[40px] max-h-[120px] resize-y text-xs p-2 border border-input rounded bg-background"
                disabled={chatStreaming}
              />
              <Button onClick={handleChatSend} disabled={chatStreaming || !chatInput.trim()} className="bg-teal text-teal-foreground hover:bg-teal/90 h-10 px-4 text-xs shrink-0">
                {chatStreaming ? "..." : "发送"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────

const rankingBadgeColors: Record<string, string> = {
  UTD24: "bg-red-600 text-white", FT50: "bg-amber-500 text-white",
  SSCI: "bg-blue-600 text-white", SCI: "bg-cyan-600 text-white",
  "ABS 4*": "bg-purple-700 text-white", "ABS 4": "bg-purple-600 text-white", "ABS 3": "bg-purple-500 text-white",
  "JCR Q1": "bg-emerald-600 text-white", "JCR Q2": "bg-emerald-400 text-white",
  arXiv: "bg-orange-100 text-orange-800",
};

function PaperBadges({ paper }: { paper: TopicGroup["papers"][0] }) {
  const badges: string[] = [];
  const r = paper.journalRanking;
  const m = paper.journalMeta;
  if (r?.utd24) badges.push("UTD24");
  if (r?.ft50) badges.push("FT50");
  if (m?.absRating) badges.push(`ABS ${m.absRating}`);
  if (m?.jcrQuartile) badges.push(`JCR ${m.jcrQuartile}`);
  if (m?.ssci) badges.push("SSCI");
  if (m?.sci) badges.push("SCI");
  if (r?.badges) {
    for (const b of r.badges) {
      if (!badges.includes(b)) badges.push(b);
    }
  }
  // Venue-based Nature/Science detection
  const v = (paper.venue ?? "").toLowerCase();
  if (v.includes("nature") && !badges.some(b => b.includes("Nature"))) badges.push("Nature");
  if ((v.startsWith("science") || v.includes("science ")) && !v.includes("computer") && !badges.some(b => b.includes("Science"))) badges.push("Science");
  if (v.includes("arxiv") && !badges.includes("arXiv")) badges.push("arXiv");

  if (badges.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-0.5">
      {badges.map(b => (
        <span key={b} className={`px-1 py-0 rounded text-[8px] font-medium ${rankingBadgeColors[b] ?? "bg-gray-100 text-gray-700"}`}>{b}</span>
      ))}
    </span>
  );
}

function TopicGroupCard({ group, groupIndex, basket, onTogglePaper, isInBasket }: {
  group: TopicGroup;
  groupIndex: number;
  basket: BasketItem[];
  onTogglePaper: (paper: TopicGroup["papers"][0]) => void;
  isInBasket: (paper: TopicGroup["papers"][0]) => boolean;
}) {
  const [open, setOpen] = useState(true);
  const checkedCount = group.papers.filter(p => isInBasket(p)).length;

  return (
    <div className="border border-teal/20 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-teal/5 cursor-pointer hover:bg-teal/10 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[10px]">{open ? "\u25BC" : "\u25B6"}</span>
        <span className="text-xs font-medium text-teal">{group.topic}</span>
        <Badge variant="secondary" className="text-[9px]">{group.papers.length} 篇</Badge>
        {checkedCount > 0 && <Badge className="bg-teal text-white text-[9px]">{checkedCount} 已选</Badge>}
        <span className="text-[10px] text-muted-foreground ml-auto">{group.description}</span>
      </div>
      {open && (
        <div className="p-2 space-y-1.5">
          {group.papers.map((p, pi) => {
            const checked = isInBasket(p);
            return (
              <div key={pi} className={`flex items-start gap-2 p-2.5 rounded border text-xs transition-colors ${checked ? "border-teal/40 bg-teal/5" : "border-border/30 hover:border-border"}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onTogglePaper(p)}
                  className="accent-teal shrink-0 mt-1"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  {/* Title + year */}
                  <p className="font-medium leading-snug text-teal">{p.title}</p>
                  {/* Authors + venue + badges */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-muted-foreground">{p.authors}</span>
                    <span className="text-[10px] text-muted-foreground">({p.year})</span>
                    <span className="text-[10px] text-muted-foreground">— {p.venue}</span>
                    <PaperBadges paper={p} />
                    {(p.citationCount ?? 0) > 0 && (
                      <span className="text-[9px] text-muted-foreground border border-border/50 rounded px-1">
                        引用 {p.citationCount}
                      </span>
                    )}
                    {p.relevanceScore != null && (
                      <span className={`text-[9px] px-1 rounded ${p.relevanceScore >= 7 ? "bg-teal/10 text-teal" : "bg-muted text-muted-foreground"}`}>
                        相关 {p.relevanceScore.toFixed(1)}
                      </span>
                    )}
                    {p.journalMeta?.impactFactor && (
                      <span className="text-[9px] text-muted-foreground border border-border/50 rounded px-1">
                        IF {p.journalMeta.impactFactor.toFixed(1)}
                      </span>
                    )}
                  </div>
                  {/* AI Analysis */}
                  {p.aiAnalysis && (
                    <div className="text-[10px] text-foreground/80 bg-muted/40 border border-border/20 rounded px-2.5 py-1.5 leading-relaxed">
                      {p.aiAnalysis}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DraftPreview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
        {open ? "收起" : "展开"}综述初稿预览 ({text.length.toLocaleString()} 字)
      </summary>
      <div className="mt-2 border border-border/50 rounded-lg p-4 bg-muted/20 max-h-[400px] overflow-y-auto">
        <pre className="text-xs leading-relaxed whitespace-pre-wrap font-[family-name:var(--font-sans)] text-foreground/80">{text}</pre>
      </div>
    </details>
  );
}
