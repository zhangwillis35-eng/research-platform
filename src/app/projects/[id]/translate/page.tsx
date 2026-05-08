"use client";

import { useState, useRef, useCallback, useEffect } from "react";
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
import { useThrottledStream } from "@/hooks/use-throttled-stream";

type Phase =
  | "idle"
  | "uploading"
  | "translating"
  | "extracting-terms"
  | "analyzing"
  | "done";

type ActiveTab = "translation" | "terms" | "analysis" | "figures";

interface ExtractedFigure {
  label: string;
  page: number;
  width: number;
  height: number;
  base64: string;
}

// ─── pdf.js helpers (client-side text extraction) ──────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensurePdfJs(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lib: any = (window as any).pdfjsLib;
  if (!lib) {
    await new Promise<void>((resolve) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
    lib = (window as any).pdfjsLib;
  }
  if (lib?.GlobalWorkerOptions) {
    lib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  return lib;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extractTextFromPdf(file: File, pdfjsLib: any): Promise<string> {
  if (!pdfjsLib) return "";
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pages.push(content.items.map((item: any) => item.str).join(" "));
    }
    return pages.join("\n\n");
  } catch {
    return "";
  }
}

function extractTitle(fullText: string, fileName: string): string {
  const lines = fullText.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 20)) {
    if (line.length >= 15 && line.length <= 250 && !/^[\d\s.]+$/.test(line) && !line.startsWith("http")) {
      return line;
    }
  }
  return fileName.replace(/\.pdf$/i, "");
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function TranslatePage() {
  const params = useParams();
  const projectId = params.id as string;
  const NS = `translate-${projectId}`;

  const [provider, setProvider] = usePersistedState<AIProvider>(NS, "provider", "deepseek-fast");
  const [phase, setPhase] = usePersistedState<Phase>(NS, "phase", "idle");
  const [translatedText, setTranslatedText] = usePersistedState<string>(NS, "translated", "");
  const [terms, setTerms] = usePersistedState<AcademicTerm[]>(NS, "terms", []);
  const [analysis, setAnalysis] = usePersistedState<PaperAnalysis | null>(NS, "analysis", null);
  const [paperTitle, setPaperTitle] = usePersistedState<string>(NS, "title", "");
  const [paperFileName, setPaperFileName] = usePersistedState<string>(NS, "fileName", "");
  const [paperCharCount, setPaperCharCount] = usePersistedState<number>(NS, "charCount", 0);
  const [figures, setFigures] = useState<ExtractedFigure[]>([]);
  const [figuresLoading, setFiguresLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("translation");
  const [progress, setProgress] = useState({
    current: 0,       // sections completed
    total: 0,         // total sections
    heading: "",       // current section heading
    inputChars: 0,     // total input chars
    processedChars: 0, // input chars processed so far
    outputChars: 0,    // translated chars so far
    startTime: 0,      // timestamp when translation started
  });
  const [exporting, setExporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const { getSignal, abort, reset } = useAbort();
  const stream = useThrottledStream(setTranslatedText);
  const paperTextRef = useRef(""); // full text from uploaded PDF
  const pdfBytesRef = useRef<ArrayBuffer | null>(null); // raw PDF for image extraction
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [elapsed, setElapsed] = useState(0);

  // Timer: update outputChars + elapsed every second while translating
  useEffect(() => {
    if (phase !== "translating") return;
    const id = setInterval(() => {
      setProgress(p => ({ ...p, outputChars: stream.getText().length }));
      setElapsed(progress.startTime > 0 ? Math.round((Date.now() - progress.startTime) / 1000) : 0);
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleStop = useCallback(() => {
    abort();
    setPhase("done");
  }, [abort]);

  // ─── PDF upload & text extraction ──────────────────────────────────────

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) return;

    setPhase("uploading");
    setTranslatedText("");
    setTerms([]);
    setAnalysis(null);
    setFigures([]);
    stream.reset();

    try {
      const pdfjsLib = await ensurePdfJs();
      const [text, arrayBuffer] = await Promise.all([
        extractTextFromPdf(file, pdfjsLib),
        file.arrayBuffer(),
      ]);

      if (!text || text.trim().length < 100) {
        alert("无法提取文本，可能是扫描版 PDF 或加密文档。");
        setPhase("idle");
        return;
      }

      paperTextRef.current = text;
      pdfBytesRef.current = arrayBuffer;
      const title = extractTitle(text, file.name);
      setPaperTitle(title);
      setPaperFileName(file.name);
      setPaperCharCount(text.length);
      setPhase("idle");
    } catch (err) {
      console.error("[translate] PDF extraction error:", err);
      setPhase("idle");
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  // ─── Translation ──────────────────────────────────────────────────────

  async function handleTranslate() {
    if (!paperTextRef.current) return;
    reset();
    setPhase("translating");
    setTranslatedText("");
    setTerms([]);
    setAnalysis(null);
    setFigures([]);
    stream.reset();
    setProgress({ current: 0, total: 0, heading: "", inputChars: 0, processedChars: 0, outputChars: 0, startTime: Date.now() });
    setActiveTab("translation");

    try {
      const res = await fetch("/api/research/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "translate",
          text: paperTextRef.current,
          title: paperTitle,
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
            if (event.phase === "meta") {
              setProgress(p => ({ ...p, inputChars: event.inputChars, total: event.chunkCount }));
            } else if (event.phase === "section-start") {
              setProgress(p => ({
                ...p,
                current: event.index,
                total: event.total,
                heading: event.heading,
              }));
              if (event.heading) {
                stream.append(`\n\n${event.heading}\n\n`);
              }
            } else if (event.phase === "chunk") {
              stream.append(event.text);
            } else if (event.phase === "section-done") {
              setProgress(p => ({
                ...p,
                current: event.index + 1,
                processedChars: event.inputCharsProcessed,
                outputChars: stream.getText().length,
              }));
            } else if (event.phase === "done") {
              stream.flush();
              startBackgroundTasks(paperTitle, paperTextRef.current, stream.getText());
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

  // ─── Background tasks (terms + analysis + image extraction) ────────────

  async function startBackgroundTasks(title: string, paperText: string, _finalText: string) {
    // Extract PDF images in parallel (send raw PDF bytes to server)
    if (pdfBytesRef.current) {
      setFiguresLoading(true);
      const formData = new FormData();
      formData.append("pdf", new Blob([pdfBytesRef.current], { type: "application/pdf" }), "paper.pdf");
      fetch("/api/research/translate/images", {
        method: "POST",
        body: formData,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.images) setFigures(d.images);
        })
        .catch(() => {})
        .finally(() => setFiguresLoading(false));
    }

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

  // ─── Word export ──────────────────────────────────────────────────────

  async function handleExport() {
    if (!translatedText) return;
    setExporting(true);
    try {
      const firstLine = translatedText.split("\n").find((l) => l.trim().length > 5) ?? paperTitle;
      const translatedTitle = firstLine.replace(/^#+\s*/, "").trim().slice(0, 120);

      const figureImages = figures.map((f) => ({
        label: f.label,
        caption: `来源：原文第 ${f.page} 页`,
        imageData: Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)),
        width: Math.min(f.width, 500),
        height: Math.min(f.height, Math.round((500 / f.width) * f.height)),
      }));

      const blob = await generateTranslationDocx({
        originalTitle: paperTitle,
        translatedTitle,
        translatedText,
        terms,
        analysis,
        figures: figureImages,
      });
      const filename = `[译文] ${(paperTitle || paperFileName).slice(0, 40)}.docx`;
      downloadBlob(blob, filename);
    } catch (err) {
      console.error("[export]", err);
    } finally {
      setExporting(false);
    }
  }

  const isRunning = phase === "translating" || phase === "extracting-terms" || phase === "analyzing";
  const hasUploadedPdf = !!paperTextRef.current || paperCharCount > 0;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">文献翻译</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            上传英文 PDF → 中文翻译，含关键词核验与论文分析
          </p>
        </div>
        <AIProviderSelect value={provider} onChange={setProvider} />
      </div>

      {/* PDF upload area */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">上传 PDF</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasUploadedPdf ? (
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              } ${phase === "uploading" ? "opacity-60 pointer-events-none" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className="text-3xl mb-2 opacity-40">
                {phase === "uploading" ? "⏳" : "📄"}
              </div>
              <p className="text-sm text-muted-foreground">
                {phase === "uploading"
                  ? "正在提取文本..."
                  : "点击上传或拖拽 PDF 文件到此处"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                支持英文学术论文 PDF（需包含可复制文本）
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 p-3 bg-muted/30 rounded-lg">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{paperTitle}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {paperFileName} · {Math.round(paperCharCount / 1000)}k 字符
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-xs"
                onClick={() => {
                  paperTextRef.current = "";
                  pdfBytesRef.current = null;
                  setPaperTitle("");
                  setPaperFileName("");
                  setPaperCharCount(0);
                  setPhase("idle");
                  setTranslatedText("");
                  setTerms([]);
                  setAnalysis(null);
                  setFigures([]);
                }}
                disabled={isRunning}
              >
                更换文件
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleTranslate}
          disabled={!hasUploadedPdf || isRunning}
          size="sm"
        >
          {phase === "idle" || phase === "uploading"
            ? "开始翻译"
            : phase === "done"
            ? "重新翻译"
            : "翻译中..."}
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
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4 pb-3 space-y-3">
            {phase === "translating" && (() => {
              // Progress % based on output chars (EN→ZH ratio ~0.7)
              const expectedOutput = (progress.inputChars || paperCharCount) * 0.7;
              const pct = expectedOutput > 0
                ? Math.min(99, Math.round((progress.outputChars / expectedOutput) * 100))
                : 0;
              return (
                <>
                  {/* Main progress bar */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">
                        翻译中 · 第 {Math.min(progress.current + 1, progress.total)}/{progress.total || "?"} 段
                        {progress.heading ? ` — ${progress.heading}` : ""}
                      </span>
                      <span className="tabular-nums text-muted-foreground font-medium">
                        {pct}%
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${Math.max(1, pct)}%` }}
                      />
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground tabular-nums">
                    <span>原文 {(Math.round((progress.inputChars || paperCharCount) / 100) / 10).toFixed(1)}k 字符</span>
                    <span>已翻译 {(Math.round(progress.outputChars / 100) / 10).toFixed(1)}k 字符</span>
                    <span>耗时 {elapsed}s</span>
                  </div>

                  {/* Section dots */}
                  {progress.total > 1 && (
                    <div className="flex gap-1 flex-wrap">
                      {Array.from({ length: progress.total }, (_, i) => (
                        <div
                          key={i}
                          className={`h-1.5 rounded-full transition-colors ${
                            progress.total > 20 ? "w-2" : "w-4"
                          } ${
                            i < progress.current
                              ? "bg-primary"
                              : i === progress.current
                              ? "bg-primary/60 animate-pulse"
                              : "bg-muted-foreground/20"
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
            {phase === "extracting-terms" && (
              <div className="flex items-center gap-2 text-sm">
                <span className="animate-pulse text-primary">●</span>
                正在提取并核验关键术语...
              </div>
            )}
            {phase === "analyzing" && (
              <div className="flex items-center gap-2 text-sm">
                <span className="animate-pulse text-primary">●</span>
                正在分析论文...
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Results tabs */}
      {(translatedText || terms.length > 0 || analysis || figures.length > 0) && (
        <div className="space-y-4">
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-border">
            {(
              [
                { key: "translation", label: "译文", show: !!translatedText },
                { key: "terms", label: `关键词 ${terms.length > 0 ? `(${terms.length})` : ""}`, show: true },
                { key: "figures", label: `图表 ${figures.length > 0 ? `(${figures.length})` : figuresLoading ? "..." : ""}`, show: true },
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
                <div className="text-sm leading-relaxed space-y-2">
                  {translatedText.split("\n").map((line, idx) => {
                    const trimmed = line.trim();
                    if (!trimmed) return <div key={idx} className="h-2" />;
                    // Section heading: "1. 引言" or "## Heading"
                    if (/^\d+\.\s/.test(trimmed) && trimmed.length < 80) {
                      return (
                        <p key={idx} className="font-bold text-base mt-4 mb-1 text-foreground">
                          {trimmed}
                        </p>
                      );
                    }
                    if (/^#{1,3}\s/.test(trimmed)) {
                      return (
                        <p key={idx} className="font-bold text-base mt-4 mb-1 text-foreground">
                          {trimmed.replace(/^#+\s*/, "")}
                        </p>
                      );
                    }
                    // Figure/table placeholder
                    if (/^\[图|^\[表/.test(trimmed)) {
                      return (
                        <p key={idx} className="text-center italic text-muted-foreground my-3">
                          {trimmed}
                        </p>
                      );
                    }
                    // Normal paragraph
                    return (
                      <p key={idx} className="text-foreground/90 indent-8">
                        {trimmed}
                      </p>
                    );
                  })}
                  {phase === "translating" && (
                    <span className="inline-block w-2 h-4 ml-0.5 bg-primary/70 animate-pulse align-middle" />
                  )}
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

          {/* Figures tab */}
          {activeTab === "figures" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  提取的图表
                  {figuresLoading && (
                    <span className="ml-2 text-muted-foreground animate-pulse text-xs">提取中...</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {figures.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {figuresLoading
                      ? "正在从 PDF 中提取图表..."
                      : "未提取到图表（翻译完成后自动提取）"}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {figures.map((fig, i) => (
                      <div key={i} className="border border-border rounded-md overflow-hidden">
                        <div className="bg-muted/30 px-3 py-1.5 border-b border-border flex items-center justify-between">
                          <span className="text-xs font-medium">{fig.label}</span>
                          <span className="text-[10px] text-muted-foreground">
                            第 {fig.page} 页 · {fig.width}×{fig.height}
                          </span>
                        </div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`data:image/png;base64,${fig.base64}`}
                          alt={fig.label}
                          className="w-full h-auto"
                          loading="lazy"
                        />
                      </div>
                    ))}
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
