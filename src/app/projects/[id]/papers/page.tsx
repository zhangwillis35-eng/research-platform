"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AIProviderSelect,
  type AIProvider,
} from "@/components/ai-provider-select";
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";
import Link from "next/link";

interface Paper {
  id: string;
  title: string;
  abstract?: string | null;
  aiAnalysis?: string | null;
  authors: { name: string }[];
  year?: number;
  venue?: string;
  citationCount: number;
  doi?: string;
  isSelected: boolean;
  source: string;
  folder?: string | null;
  fullText?: string | null;
  pdfFileName?: string | null;
}

export default function PapersPage() {
  const params = useParams();
  const projectId = params.id as string;
  const NS = `papers-${projectId}`;
  const [papers, setPapers] = usePersistedState<Paper[]>(NS, "papers", []);
  const [activeTab, setActiveTab] = usePersistedState<"catalog" | "weekly">(NS, "activeTab", "catalog");
  const [aiProvider, setAiProvider] = usePersistedState<AIProvider>(NS, "aiProvider", "deepseek-fast");
  const [overview, setOverview] = usePersistedState<string | null>(NS, "overview", null);
  const [overviewOpen, setOverviewOpen] = usePersistedState<boolean>(NS, "overviewOpen", false);

  // Transient state
  const [loading, setLoading] = useState(true);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestResult, setDigestResult] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // PDF upload state
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [attachTarget, setAttachTarget] = useState<string | null>(null);

  // Full text viewer state
  const [fullTextPaper, setFullTextPaper] = useState<Paper | null>(null);

  // Abort controllers
  const digestAbort = useAbort();
  const overviewAbort = useAbort();

  useEffect(() => {
    fetch(`/api/papers?projectId=${projectId}`)
      .then((r) => r.json())
      .then((data) => setPapers(data.papers ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  async function toggleSelected(paperId: string, current: boolean) {
    await fetch(`/api/papers/${paperId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isSelected: !current }),
    });
    setPapers((prev) =>
      prev.map((p) => (p.id === paperId ? { ...p, isSelected: !current } : p))
    );
  }

  async function deletePaper(paperId: string) {
    await fetch(`/api/papers/${paperId}`, { method: "DELETE" });
    setPapers((prev) => prev.filter((p) => p.id !== paperId));
  }

  async function runWeeklyDigest() {
    setDigestLoading(true);
    setDigestResult(null);
    const signal = digestAbort.reset();
    try {
      const res = await fetch("/api/research/weekly-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, daysBack: 30 }),
        signal,
      });
      const data = await res.json();
      if (data.saved > 0) {
        setDigestResult(`已收录 ${data.saved} 篇文献，正在 AI 分析中...`);
        setActiveTab("weekly");
        const papersRes = await fetch(`/api/papers?projectId=${projectId}`, { signal });
        const papersData = await papersRes.json();
        setPapers(papersData.papers ?? []);

        const ids: string[] = data.savedIds ?? [];
        if (ids.length > 0) {
          const r = await fetch("/api/papers/batch-analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paperIds: ids, provider: "deepseek-fast" }),
            signal,
          });

          if (r.body) {
            const reader = r.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let lastRefresh = 0;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                try {
                  const evt = JSON.parse(line.slice(6));
                  if (evt.type === "progress") {
                    setDigestResult(
                      `AI 深度分析: ${evt.completed}/${evt.total} 篇` +
                      (evt.hasFullText ? " [全文]" : "") +
                      (evt.status === "error" ? ` (${evt.completed - 1} 成功)` : "")
                    );
                    if (evt.completed - lastRefresh >= 10 || evt.completed === evt.total) {
                      lastRefresh = evt.completed;
                      const updated = await fetch(`/api/papers?projectId=${projectId}`, { signal });
                      const updatedData = await updated.json();
                      setPapers(updatedData.papers ?? []);
                    }
                  } else if (evt.type === "done") {
                    setDigestResult(
                      `已收录 ${data.saved} 篇文献，${evt.analyzed} 篇完成 AI 分析` +
                      (evt.withFullText > 0 ? `（${evt.withFullText} 篇基于全文）` : "") +
                      (evt.failed > 0 ? `（${evt.failed} 篇失败）` : "")
                    );
                  } else if (evt.type === "status") {
                    setDigestResult(evt.message);
                  }
                } catch { /* skip */ }
              }
            }

            const final = await fetch(`/api/papers?projectId=${projectId}`, { signal });
            const finalData = await final.json();
            setPapers(finalData.papers ?? []);
          }
        } else {
          setDigestResult(`已收录 ${data.saved} 篇文献`);
        }
      } else {
        setDigestResult("本周暂无符合条件的新文献");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setDigestResult("已停止");
        setDigestLoading(false);
        return;
      }
      setDigestResult("获取失败，请重试");
    } finally {
      setDigestLoading(false);
    }
  }

  async function generateOverview() {
    if (displayPapers.length === 0) return;
    setOverviewLoading(true);
    setOverview(null);
    setOverviewOpen(true);
    const signal = overviewAbort.reset();
    try {
      const papersForAI = displayPapers.slice(0, 50).map((p) => ({
        title: p.title,
        authors: p.authors?.map((a) => a.name) ?? [],
        year: p.year,
        venue: p.venue,
        abstract: p.abstract,
        citationCount: p.citationCount,
      }));
      const res = await fetch("/api/papers/overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: activeTab === "weekly" ? "AI 前沿周刊" : "文献目录", papers: papersForAI, provider: aiProvider }),
        signal,
      });
      const data = await res.json();
      setOverview(data.overview ?? "分析生成失败");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setOverview("已停止");
        setOverviewLoading(false);
        return;
      }
      setOverview("分析请求失败，请重试");
    } finally {
      setOverviewLoading(false);
    }
  }

  // Upload new PDFs (creates new paper entries)
  async function handleUploadPDF(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadResult(null);
    let uploaded = 0;

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("projectId", projectId);

        const res = await fetch("/api/papers/upload", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          uploaded++;
        } else {
          const err = await res.json();
          setUploadResult(`${file.name}: ${err.error}`);
        }
      } catch {
        setUploadResult(`${file.name}: 上传失败`);
      }
    }

    const res = await fetch(`/api/papers?projectId=${projectId}`);
    const data = await res.json();
    setPapers(data.papers ?? []);
    setUploadResult(`成功上传 ${uploaded} 篇文献`);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Attach PDF to an existing paper
  async function handleAttachPDF(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !attachTarget) return;

    const file = files[0];
    setUploading(true);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      formData.append("paperId", attachTarget);

      const res = await fetch("/api/papers/upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        setUploadResult(`PDF 已关联到文献`);
        const reload = await fetch(`/api/papers?projectId=${projectId}`);
        const data = await reload.json();
        setPapers(data.papers ?? []);
      } else {
        const err = await res.json();
        setUploadResult(err.error);
      }
    } catch {
      setUploadResult("上传失败");
    } finally {
      setUploading(false);
      setAttachTarget(null);
      if (attachInputRef.current) attachInputRef.current.value = "";
    }
  }

  // Zotero import
  const [zoteroLoading, setZoteroLoading] = useState(false);

  async function handleZoteroImport() {
    const apiKey = localStorage.getItem("zotero_api_key");
    const userId = localStorage.getItem("zotero_user_id");
    if (!apiKey || !userId) {
      setUploadResult("请先在「设置」中配置 Zotero API Key 和 User ID");
      return;
    }

    setZoteroLoading(true);
    setUploadResult(null);
    try {
      const res = await fetch("/api/integrations/zotero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          apiKey,
          userId,
          projectId,
          downloadPDFs: true,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setUploadResult(`Zotero 导入失败: ${data.error}`);
      } else {
        setUploadResult(`从 Zotero 导入 ${data.imported} 篇文献（${data.withPDF} 篇含 PDF），跳过 ${data.skipped} 篇重复`);
        // Reload papers
        const reload = await fetch(`/api/papers?projectId=${projectId}`);
        const reloadData = await reload.json();
        setPapers(reloadData.papers ?? []);
      }
    } catch {
      setUploadResult("Zotero 导入失败");
    } finally {
      setZoteroLoading(false);
    }
  }

  async function handleZoteroExport() {
    const apiKey = localStorage.getItem("zotero_api_key");
    const userId = localStorage.getItem("zotero_user_id");
    if (!apiKey || !userId) {
      setUploadResult("请先在「设置」中配置 Zotero API Key 和 User ID");
      return;
    }

    const toExport = catalogPapers.length > 0 ? catalogPapers : papers;
    if (toExport.length === 0) return;

    setZoteroLoading(true);
    setUploadResult(null);
    try {
      const res = await fetch("/api/integrations/zotero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch-add",
          apiKey,
          userId,
          papers: toExport.map((p) => ({
            title: p.title,
            authors: p.authors,
            year: p.year,
            venue: p.venue,
            doi: p.doi,
            abstract: p.abstract,
          })),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setUploadResult(`Zotero 导出失败: ${data.error}`);
      } else {
        setUploadResult(`成功导出 ${data.success} 篇到 Zotero${data.failed > 0 ? `，${data.failed} 篇失败` : ""}`);
      }
    } catch {
      setUploadResult("Zotero 导出失败");
    } finally {
      setZoteroLoading(false);
    }
  }

  // Split papers into catalog (search/upload) vs weekly digest
  const weeklyPapers = papers.filter((p) => p.folder?.includes("AI 前沿"));
  const catalogPapers = papers.filter((p) => !p.folder?.includes("AI 前沿"));
  const displayPapers = activeTab === "weekly" ? weeklyPapers : catalogPapers;
  const uploadedCount = papers.filter((p) => p.fullText).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">
            文献库
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {papers.length} 篇文献 · {uploadedCount} 篇已上传原文
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={runWeeklyDigest}
            disabled={digestLoading}
          >
            {digestLoading ? "收录 & 分析中..." : "获取本周 AI 前沿"}
          </Button>
          <StopButton show={digestLoading} onClick={digestAbort.abort} />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            onChange={handleUploadPDF}
          />
          <input
            ref={attachInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleAttachPDF}
          />
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "上传中..." : "上传 PDF"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={handleZoteroImport}
            disabled={zoteroLoading}
          >
            {zoteroLoading ? "处理中..." : "从 Zotero 导入"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={handleZoteroExport}
            disabled={zoteroLoading || papers.length === 0}
          >
            导出到 Zotero
          </Button>
          <Link href={`/projects/${projectId}/papers/search`}>
            <Button className="bg-teal text-teal-foreground hover:bg-teal/90 h-8 text-xs">
              + 检索文献
            </Button>
          </Link>
        </div>
      </div>

      {/* Status messages */}
      {(digestResult || uploadResult) && (
        <div className="px-3 py-2 bg-teal/5 border border-teal/20 rounded-lg text-xs text-teal">
          {digestResult || uploadResult}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/50">
        <button
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === "catalog" ? "border-teal text-teal" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => { setActiveTab("catalog"); setFullTextPaper(null); }}
        >
          文献目录（{catalogPapers.length}）
        </button>
        <button
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === "weekly" ? "border-teal text-teal" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => { setActiveTab("weekly"); setFullTextPaper(null); }}
        >
          AI 前沿周刊（{weeklyPapers.length}）
        </button>
      </div>

      {/* AI Overview toolbar */}
      {displayPapers.length > 0 && (
        <div className="flex items-center gap-2">
          <AIProviderSelect value={aiProvider} onChange={setAiProvider} />
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={generateOverview}
            disabled={overviewLoading}
          >
            {overviewLoading ? "分析中..." : "AI 综合分析"}
          </Button>
          <StopButton show={overviewLoading} onClick={overviewAbort.abort} />
          {overview && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setOverviewOpen(!overviewOpen)}
            >
              {overviewOpen ? "收起分析" : "展开分析"}
            </button>
          )}
        </div>
      )}

      {/* AI Overview panel */}
      {overviewOpen && (
        <div className="border border-teal/20 rounded-lg bg-teal/5 p-4">
          {overviewLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-block w-4 h-4 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
              正在分析 {papers.length} 篇文献...
            </div>
          ) : overview ? (
            <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap leading-relaxed">
              {overview}
            </div>
          ) : null}
        </div>
      )}

      {/* Full text reader view */}
      {fullTextPaper ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-teal">{fullTextPaper.title}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {fullTextPaper.pdfFileName} · {(fullTextPaper.fullText?.length ?? 0).toLocaleString()} 字符
              </p>
            </div>
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setFullTextPaper(null)}>
              返回列表
            </Button>
          </div>
          <div className="border border-border/50 rounded-lg p-4 bg-muted/20 max-h-[70vh] overflow-y-auto">
            <pre className="text-xs leading-relaxed whitespace-pre-wrap font-[family-name:var(--font-sans)] text-foreground/80">
              {fullTextPaper.fullText}
            </pre>
          </div>
        </div>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : displayPapers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">
            {activeTab === "weekly"
              ? "暂无 AI 前沿文献，点击「获取本周 AI 前沿」自动收录"
              : "暂无文献，前往「文献检索」搜索并添加文献，或「上传 PDF」添加本地文献"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayPapers.map((p) => (
            <PaperRow
              key={p.id}
              paper={p}
              onToggle={() => toggleSelected(p.id, p.isSelected)}
              onDelete={() => deletePaper(p.id)}
              onViewFullText={p.fullText ? () => setFullTextPaper(p) : undefined}
              onAttachPDF={() => {
                setAttachTarget(p.id);
                attachInputRef.current?.click();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface StructuredAnalysis {
  tags?: string[];
  model?: string;
  variables?: string;
  method?: string;
  contribution?: string;
}

function parseAnalysis(raw?: string | null): StructuredAnalysis | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { contribution: raw };
  }
}

function PaperRow({
  paper,
  onToggle,
  onDelete,
  onViewFullText,
  onAttachPDF,
}: {
  paper: Paper;
  onToggle: () => void;
  onDelete: () => void;
  onViewFullText?: () => void;
  onAttachPDF: () => void;
}) {
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [abstractOpen, setAbstractOpen] = useState(false);
  const analysis = parseAnalysis(paper.aiAnalysis);
  const hasUploaded = !!paper.fullText;

  return (
    <div className="border border-border/50 rounded-lg hover:border-border transition-colors">
      <div className="flex items-start gap-3 p-3">
        <input
          type="checkbox"
          checked={paper.isSelected}
          onChange={onToggle}
          className="accent-teal shrink-0 mt-1"
          title="标记为核心文献"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <p className="text-sm font-medium text-teal leading-snug">
              {paper.title}
            </p>
            <a
              href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-muted-foreground hover:text-foreground border border-border/50 rounded px-1.5 py-0.5 shrink-0"
              title="大陆需代理访问"
            >
              Scholar ⚠
            </a>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {paper.authors?.slice(0, 3).map((a) => a.name).join(", ")}
            {(paper.authors?.length ?? 0) > 3 ? " et al." : ""}
            {paper.year ? ` (${paper.year})` : ""}
            {paper.venue ? ` — ${paper.venue}` : ""}
          </p>

          {/* AI Analysis */}
          {analysis && (
            <div className="mt-2">
              <button
                className="text-xs font-medium text-teal flex items-center gap-1"
                onClick={() => setAnalysisOpen(!analysisOpen)}
              >
                <span className="text-[10px]">{analysisOpen ? "\u25BC" : "\u25B6"}</span>
                AI 分析
                {analysis.tags && analysis.tags.length > 0 && (
                  <span className="flex items-center gap-1 ml-1">
                    {analysis.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[9px] font-normal border-teal/30 text-teal">
                        {tag}
                      </Badge>
                    ))}
                  </span>
                )}
              </button>
              {analysisOpen && (
                <div className="mt-1.5 bg-teal/5 border border-teal/15 rounded-md p-2.5 text-xs leading-relaxed space-y-1">
                  {analysis.model && <p><span className="font-medium text-teal">模型：</span>{analysis.model}</p>}
                  {analysis.variables && <p><span className="font-medium text-teal">变量：</span>{analysis.variables}</p>}
                  {analysis.method && <p><span className="font-medium text-teal">方法：</span>{analysis.method}</p>}
                  {analysis.contribution && <p><span className="font-medium text-teal">创新：</span>{analysis.contribution}</p>}
                </div>
              )}
            </div>
          )}

          {/* Abstract */}
          {paper.abstract && (
            <div className="mt-2">
              <button
                className="text-xs font-medium text-muted-foreground flex items-center gap-1 hover:text-foreground"
                onClick={() => setAbstractOpen(!abstractOpen)}
              >
                <span className="text-[10px]">{abstractOpen ? "\u25BC" : "\u25B6"}</span>
                摘要
              </button>
              {abstractOpen && (
                <p className="mt-1.5 text-xs text-foreground/70 leading-relaxed">
                  {paper.abstract}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right side: upload status + actions */}
        <div className="flex items-center gap-2 shrink-0">
          {hasUploaded ? (
            <>
              <button
                onClick={onViewFullText}
                className="text-[10px] px-2 py-0.5 rounded border border-teal/40 bg-teal/10 text-teal cursor-pointer hover:bg-teal/20"
              >
                查看原文
              </button>
              <a
                href={`/api/papers/${paper.id}?pdf=true`}
                download={paper.pdfFileName ?? "paper.pdf"}
                className="text-[10px] px-2 py-0.5 rounded border border-border/50 text-muted-foreground hover:border-teal/40 hover:text-teal"
              >
                下载 PDF
              </a>
            </>
          ) : (
            <button
              onClick={onAttachPDF}
              className="text-[10px] px-2 py-0.5 rounded border border-border/50 text-muted-foreground cursor-pointer hover:border-teal/40 hover:text-teal"
            >
              上传原文
            </button>
          )}
          <Badge variant="outline" className="text-[10px]">
            引用 {paper.citationCount}
          </Badge>
          <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={onDelete}>
            删除
          </Button>
        </div>
      </div>
    </div>
  );
}
