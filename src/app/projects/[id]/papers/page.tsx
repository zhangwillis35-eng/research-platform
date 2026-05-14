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
import {
  AnalysisEngineSelect,
  type AnalysisEngine,
} from "@/components/analysis-engine-select";
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";
import Link from "next/link";
import { setCrossFeatureData } from "@/lib/cross-feature";
import { PaperAnalysisTab } from "./analysis-tab";

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
  category?: string | null; // "core" | "supporting"
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
  const [activeTab, setActiveTab] = usePersistedState<"catalog" | "weekly" | "analysis">(NS, "activeTab", "catalog");
  const [aiProvider, setAiProvider] = usePersistedState<AIProvider>(NS, "aiProvider", "deepseek-fast");
  const [overview, setOverview] = usePersistedState<string | null>(NS, "overview", null);
  const [overviewOpen, setOverviewOpen] = usePersistedState<boolean>(NS, "overviewOpen", false);

  // Field analysis state
  const [fieldEngine, setFieldEngine] = usePersistedState<AnalysisEngine>(NS, "fieldEngine", "builtin");
  const [fieldTakeaways, setFieldTakeaways] = usePersistedState<string | null>(NS, "fieldTakeaways", null);
  const [fieldTakeawaysOpen, setFieldTakeawaysOpen] = usePersistedState<boolean>(NS, "fieldTakeawaysOpen", false);
  const [assumptions, setAssumptions] = usePersistedState<string | null>(NS, "assumptions", null);
  const [assumptionsOpen, setAssumptionsOpen] = usePersistedState<boolean>(NS, "assumptionsOpen", false);
  const [notebookConfigured, setNotebookConfigured] = useState(false);

  // Transient state
  const [loading, setLoading] = useState(true);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestResult, setDigestResult] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [fieldTakeawaysLoading, setFieldTakeawaysLoading] = useState(false);
  const [assumptionsLoading, setAssumptionsLoading] = useState(false);

  // PDF upload state
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [attachTarget, setAttachTarget] = useState<string | null>(null);
  const [folderProgress, setFolderProgress] = useState<{ current: number; total: number; name: string } | null>(null);

  // Full text viewer state
  const [fullTextPaper, setFullTextPaper] = useState<Paper | null>(null);
  const [fullTextLoading, setFullTextLoading] = useState(false);

  async function viewFullText(paper: Paper) {
    // If we only have the marker, fetch the actual full text from API
    if (paper.fullText === "__has_fulltext__" || !paper.fullText) {
      setFullTextLoading(true);
      setFullTextPaper({ ...paper, fullText: "加载中..." });
      try {
        const res = await fetch(`/api/papers/${paper.id}`);
        const data = await res.json();
        setFullTextPaper(data.paper ?? paper);
      } catch {
        setFullTextPaper({ ...paper, fullText: "全文加载失败，请重试。" });
      } finally {
        setFullTextLoading(false);
      }
    } else {
      setFullTextPaper(paper);
    }
  }

  // Multi-select delete state
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set());

  // Abort controllers
  const digestAbort = useAbort();
  const overviewAbort = useAbort();
  const fieldAbort = useAbort();
  const assumptionsAbort = useAbort();

  useEffect(() => {
    fetch(`/api/papers?projectId=${projectId}`)
      .then((r) => r.json())
      .then((data) => setPapers(data.papers ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Check if NotebookLM is configured
    fetch(`/api/papers?projectId=${projectId}&check=notebook`)
      .catch(() => {});
    // Simple check via project data
    fetch(`/api/papers/journal-filter?projectId=${projectId}`)
      .then(r => r.json())
      .catch(() => {});
  }, [projectId]);

  // Check notebook configuration
  useEffect(() => {
    fetch(`/api/integrations/notebooklm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check" }),
    })
      .then((r) => r.json())
      .then((d) => setNotebookConfigured(d.available && d.authenticated))
      .catch(() => setNotebookConfigured(false));
  }, []);

  // fullTextPapers defined after displayPapers below

  async function generateFieldTakeaways() {
    setFieldTakeawaysLoading(true);
    setFieldTakeaways("");
    setFieldTakeawaysOpen(true);
    const signal = fieldAbort.reset();
    try {
      const res = await fetch("/api/papers/field-takeaways", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          paperIds: fullTextPapers.map((p) => p.id),
          provider: aiProvider,
          engine: fieldEngine,
        }),
        signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setFieldTakeaways("生成失败: " + (err.error || res.status));
        setFieldTakeawaysLoading(false);
        return;
      }
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
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
            if (event.type === "text") {
              text += event.text;
              setFieldTakeaways(text);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setFieldTakeaways("生成失败: " + String(err));
      }
    }
    setFieldTakeawaysLoading(false);
  }

  async function generateAssumptions() {
    setAssumptionsLoading(true);
    setAssumptions("");
    setAssumptionsOpen(true);
    const signal = assumptionsAbort.reset();
    try {
      const res = await fetch("/api/papers/assumptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          paperIds: fullTextPapers.map((p) => p.id),
          provider: aiProvider,
          engine: fieldEngine,
        }),
        signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setAssumptions("分析失败: " + (err.error || res.status));
        setAssumptionsLoading(false);
        return;
      }
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
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
            if (event.type === "text") {
              text += event.text;
              setAssumptions(text);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setAssumptions("分析失败: " + String(err));
      }
    }
    setAssumptionsLoading(false);
  }

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

  async function batchDelete() {
    if (selectedForDelete.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedForDelete.size} 篇文献？`)) return;
    await Promise.all(
      Array.from(selectedForDelete).map((id) =>
        fetch(`/api/papers/${id}`, { method: "DELETE" })
      )
    );
    setPapers((prev) => prev.filter((p) => !selectedForDelete.has(p.id)));
    setSelectedForDelete(new Set());
  }

  function toggleSelectForDelete(paperId: string) {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (next.has(paperId)) next.delete(paperId);
      else next.add(paperId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedForDelete.size === displayPapers.length) {
      setSelectedForDelete(new Set());
    } else {
      setSelectedForDelete(new Set(displayPapers.map((p) => p.id)));
    }
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
            let analyzed = 0;
            let failed = 0;

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
                    if (evt.status === "ok") analyzed++;
                    if (evt.status === "error") failed++;
                    setDigestResult(
                      `AI 深度分析: ${evt.completed}/${evt.total} 篇（${analyzed} 成功` +
                      (failed > 0 ? `，${failed} 失败` : "") + "）"
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
    if (catalogPapers.length === 0) return;
    setOverviewLoading(true);
    setOverview(null);
    setOverviewOpen(true);
    const signal = overviewAbort.reset();
    try {
      const papersForAI = catalogPapers.slice(0, 50).map((p) => ({
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
        body: JSON.stringify({ query: "文献目录", papers: papersForAI, provider: aiProvider }),
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let text = "";
      let buf = "";
      let rafId: number | null = null;
      const flushOverview = () => { setOverview(text); rafId = null; };
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const d = JSON.parse(line.slice(6));
              if (d.text) { text += d.text; if (rafId === null) rafId = requestAnimationFrame(flushOverview); }
            } catch { /* skip */ }
          }
        }
        if (rafId !== null) cancelAnimationFrame(rafId);
        flushOverview();
      }
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

  // ─── Shared: load pdf.js and extract text client-side ───
  async function ensurePdfJs() {
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
  async function extractTextClientSide(file: File, pdfjsLib: any): Promise<string> {
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
    const lines = fullText.split("\n").map((l: string) => l.trim()).filter(Boolean);
    for (const line of lines.slice(0, 20)) {
      if (line.length >= 15 && line.length <= 250 && !/^[\d\s.]+$/.test(line) && !line.startsWith("http")) {
        return line;
      }
    }
    return fileName.replace(/\.pdf$/i, "");
  }

  // Upload new PDFs (creates new paper entries)
  async function handleUploadPDF(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadResult(null);
    let uploaded = 0;

    const pdfjsLib = await ensurePdfJs();

    for (const file of Array.from(files)) {
      try {
        // Extract text client-side first (avoids server-side unpdf dependency)
        const clientText = await extractTextClientSide(file, pdfjsLib);

        const formData = new FormData();
        formData.append("file", file);
        formData.append("projectId", projectId);
        if (clientText.trim().length >= 50) {
          formData.append("fullText", clientText);
          formData.append("title", extractTitle(clientText, file.name));
        }

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

  // Upload a folder of PDFs — extract text locally via pdf.js (CDN), send JSON to server
  async function handleFolderUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (files.length === 0) return;

    setUploading(true);
    setUploadResult(null);

    let completed = 0;
    let created = 0;
    let failed = 0;
    const failedNames: string[] = [];
    const CONCURRENCY = 3;

    setFolderProgress({ current: 0, total: files.length, name: "加载 PDF 解析器..." });

    const pdfjsLib = await ensurePdfJs();

    setFolderProgress({ current: 0, total: files.length, name: "开始提取文本..." });

    async function uploadOne(file: File) {
      try {
        let fullText = "";
        try {
          fullText = (await extractTextClientSide(file, pdfjsLib)).trim();
        } catch { /* pdf.js extraction failed */ }

        if (fullText.length >= 50) {
          // Fast path: send extracted text as JSON
          const title = extractTitle(fullText, file.name);
          const res = await fetch("/api/papers/batch-upload-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, title, abstract: fullText.slice(0, 500), fullText, pdfFileName: file.name, authors: [] }),
          });
          if (res.ok) {
            created++;
          } else {
            failed++;
            failedNames.push(file.name);
          }
        } else {
          // Fallback: upload PDF binary to server for extraction
          const formData = new FormData();
          formData.append("projectId", projectId);
          formData.append("file", file);
          const res = await fetch("/api/papers/batch-upload", { method: "POST", body: formData });
          if (res.ok) {
            created++;
          } else {
            const errData = await res.json().catch(() => ({}));
            failed++;
            failedNames.push(`${file.name}（${errData.error ?? "解析失败"}）`);
          }
        }
      } catch (err) {
        failed++;
        failedNames.push(`${file.name}（${(err as Error).message?.slice(0, 50) ?? "未知错误"}）`);
      }
      completed++;
      setFolderProgress({ current: completed, total: files.length, name: file.name });
    }

    // Run in sliding window of CONCURRENCY concurrent uploads
    const queue = [...files];
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const file = queue.shift()!;
        await uploadOne(file);
      }
    });
    await Promise.all(workers);

    const res = await fetch(`/api/papers?projectId=${projectId}`);
    const data = await res.json();
    setPapers(data.papers ?? []);

    setUploadResult(
      `文件夹导入完成：成功 ${created} 篇${failed > 0 ? `，失败 ${failed} 篇` : ""}` +
      (failedNames.length > 0 ? `\n失败详情：${failedNames.join("；")}` : "")
    );
    setFolderProgress(null);
    setUploading(false);
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  // Attach PDF to an existing paper
  async function handleAttachPDF(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !attachTarget) return;

    const file = files[0];
    setUploading(true);
    setUploadResult(null);

    try {
      const pdfjsLib = await ensurePdfJs();
      const clientText = await extractTextClientSide(file, pdfjsLib);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      formData.append("paperId", attachTarget);
      if (clientText.trim().length >= 50) {
        formData.append("fullText", clientText);
      }

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

  // Clear weekly digest papers
  async function clearWeeklyDigest() {
    if (!confirm("确定清空所有 AI 前沿周刊文献？清空后可重新获取最新顶刊论文。")) return;
    try {
      const res = await fetch(`/api/papers?projectId=${projectId}&folder=AI 前沿`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        setUploadResult(`已清空 ${data.deleted ?? 0} 篇周刊文献`);
        const reload = await fetch(`/api/papers?projectId=${projectId}`);
        const reloadData = await reload.json();
        setPapers(reloadData.papers ?? []);
      }
    } catch {
      setUploadResult("清空失败");
    }
  }

  // Split papers into catalog (search/upload) vs weekly digest
  const weeklyPapers = papers.filter((p) => p.folder?.includes("AI 前沿"));
  const catalogPapers = papers.filter((p) => !p.folder?.includes("AI 前沿"));
  const displayPapers = activeTab === "weekly" ? weeklyPapers : activeTab === "analysis" ? [] : catalogPapers;
  const allFullTextPapers = papers.filter((p) => p.fullText);
  const fullTextPapers = displayPapers.filter((p) => p.fullText);
  const uploadedCount = allFullTextPapers.length;

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
          <input
            ref={folderInputRef}
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            // @ts-expect-error webkitdirectory is not in React typings
            webkitdirectory=""
            onChange={handleFolderUpload}
          />
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading && !folderProgress ? "上传中..." : "上传 PDF"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading}
          >
            {folderProgress ? `${folderProgress.current}/${folderProgress.total}` : "批量导入文件夹"}
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
      {(digestResult || uploadResult || folderProgress) && (
        <div className="px-3 py-2 bg-teal/5 border border-teal/20 rounded-lg text-xs text-teal space-y-1">
          {folderProgress && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span>正在导入：{folderProgress.name}</span>
                <span>{folderProgress.current} / {folderProgress.total}</span>
              </div>
              <div className="w-full bg-teal/10 rounded-full h-1">
                <div
                  className="bg-teal h-1 rounded-full transition-all"
                  style={{ width: `${(folderProgress.current / folderProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
          {!folderProgress && (digestResult || uploadResult) && (
            <span>{digestResult || uploadResult}</span>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/50">
        <button
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === "catalog" ? "border-teal text-teal" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => { setActiveTab("catalog"); setFullTextPaper(null); setSelectedForDelete(new Set()); }}
        >
          文献目录（{catalogPapers.length}）
        </button>
        <button
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === "weekly" ? "border-teal text-teal" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => { setActiveTab("weekly"); setFullTextPaper(null); setSelectedForDelete(new Set()); }}
        >
          AI 前沿周刊（{weeklyPapers.length}）
        </button>
        <button
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === "analysis" ? "border-teal text-teal" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => { setActiveTab("analysis"); setFullTextPaper(null); setSelectedForDelete(new Set()); }}
        >
          文献分析（{allFullTextPapers.length}）
        </button>
        {activeTab === "weekly" && weeklyPapers.length > 0 && (
          <button
            className="ml-auto px-2 py-1 text-[10px] text-destructive hover:bg-destructive/10 rounded transition-colors"
            onClick={clearWeeklyDigest}
          >
            清空周刊
          </button>
        )}
      </div>

      {/* Analysis tab content */}
      {activeTab === "analysis" && (
        <PaperAnalysisTab
          projectId={projectId}
          papers={allFullTextPapers}
          aiProvider={aiProvider}
          onProviderChange={setAiProvider}
          onPaperCategoryChange={(paperId, category) => {
            setPapers((prev: Paper[]) => prev.map((p: Paper) => p.id === paperId ? { ...p, category } : p));
            fetch(`/api/papers/${paperId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ category }),
            }).catch(() => {});
          }}
        />
      )}

      {/* AI Overview toolbar */}
      {activeTab !== "analysis" && displayPapers.length > 0 && (
        <div className="flex items-center gap-2">
          <AIProviderSelect value={aiProvider} onChange={setAiProvider} />
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={generateOverview}
            disabled={overviewLoading}
          >
            {overviewLoading ? "分析中..." : "AI 综合分析 ~70s"}
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
      {activeTab !== "analysis" && overviewOpen && (
        <div className="border border-teal/20 rounded-lg bg-teal/5 p-4">
          {overviewLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-block w-4 h-4 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
              正在分析 {catalogPapers.length} 篇文献目录文献...
            </div>
          ) : overview ? (
            <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap leading-relaxed">
              {overview}
            </div>
          ) : null}
        </div>
      )}

      {/* Field Analysis section */}
      {activeTab !== "analysis" && fullTextPapers.length > 0 && (
        <div className="border border-border/50 rounded-lg bg-card">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/30">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-medium">领域分析</h3>
              <span className="text-[10px] text-muted-foreground">{fullTextPapers.length} 篇全文可用</span>
            </div>
            <div className="flex items-center gap-2">
              <AnalysisEngineSelect value={fieldEngine} onChange={setFieldEngine} notebookConfigured={notebookConfigured} />
              {fieldEngine === "builtin" && <AIProviderSelect value={aiProvider} onChange={setAiProvider} />}
            </div>
          </div>
          <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={generateFieldTakeaways}
              disabled={fieldTakeawaysLoading || fullTextPapers.length === 0}
            >
              {fieldTakeawaysLoading ? "生成中..." : "领域要点提炼"}
            </Button>
            <span className="text-[10px] text-muted-foreground">~60s</span>
            <StopButton show={fieldTakeawaysLoading} onClick={fieldAbort.abort} />
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={generateAssumptions}
              disabled={assumptionsLoading || fullTextPapers.length === 0}
            >
              {assumptionsLoading ? "分析中..." : "假设对比分析 ~40s"}
            </Button>
            <StopButton show={assumptionsLoading} onClick={assumptionsAbort.abort} />
            {fieldTakeaways && (
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setFieldTakeawaysOpen(!fieldTakeawaysOpen)}>
                {fieldTakeawaysOpen ? "收起要点" : "展开要点"}
              </button>
            )}
            {assumptions && (
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setAssumptionsOpen(!assumptionsOpen)}>
                {assumptionsOpen ? "收起假设" : "展开假设"}
              </button>
            )}
          </div>
          {/* Field Takeaways result */}
          {fieldTakeawaysOpen && fieldTakeaways && (
            <div className="px-4 pb-3">
              <div className="border border-blue-200 rounded-lg bg-blue-50/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-medium text-blue-700">领域要点</h4>
                  <div className="flex gap-1">
                    <Link href={`/projects/${projectId}/ideas/generate`} onClick={() => setCrossFeatureData("ideas", projectId, "field-takeaways", fieldTakeaways ?? "")}>
                      <button className="text-[10px] px-2 py-0.5 rounded border border-blue-300 text-blue-600 hover:bg-blue-100">
                        发送空白到研究想法
                      </button>
                    </Link>
                    <Link href={`/projects/${projectId}/review/generate`} onClick={() => setCrossFeatureData("review", projectId, "field-takeaways", fieldTakeaways ?? "")}>
                      <button className="text-[10px] px-2 py-0.5 rounded border border-blue-300 text-blue-600 hover:bg-blue-100">
                        发送到文献综述
                      </button>
                    </Link>
                  </div>
                </div>
                <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap leading-relaxed">
                  {fieldTakeaways}
                </div>
              </div>
            </div>
          )}
          {/* Assumptions result */}
          {assumptionsOpen && assumptions && (
            <div className="px-4 pb-3">
              <div className="border border-amber-200 rounded-lg bg-amber-50/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-medium text-amber-700">假设对比分析</h4>
                  <Link href={`/projects/${projectId}/theories/integrate`} onClick={() => setCrossFeatureData("theories", projectId, "assumptions", assumptions ?? "")}>
                    <button className="text-[10px] px-2 py-0.5 rounded border border-amber-300 text-amber-600 hover:bg-amber-100">
                      发送到理论整合
                    </button>
                  </Link>
                </div>
                <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap leading-relaxed">
                  {assumptions}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Full text reader view / Paper list (hidden during analysis tab) */}
      {activeTab === "analysis" ? null : fullTextPaper ? (
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
          {/* Multi-select toolbar */}
          <div className="flex items-center gap-3 px-1">
            <input
              type="checkbox"
              checked={displayPapers.length > 0 && selectedForDelete.size === displayPapers.length}
              onChange={toggleSelectAll}
              className="accent-destructive"
              title="全选/取消全选"
            />
            <span className="text-xs text-muted-foreground">
              {selectedForDelete.size > 0
                ? `已选 ${selectedForDelete.size} 篇`
                : "多选删除"}
            </span>
            {selectedForDelete.size > 0 && (
              <Button
                size="sm"
                variant="destructive"
                className="text-xs h-6 px-2"
                onClick={batchDelete}
              >
                删除选中（{selectedForDelete.size}）
              </Button>
            )}
          </div>
          {displayPapers.map((p) => (
            <PaperRow
              key={p.id}
              paper={p}
              onToggle={() => toggleSelected(p.id, p.isSelected)}
              onDelete={() => deletePaper(p.id)}
              onViewFullText={p.fullText ? () => viewFullText(p) : undefined}
              onAttachPDF={() => {
                setAttachTarget(p.id);
                attachInputRef.current?.click();
              }}
              selectedForDelete={selectedForDelete.has(p.id)}
              onToggleDelete={() => toggleSelectForDelete(p.id)}
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
  selectedForDelete,
  onToggleDelete,
}: {
  paper: Paper;
  onToggle: () => void;
  onDelete: () => void;
  onViewFullText?: () => void;
  onAttachPDF: () => void;
  selectedForDelete?: boolean;
  onToggleDelete?: () => void;
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
          checked={!!selectedForDelete}
          onChange={onToggleDelete}
          className="accent-destructive shrink-0 mt-1"
          title="选中以批量删除"
        />
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
            <button
              onClick={onViewFullText}
              className="text-[10px] px-2 py-0.5 rounded border border-teal/40 bg-teal/10 text-teal cursor-pointer hover:bg-teal/20"
            >
              查看原文
            </button>
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
