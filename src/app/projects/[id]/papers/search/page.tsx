"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { searchManager, type SearchJobState } from "@/lib/search-manager";
import { consumeCrossFeatureData } from "@/lib/cross-feature";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  type AIProvider,
} from "@/components/ai-provider-select";
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";
import { toast } from "@/components/toast";
import {
  type AnalysisRecord,
  type Author,
  type FullTextPanelState,
  type Paper,
  type SearchFilters,
  type SearchHistoryItem,
  type SearchMeta,
  type SearchPlan,
  type SearchStats,
  type SortBy,
  sortPapers,
} from "./components/types";
import { AnalysisResultView } from "./components/analysis-result-view";
import { SearchHistoryPanel } from "./components/search-history-panel";
import { SearchProgressPanel } from "./components/search-progress-panel";
import { ResultsToolbar } from "./components/results-toolbar";
import { PaperCard } from "./components/paper-card";
import { useWindowedList } from "./use-windowed-list";

export default function PaperSearchPage() {
  const params = useParams();
  const projectId = params.id as string;

  // ─── Persisted state (survives page navigation) ───
  const NS = `search-${projectId}`;
  const [query, setQuery] = usePersistedState<string>(NS, "query", "");
  const [papers, setPapers] = usePersistedState<Paper[]>(NS, "papers", []);
  const [meta, setMeta] = usePersistedState<SearchMeta | null>(NS, "meta", null);
  const [aiProvider, setAiProvider] = usePersistedState<AIProvider>(NS, "aiProvider", "deepseek-fast");
  const [analysisResult, setAnalysisResult] = usePersistedState<string | null>(NS, "analysisResult", null);
  const [sortBy, setSortBy] = usePersistedState<SortBy>(NS, "sortBy", "relevance");
  const [filterRankings, setFilterRankings] = usePersistedState<Set<string>>(NS, "filterRankings", new Set());
  const [searchPlan, setSearchPlan] = usePersistedState<SearchPlan | null>(NS, "searchPlan", null);
  const [selectedPapers, setSelectedPapers] = usePersistedState<Set<number>>(NS, "selectedPapers", new Set());
  const [searchStats, setSearchStats] = usePersistedState<SearchStats | null>(NS, "searchStats", null);
  const [searchMode, setSearchMode] = usePersistedState<boolean>(NS, "searchMode", true);
  const [searchBatches, setSearchBatches] = usePersistedState<Array<{ id: string; query: string; count: number; timestamp: Date }>>(NS, "searchBatches", []);
  const [filterBatch, setFilterBatch] = usePersistedState<string>(NS, "filterBatch", "all");
  const [paperBatchMap, setPaperBatchMap] = usePersistedState<Map<number, string>>(NS, "paperBatchMap", new Map());
  const [savedPaperKeys, setSavedPaperKeys] = usePersistedState<Set<string>>(NS, "savedPaperKeys", new Set());
  const [enableRelevance, setEnableRelevance] = usePersistedState<boolean>(NS, "enableRelevance", true);
  const [searchLimit, setSearchLimit] = usePersistedState<number>(NS, "searchLimit", 50);
  const [searchOverview, setSearchOverview] = usePersistedState<string | null>(NS, "searchOverview", null);
  const [searchHistory, setSearchHistory] = usePersistedState<SearchHistoryItem[]>(NS, "searchHistory", []);
  // Each search record gets its own chat — keyed by search ID
  const [activeSearchId, setActiveSearchId] = usePersistedState<string>(NS, "activeSearchId", "default");
  const [allChats, setAllChats] = usePersistedState<
    Record<string, Array<{ role: "user" | "assistant"; content: string; thinking?: string }>>
  >(NS, "allChats", {});
  const chatMessages = allChats[activeSearchId] ?? [];
  const setChatMessages = useCallback(
    (v: Array<{ role: "user" | "assistant"; content: string; thinking?: string }> | ((prev: Array<{ role: "user" | "assistant"; content: string; thinking?: string }>) => Array<{ role: "user" | "assistant"; content: string; thinking?: string }>)) => {
      setAllChats(prev => {
        const old = prev[activeSearchId] ?? [];
        const next = typeof v === "function" ? v(old) : v;
        return { ...prev, [activeSearchId]: next };
      });
    },
    [activeSearchId, setAllChats]
  );
  const [chatOpen, setChatOpen] = usePersistedState<boolean>(NS, "chatOpen", false);
  const [historyCollapsed, setHistoryCollapsed] = usePersistedState<boolean>(NS, "historyCollapsed", false);
  const [planSections, setPlanSections] = usePersistedState(NS, "planSections", {
    keywords: true, precision: true, broad: true, filters: true, platforms: true,
  });
  const [leftPanelWidth, setLeftPanelWidth] = usePersistedState<number>(NS, "leftPanelWidth", 480);
  const [journalLang, setJournalLang] = usePersistedState<"en" | "zh">(NS, "journalLang", "en");
  const [journalFilterOpen, setJournalFilterOpen] = usePersistedState<boolean>(NS, "journalFilterOpen", false);
  const [refSearchOpen, setRefSearchOpen] = usePersistedState<boolean>(NS, "refSearchOpen", false);
  const [refSearchInput, setRefSearchInput] = useState("");
  const [refSearching, setRefSearching] = useState(false);
  const [refSearchResult, setRefSearchResult] = useState<{
    matchResults: Array<{ queryTitle: string; found: boolean }>;
    stats: { total: number; found: number; notFound: number };
  } | null>(null);
  const refAbort = useAbort();
  const [ideaContext, setIdeaContext] = useState<string | null>(null);

  // Consume cross-feature data from research ideas page (one-time)
  useEffect(() => {
    const data = consumeCrossFeatureData("search", projectId);
    if (data?.source === "research-idea" && data.content) {
      try {
        const idea = JSON.parse(data.content);
        const context = `【来自研究想法】\n标题: ${idea.title}\n理论: ${idea.theory}\n情境: ${idea.context}\n方法: ${idea.method}\n假设: ${idea.hypothesis}\n贡献: ${idea.contribution}`;
        setIdeaContext(context);
        // Auto-fill search query with the idea's key terms
        const searchTerm = idea.title?.replace(/[（(].+?[)）]/g, "").trim() ?? "";
        if (searchTerm) setQuery(searchTerm);
        // Add context message to chat
        setChatMessages([
          { role: "assistant", content: `📋 已从「研究想法」导入上下文：\n\n**${idea.title}**\n- 理论: ${idea.theory}\n- 情境: ${idea.context}\n- 方法: ${idea.method}\n- 假设: ${idea.hypothesis}\n\n你可以直接搜索该方向的文献，或向我提问该想法的可行性和相关研究。` },
        ]);
      } catch { /* invalid JSON */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load analysis history from DB on mount
  useEffect(() => {
    const types = ["variables", "review", "ideas"] as const;
    Promise.all(
      types.map(t =>
        fetch(`/api/chat-history?projectId=${projectId}&query=${encodeURIComponent(`__analysis:${t}`)}`)
          .then(r => r.json())
          .catch(() => ({ messages: [] }))
      )
    ).then(results => {
      const records: AnalysisRecord[] = [];
      results.forEach((data, i) => {
        const t = types[i];
        for (const m of data.messages ?? []) {
          if (m.role === "record") {
            records.push({ type: t, content: m.content, timestamp: m.timestamp, paperCount: m.paperCount ?? 0 });
          }
        }
      });
      records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setAnalysisHistory(records);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ─── Journal filter state ───
  const [journalFilters, setJournalFilters] = useState<Array<{ id: string; journalName: string; filterType: string }>>([]);
  const [journalFilterMode, setJournalFilterMode] = useState<string | null>(null);
  const [journalFilterInput, setJournalFilterInput] = useState("");
  const [journalFilterLoading, setJournalFilterLoading] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Load journal filters on mount
  useEffect(() => {
    fetch(`/api/papers/journal-filter?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        setJournalFilters(d.filters ?? []);
        setJournalFilterMode(d.mode ?? null);
      })
      .catch(() => {});
  }, [projectId]);

  async function addJournalFilter(journals: string[], source = "manual") {
    if (journals.length === 0) return;
    const mode = journalFilterMode || "blacklist";
    setJournalFilterLoading(true);
    try {
      await fetch("/api/papers/journal-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, journals, filterType: mode, source }),
      });
      // Reload filters
      const r = await fetch(`/api/papers/journal-filter?projectId=${projectId}`);
      const d = await r.json();
      setJournalFilters(d.filters ?? []);
      setJournalFilterMode(d.mode ?? null);
    } catch {
      toast.error("添加期刊过滤失败，请重试");
    }
    setJournalFilterLoading(false);
  }

  async function removeJournalFilter(filterId: string) {
    try {
      await fetch("/api/papers/journal-filter", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, filterId }),
      });
      setJournalFilters((prev) => prev.filter((f) => f.id !== filterId));
    } catch {
      toast.error("移除期刊过滤失败，请重试");
    }
  }

  async function clearJournalFilters() {
    try {
      await fetch("/api/papers/journal-filter", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, clearAll: true }),
      });
      setJournalFilters([]);
      setJournalFilterMode(null);
    } catch {
      toast.error("清空期刊过滤失败，请重试");
    }
  }

  async function switchFilterMode(mode: "blacklist" | "whitelist") {
    try {
      await fetch("/api/papers/journal-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, mode }),
      });
      setJournalFilterMode(mode);
    } catch {
      toast.error("切换过滤模式失败，请重试");
    }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const mode = journalFilterMode || "blacklist";
    setJournalFilterLoading(true);
    try {
      await fetch("/api/papers/journal-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, csv: text, filterType: mode, source: "csv" }),
      });
      const r = await fetch(`/api/papers/journal-filter?projectId=${projectId}`);
      const d = await r.json();
      setJournalFilters(d.filters ?? []);
      setJournalFilterMode(d.mode ?? null);
    } catch {
      toast.error("CSV 导入失败，请检查文件格式");
    }
    setJournalFilterLoading(false);
    if (csvInputRef.current) csvInputRef.current.value = "";
  }

  async function loadPreset(preset: "ft50" | "utd24" | "abs4star") {
    setJournalFilterLoading(true);
    try {
      const mod = await import("@/lib/sources/journal-rankings");
      const journals = preset === "ft50" ? [...mod.FT50_JOURNALS]
        : preset === "utd24" ? [...mod.UTD24_JOURNALS]
        : [...mod.ABS4STAR_JOURNALS];
      await addJournalFilter(journals, "preset");
    } catch {
      toast.error("加载预设期刊清单失败");
    }
    setJournalFilterLoading(false);
  }

  async function handleRefSearch() {
    if (!refSearchInput.trim() || refSearching) return;
    setRefSearching(true);
    setRefSearchResult(null);
    const signal = refAbort.reset();

    // Add a "searching" message to chat
    const userMsg = { role: "user" as const, content: `[参考文献批量检索]\n${refSearchInput.slice(0, 200)}...` };
    setChatMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/papers/reference-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ references: refSearchInput, provider: aiProvider }),
        signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let statusMsg = "正在检索参考文献...";

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
            if (event.type === "status") {
              statusMsg = event.message;
              setSearchProgress((prev) => {
                const last = prev[prev.length - 1];
                if (last && !last.done) return [...prev.slice(0, -1), { ...last, message: statusMsg }];
                return [...prev, { phase: "ref-search", message: statusMsg, done: false }];
              });
            } else if (event.type === "progress") {
              setSearchProgress((prev) => {
                const updated = { phase: "ref-search", message: `已检索 ${event.searched}/${event.total}，找到 ${event.found} 篇`, done: false };
                const last = prev[prev.length - 1];
                if (last && !last.done) return [...prev.slice(0, -1), updated];
                return [...prev, updated];
              });
            } else if (event.type === "result") {
              // Merge found papers into existing results
              // Replace papers list with results in input order (not merge)
              if (event.papers && event.papers.length > 0) {
                setPapers(event.papers);
              }
              setRefSearchResult({ matchResults: event.matchResults, stats: event.stats });
              // Add result message to chat
              const resultMsg = {
                role: "assistant" as const,
                content: `参考文献检索完成：共 ${event.stats.total} 篇，找到 ${event.stats.found} 篇，未找到 ${event.stats.notFound} 篇。${
                  event.stats.notFound > 0
                    ? "\n\n未找到的论文：\n" + event.matchResults.filter((r: { found: boolean }) => !r.found).map((r: { queryTitle: string }) => `- ${r.queryTitle}`).join("\n")
                    : ""
                }`,
              };
              setChatMessages((prev) => [...prev, resultMsg]);
            }
          } catch { /* skip */ }
        }
      }

      setSearchProgress((prev) => prev.map((p) => ({ ...p, done: true })));
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setChatMessages((prev) => [...prev, { role: "assistant" as const, content: `参考文献检索失败: ${err}` }]);
      }
    }
    setRefSearching(false);
  }

  // ─── Transient state (resets on navigation — no need to persist) ───
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchProgress, setSearchProgress] = useState<Array<{ phase: string; message: string; done: boolean }>>([]);
  const [progressOpen, setProgressOpen] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [currentAnalysisType, setCurrentAnalysisType] = useState<"variables"|"review"|"ideas"|null>(null);

  const [analysisHistory, setAnalysisHistory] = useState<AnalysisRecord[]>([]);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [fullTextPanel, setFullTextPanel] = useState<FullTextPanelState | null>(null);
  const [citePopup, setCitePopup] = useState<string | null>(null);
  const [citeData, setCiteData] = useState<Record<string, string> | null>(null);
  const [citeLoading, setCiteLoading] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);

  // ─── Refs ───
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // Abort controllers for LLM calls
  const searchAbort = useAbort();
  const chatAbort = useAbort();
  const analyzeAbort = useAbort();

  // Resizable split panel
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const historyWidth = containerRef.current.firstElementChild?.getBoundingClientRect().width ?? 0;
      const newWidth = ev.clientX - containerRect.left - historyWidth - 16;
      setLeftPanelWidth(Math.max(320, Math.min(newWidth, containerRect.width - historyWidth - 350)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  // Load search history from DB on mount
  useEffect(() => {
    fetch(`/api/search-history?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setSearchHistory(d.history ?? []))
      .catch(() => {});

  }, [projectId]);

  // Load chat history when query changes (after a search)
  const lastLoadedQuery = useRef("");
  useEffect(() => {
    if (!query || query === lastLoadedQuery.current) return;
    lastLoadedQuery.current = query;
    fetch(`/api/chat-history?projectId=${projectId}&query=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.messages) && d.messages.length > 0) {
          setChatMessages(d.messages);
        }
      })
      .catch(() => {});
  }, [query, projectId]);

  // Save chat history to DB (debounced)
  const saveChatTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  function saveChatHistory(messages: Array<{ role: string; content: string; thinking?: string }>) {
    if (!query || messages.length === 0) return;
    clearTimeout(saveChatTimeout.current);
    saveChatTimeout.current = setTimeout(() => {
      fetch("/api/chat-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, query, messages, provider: aiProvider }),
      }).catch(() => {});
    }, 500);
  }

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatStreaming]);

  // Build context from current search results for the chat system prompt
  function buildPapersContext(): string {
    // Include up to 50 papers with full abstracts for comprehensive context
    const contextPapers = displayedPapers.slice(0, 50);
    if (contextPapers.length === 0) return "";
    return contextPapers
      .map(
        (p, i) =>
          `[${i + 1}] ${p.title}\n作者: ${p.authors.map((a) => a.name).join(", ")}\n年份: ${p.year ?? "N/A"} | 期刊: ${p.venue ?? "N/A"} | 引用: ${p.citationCount} | DOI: ${p.doi ?? "无"}${p.journalRanking?.badges?.length ? `\n期刊等级: ${p.journalRanking.badges.join(", ")}` : ""}${p.relevanceScore != null ? ` | 相关性: ${p.relevanceScore}/10` : ""}${p.openAccessPdf ? `\n全文PDF: ${p.openAccessPdf}` : ""}${p.hasFullText ? "\n[已获取全文]" : ""}\n摘要: ${p.abstract ?? "无摘要"}`
      )
      .join("\n\n---\n\n");
  }

  async function handleChatSend(presetMessages?: Array<{ role: "user" | "assistant"; content: string }>) {
    let newMessages: Array<{ role: "user" | "assistant"; content: string }>;

    if (presetMessages) {
      // Called from unified handler with messages already set
      newMessages = presetMessages;
    } else {
      // Direct call
      const text = chatInput.trim();
      if (!text || chatStreaming) return;
      const userMsg = { role: "user" as const, content: text };
      newMessages = [...chatMessages, userMsg];
      setChatMessages(newMessages);
      setChatInput("");
    }

    setChatStreaming(true);
    const signal = chatAbort.reset();

    // Add empty assistant message for streaming
    const assistantIdx = newMessages.length;
    setChatMessages([...newMessages, { role: "assistant", content: "" }]);

    try {
      // Detect paper references in user's latest message and auto-fetch full text
      const latestUserMsg = newMessages.filter(m => m.role === "user").pop()?.content ?? "";
      const refPattern = /\[(\d+(?:[,，]\s*\d+)*(?:\s*[-–]\s*\d+)?)\]|(?:第|文献|论文|paper\s*)(\d+)/gi;
      const referencedIndices = new Set<number>();
      let refMatch;
      while ((refMatch = refPattern.exec(latestUserMsg)) !== null) {
        const nums = (refMatch[1] || refMatch[2] || "").split(/[,，\s-–]+/).map(Number).filter(n => n > 0);
        nums.forEach(n => referencedIndices.add(n - 1)); // 0-indexed
      }

      // Fetch full text for referenced papers that have DOI/PDF
      let fullTextContext = "";
      if (referencedIndices.size > 0 && referencedIndices.size <= 5) {
        // Show "fetching" indicator
        setChatMessages(prev => {
          const u = [...prev];
          u[u.length - 1] = { role: "assistant", content: `正在获取 ${referencedIndices.size} 篇论文全文...` };
          return u;
        });
        const fetchPromises = Array.from(referencedIndices)
          .filter(i => i < displayedPapers.length)
          .map(async (i) => {
            const p = displayedPapers[i];
            if (!p.doi && !p.openAccessPdf) return null;
            try {
              const res = await fetch("/api/papers/fulltext", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.timeout(10000),
                body: JSON.stringify({ doi: p.doi, openAccessPdf: p.openAccessPdf, unpaywallUrl: p.unpaywallUrl, title: p.title }),
              });
              if (!res.ok) return null;
              const data = await res.json();
              if (data.available && data.text) {
                return `\n\n### [${i + 1}] ${p.title} — 全文节选（${data.wordCount ?? "?"}词，来源: ${data.source}）\n${data.text.slice(0, 6000)}`;
              }
              return null;
            } catch { return null; }
          });
        const results = await Promise.all(fetchPromises);
        const fetched = results.filter(Boolean);
        fullTextContext = fetched.join("");
        // Update indicator
        setChatMessages(prev => {
          const u = [...prev];
          u[u.length - 1] = {
            role: "assistant",
            content: fetched.length > 0
              ? `已获取 ${fetched.length} 篇全文，正在深度分析...`
              : "全文获取失败（可能为付费文献），基于摘要分析...",
          };
          return u;
        });
      }

      const papersContext = buildPapersContext();
      // Build conversation summary for context reinforcement
      const priorTopics = newMessages
        .filter(m => m.role === "user")
        .map(m => m.content)
        .slice(-5)
        .join("; ");
      const systemPrompt = `你是管理学文献分析助手，具有完整的对话记忆能力。
${ideaContext ? `
## 研究想法上下文（从「研究想法」页面导入）
${ideaContext}
请基于这个研究想法来分析检索到的文献，说明文献与该想法的关联性。
` : ""}
## 当前检索主题
「${query}」

## 对话上下文
用户在本轮对话中已讨论: ${priorTopics || "（首次提问）"}

## 文献数据库（共 ${displayedPapers.length} 篇，以下列出前 ${Math.min(displayedPapers.length, 50)} 篇完整信息）

${papersContext}

## 你的能力
- 深入分析特定文献的研究方法、理论贡献、创新点、研究设计
- 比较多篇文献的异同（方法论、理论框架、数据来源、发现）
- 总结某个主题或子领域的研究脉络和演进趋势
- 发现研究空白和未来研究方向
- 解释变量关系、理论框架和因果机制
- 评估文献质量和期刊等级（UTD24、FT50、ABS、JCR等）
- 对已有对话中讨论过的文献进行追问和深究

## 重要规则
- 用中文回答，保持学术风格
- 引用文献时用 [编号] 标注，编号对应上方文献列表
- 当用户追问某篇文献时，结合该文献的完整摘要、期刊信息、作者信息进行深度分析
- 记住本轮对话的所有内容，用户追问时不要重复之前已回答的信息
- 如果用户提到的内容与之前的对话相关，主动关联之前的讨论
- 当有全文数据时，优先使用全文内容进行深度分析，而非仅依赖摘要${fullTextContext ? `

## 已获取的全文内容
以下是用户提到的文献的全文节选，请优先使用这些内容进行深度分析：
${fullTextContext}` : ""}`;

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          provider: aiProvider,
          system: systemPrompt,
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.ok) throw new Error("请求失败");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let sseBuffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.text) {
                  accumulated += data.text;
                  setChatMessages((prev) => {
                    const updated = [...prev];
                    updated[assistantIdx] = {
                      role: "assistant",
                      content: accumulated,
                    };
                    return updated;
                  });
                }
              } catch {
                /* skip malformed SSE */
              }
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User clicked stop — keep partial content, don't show error
      } else {
        setChatMessages((prev) => {
          const updated = [...prev];
          updated[assistantIdx] = {
            role: "assistant",
            content: "抱歉，请求失败，请重试。",
          };
          return updated;
        });
      }
    } finally {
      setChatStreaming(false);
      // Persist chat history after streaming completes
      setChatMessages((prev) => {
        saveChatHistory(prev);
        return prev;
      });
    }
  }

  function togglePaper(index: number) {
    setSelectedPapers((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectAll() {
    if (selectedPapers.size === displayedPapers.length) {
      setSelectedPapers(new Set());
    } else {
      setSelectedPapers(new Set(displayedPapers.map((_, i) => i)));
    }
  }

  // Subscribe to background search manager — sync its state to React
  useEffect(() => {
    const unsubscribe = searchManager.subscribe((jobState: SearchJobState) => {
      // Sync progress
      setSearchProgress(jobState.progress);

      if (jobState.status === "searching") {
        setLoading(true);
        setProgressOpen(true);
      } else if (jobState.status === "done" && jobState.result && !jobState.consumed) {
        searchManager.markConsumed();
        handleSearchResult(jobState.result);
        setLoading(false);
      } else if (jobState.status === "done") {
        setLoading(false);
      } else if (jobState.status === "error") {
        setError(jobState.error ?? "搜索失败");
        setLoading(false);
        // Update "正在检索" message with error
        setChatMessages(prev => {
          const updated = [...prev];
          const idx = updated.findLastIndex(m => typeof m.content === "string" && m.content.startsWith("正在检索"));
          if (idx >= 0) {
            updated[idx] = { role: "assistant", content: "检索未找到结果，请尝试调整关键词。" };
          }
          return updated;
        });
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount: if search manager has a completed result we haven't processed yet, apply it
  useEffect(() => {
    const state = searchManager.getState();
    if (state.status === "searching") {
      setLoading(true);
      setProgressOpen(true);
      setSearchProgress(state.progress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track last processed result to prevent duplicate processing
  const lastProcessedRef = useRef<number>(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleSearchResult(data: any) {
    if (!data?.papers) return;
    // Dedup guard: skip if this result was already processed (within 5 seconds)
    const now = Date.now();
    if (now - lastProcessedRef.current < 5000) return;
    lastProcessedRef.current = now;

    const searchQuery = data.plan?.translatedInput || query;

    const batchId = `batch-${Date.now()}`;
    const prevLen = papers.length;
    const newPapers = [...papers, ...data.papers];
    setPapers(newPapers);
    setSearchPlan(data.plan);
    setSearchStats(data.stats);
    setSearchOverview(null);
    setQuery(searchQuery);
    setMeta({
      total: newPapers.length,
      sources: Object.entries(data.stats?.byQuery ?? {}).map(([source, count]) => ({
        source,
        count: count as number,
      })),
    });
    const newMap = new Map(paperBatchMap);
    data.papers.forEach((_: Paper, i: number) => newMap.set(prevLen + i, batchId));
    setPaperBatchMap(newMap);
    setSearchBatches(prev => [...prev, { id: batchId, query: searchQuery, count: data.papers.length, timestamp: new Date() }]);

    // Update "正在检索" message with result count
    setChatMessages(prev => {
      const updated = [...prev];
      const idx = updated.findLastIndex(m => typeof m.content === "string" && m.content.startsWith("正在检索"));
      if (idx >= 0) {
        updated[idx] = {
          role: "assistant",
          content: `检索完成！找到 ${data.papers.length} 篇相关文献，已添加到右侧列表。\n\n你可以继续检索其他主题，或关闭「学术检索」开关，基于已有文献进行深度问答分析。`,
        };
      }
      return updated;
    });

    // Generate AI overview — clear old messages first, only one attempt per search
    if (data.papers?.length > 0) {
      setChatMessages(prev => [
        ...prev.filter(m =>
          m.content !== "正在深度分析检索结果..." &&
          m.content !== "概览生成失败，请在问答模式中手动提问。"
        ),
        { role: "assistant", content: "正在深度分析检索结果..." },
      ]);
      fetch("/api/papers/overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery,
          papers: data.papers.slice(0, 30).map((p: Paper) => ({
            title: p.title,
            authors: p.authors.slice(0, 5).map((a: Author) => a.name),
            year: p.year, venue: p.venue, abstract: p.abstract,
            citationCount: p.citationCount,
            relevanceScore: p.relevanceScore,
            rankings: p.journalRanking?.badges,
          })),
          provider: aiProvider,
        }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.overview) {
            setChatMessages(prev => {
              const updated = [...prev];
              const idx = updated.findLastIndex(m => m.content === "正在深度分析检索结果...");
              if (idx >= 0) updated[idx] = { role: "assistant", content: d.overview, thinking: d.thinking };
              else updated.push({ role: "assistant", content: d.overview, thinking: d.thinking });
              return updated;
            });
          }
        })
        .catch(() => {
          // Silently remove the placeholder instead of showing error repeatedly
          setChatMessages(prev =>
            prev.filter(m => m.content !== "正在深度分析检索结果...")
          );
        });
    }

    // Save search history + assign unique chat ID
    const newSearchId = `s-${Date.now()}`;
    // Migrate current chat from temp ID to the new one
    setAllChats(prev => {
      const msgs = prev[activeSearchId] ?? [];
      return { ...prev, [newSearchId]: msgs };
    });
    setActiveSearchId(newSearchId);

    fetch("/api/search-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId, query: searchQuery,
        translatedQuery: data.plan?.translatedInput,
        keyTerms: data.plan?.keyTerms,
        synonyms: data.plan?.synonyms,
        precisionQueries: data.plan?.precisionQueries,
        broadQueries: data.plan?.broadQueries,
        filters: data.plan?.filters,
        papers: data.papers, stats: data.stats,
        paperCount: data.papers?.length ?? 0,
        provider: aiProvider,
      }),
    }).then(r => r.json()).then(d => {
      if (d.record) {
        setSearchHistory(prev => {
          if (prev.some(h => h.id === d.record.id)) return prev;
          return [d.record, ...prev];
        });
        // Update active ID to the real DB ID
        setAllChats(prev => {
          const msgs = (prev as Record<string, unknown>)[newSearchId] as typeof chatMessages ?? [];
          const updated: Record<string, typeof chatMessages> = { ...prev, [d.record.id]: msgs };
          delete updated[newSearchId];
          return updated;
        });
        setActiveSearchId(d.record.id);
      }
    }).catch(() => {
      toast.error("检索历史保存失败");
    });
  }

  async function handleSearchFromChat(searchQuery: string) {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);
    setAnalysisResult(null);
    setSearchProgress([]);
    setProgressOpen(true);

    try {
      // Start background search — continues even if user navigates away
      // Results are handled by the searchManager.subscribe() callback above
      searchManager.startSearch({
        query: searchQuery,
        provider: aiProvider,
        limit: searchLimit,
        enableRelevanceScoring: enableRelevance,
        stream: true,
        projectId,
        journalLang,
      });

      return 0; // Result count updated via subscribe callback
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return 0;
      }
      setError(String(err));
      setLoading(false);
      return 0;
    }
  }

  // Legacy form handler (redirect to new function)
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    await handleSearchFromChat(query);
  }

  // Unified send handler: routes to search or Q&A based on mode
  async function handleUnifiedSend() {
    const text = chatInput.trim();
    if (!text || chatStreaming || loading) return;

    const userMsg = { role: "user" as const, content: text };
    const updatedMessages = [...chatMessages, userMsg];
    setChatMessages(updatedMessages);
    setChatInput("");

    if (searchMode) {
      // Search mode: perform literature search
      // Results are handled asynchronously via searchManager.subscribe() → handleSearchResult()
      // The "正在检索" message will be updated in handleSearchResult when results arrive
      setQuery(text);
      const searchingMsg = { role: "assistant" as const, content: `正在检索「${text}」...` };
      setChatMessages([...updatedMessages, searchingMsg]);

      await handleSearchFromChat(text);
    } else {
      // Q&A RAG mode: answer based on existing papers
      handleChatSend(updatedMessages);
    }
  }

  function buildPaperContent(papers: Paper[], offset = 0): string {
    return papers.map((p, i) =>
      `[${i + 1 + offset}] ${p.title}\n${p.authors.map((a) => a.name).join(", ")} (${p.year ?? "N/A"})${p.venue ? ` — ${p.venue}` : ""}${p.journalRanking?.badges?.length ? ` [${p.journalRanking.badges.join(", ")}]` : ""}\n${p.abstract ?? "No abstract"}`
    ).join("\n\n---\n\n");
  }

  async function saveAnalysisRecord(type: "variables" | "review" | "ideas", content: string, paperCount: number) {
    const newMsg = { role: "record", content, timestamp: new Date().toISOString(), paperCount, type };
    try {
      const res = await fetch(`/api/chat-history?projectId=${projectId}&query=${encodeURIComponent(`__analysis:${type}`)}`);
      const data = await res.json();
      const messages = [...(data.messages ?? []), newMsg];
      await fetch("/api/chat-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, query: `__analysis:${type}`, messages }),
      });
      const record: AnalysisRecord = { type, content, timestamp: newMsg.timestamp, paperCount };
      setAnalysisHistory(prev => [record, ...prev]);
    } catch {
      toast.error("分析记录保存失败");
    }
  }

  async function handleAnalyze(type: "variables" | "review" | "ideas") {
    if (displayedPapers.length === 0) return;
    setAnalyzing(true);
    setCurrentAnalysisType(type);
    setAnalysisResult(null);
    const totalPapers = displayedPapers.length;
    const signal = analyzeAbort.reset();

    try {
      if (type === "review") {
        // Single streaming call with all papers
        const content = buildPaperContent(displayedPapers);
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            provider: aiProvider,
            system: `You are a management literature review expert. Based on the provided literature, generate a structured review in Chinese with these sections:
1. 研究主题聚类（group by topic, explain core findings)
2. 时间演进脉络（temporal trends）
3. 研究Gap（under-explored areas）
4. 未来方向（future directions）
Note journal rankings (UTD24/FT50/ABS4*). Use Chinese academic writing style.`,
            messages: [{ role: "user", content }],
          }),
        });
        if (!res.ok) throw new Error("Analysis failed");
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let result = "";
        if (reader) {
          let sseBuffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.text) { result += data.text; setAnalysisResult(result); }
                } catch { /* skip */ }
              }
            }
          }
        }
        if (result) await saveAnalysisRecord(type, result, totalPapers);

      } else if (type === "ideas") {
        // Parallel batches of 10 papers each
        const BATCH = 10;
        const batches: Paper[][] = [];
        for (let i = 0; i < displayedPapers.length; i += BATCH) {
          batches.push(displayedPapers.slice(i, i + BATCH));
        }
        interface Idea { title: string; theory: string; context: string; method: string; hypothesis: string; contribution: string; noveltyScore: number; noveltyReason: string; }
        const allIdeas: Idea[] = [];
        await Promise.all(
          batches.map(async (batch, bi) => {
            const content = buildPaperContent(batch, bi * BATCH);
            const res = await fetch("/api/ai/analyze", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal,
              body: JSON.stringify({ provider: aiProvider, type: "ideas", content }),
            });
            if (!res.ok) return;
            const data = await res.json();
            const ideas = (data.result?.ideas ?? []) as Idea[];
            allIdeas.push(...ideas);
          })
        );
        // Sort by novelty descending
        allIdeas.sort((a, b) => (b.noveltyScore ?? 0) - (a.noveltyScore ?? 0));
        const resultStr = JSON.stringify({ ideas: allIdeas }, null, 2);
        setAnalysisResult(resultStr);
        if (allIdeas.length > 0) await saveAnalysisRecord(type, resultStr, totalPapers);

      } else {
        // variables: send all papers, API handles parallel batching internally
        const content = buildPaperContent(displayedPapers);
        const res = await fetch("/api/ai/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({ provider: aiProvider, type, content }),
        });
        if (!res.ok) throw new Error("Analysis failed");
        const data = await res.json();
        const resultStr = typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2);
        setAnalysisResult(resultStr);
        await saveAnalysisRecord(type, resultStr, totalPapers);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User clicked stop — keep partial result
      } else {
        setError(String(err));
      }
    } finally {
      setAnalyzing(false);
      setCurrentAnalysisType(null);
    }
  }

  // Apply sort and filter
  // Map papers with their original index for batch filtering
  let displayedPapers = sortPapers(papers, sortBy);

  // Filter by batch
  if (filterBatch !== "all") {
    displayedPapers = displayedPapers.filter((_, i) => paperBatchMap.get(i) === filterBatch);
  }

  if (filterRankings.size > 0) {
    displayedPapers = displayedPapers.filter((p) => {
      const badges = p.journalRanking?.badges ?? [];
      return Array.from(filterRankings).some(filterRanking => {
        if (badges.includes(filterRanking)) return true;
        if (filterRanking === "ABS 4") return badges.some(b => b === "ABS 4" || b === "ABS 4*");
        if (filterRanking === "ABS 3") return badges.some(b => b === "ABS 3" || b === "ABS 4" || b === "ABS 4*");
        if (filterRanking === "JCR Q2") return badges.some(b => b === "JCR Q1" || b === "JCR Q2");
        if (filterRanking === "CCF B") return badges.some(b => b === "CCF A" || b === "CCF B");
        if (filterRanking === "中科院二区") return badges.some(b => b === "中科院一区" || b === "中科院二区");
        return false;
      });
    });
  }

  // ─── Windowed rendering: mount only the first 50 cards, grow on scroll ───
  const { visibleCount, sentinelRef, showAtLeast } = useWindowedList(
    displayedPapers.length,
    [papers, sortBy, filterBatch, filterRankings, paperBatchMap]
  );

  /** Scroll to a paper card by 1-based index, expanding the window if needed. */
  function jumpToPaper(n: number) {
    showAtLeast(n);
    setTimeout(() => {
      document.getElementById(`paper-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  /** Scroll + highlight a paper card (used by variable-relation source links). */
  function scrollToPaperCard(oneBasedIndex: number) {
    showAtLeast(oneBasedIndex);
    setTimeout(() => {
      const paperEl = document.querySelector(`[data-paper-index="${oneBasedIndex - 1}"]`);
      if (paperEl) {
        paperEl.scrollIntoView({ behavior: "smooth", block: "center" });
        paperEl.classList.add("ring-2", "ring-teal", "ring-offset-2");
        setTimeout(() => paperEl.classList.remove("ring-2", "ring-teal", "ring-offset-2"), 3000);
      }
    }, 50);
  }


  // Ref for chat panel (for back-to-chat navigation)
  const chatPanelRef = useRef<HTMLDivElement>(null);

  // Parse chat content to make paper number references clickable
  function renderChatContent(text: string) {
    // Match patterns: [1], [2,3], [1-3], 第1篇, 文献1, #1, (1), （1）
    const pattern = /\[(\d+(?:[,，]\s*\d+)*(?:\s*[-–]\s*\d+)?)\]|(?:第|文献|论文|paper\s*)(\d+)|#(\d+)|[（(](\d+)[)）]/gi;
    const parts: (string | React.ReactElement)[] = [];
    let lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      const fullMatch = match[0];
      // Extract all numbers from the match
      const nums: number[] = [];
      const numContent = match[1] || match[2] || match[3] || match[4];
      if (numContent) {
        // Handle ranges like "1-3"
        const rangeMatch = numContent.match(/(\d+)\s*[-–]\s*(\d+)/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1]);
          const end = parseInt(rangeMatch[2]);
          for (let n = start; n <= end; n++) nums.push(n);
        } else {
          numContent.split(/[,，]\s*/).forEach((s) => {
            const n = parseInt(s.trim());
            if (!isNaN(n)) nums.push(n);
          });
        }
      }

      if (nums.length > 0 && nums.every((n) => n >= 1 && n <= displayedPapers.length)) {
        // Build clickable version
        if (match[1]) {
          // [1,2,3] format — wrap the whole bracket
          const links = nums.map((n, li) => (
            <span key={`${match!.index}-${n}`}>
              {li > 0 && ", "}
              <button
                className="text-teal font-bold hover:underline cursor-pointer"
                onClick={() => jumpToPaper(n)}
                title={displayedPapers[n - 1]?.title}
              >
                {n}
              </button>
            </span>
          ));
          parts.push(<span key={match.index}>[{links}]</span>);
        } else {
          // Other patterns — make the number part clickable
          const prefix = fullMatch.replace(/\d+/, "");
          const n = nums[0];
          parts.push(
            <span key={match.index}>
              {prefix.replace(/\d/g, "")}
              <button
                className="text-teal font-bold hover:underline cursor-pointer"
                onClick={() => jumpToPaper(n)}
                title={displayedPapers[n - 1]?.title}
              >
                {n}
              </button>
            </span>
          );
        }
      } else {
        parts.push(fullMatch);
      }

      lastIndex = match.index + fullMatch.length;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  }

  // ─── Search history handlers (used by SearchHistoryPanel) ───
  function resetConversation() {
    setActiveSearchId(`new-${Date.now()}`);
    setPapers([]);
    setMeta(null);
    setSearchPlan(null);
    setSearchStats(null);
    setSearchOverview(null);
    setQuery("");
    setError(null);
    setAnalysisResult(null);
    setSelectedPapers(new Set());
    setSearchBatches([]);
    setPaperBatchMap(new Map());
    setFilterBatch("all");
    setSearchMode(true);
  }

  async function handleSelectHistory(h: SearchHistoryItem) {
    try {
      setActiveSearchId(h.id);

      // Load search record + chat history in parallel
      const [searchRes, chatRes] = await Promise.all([
        fetch(`/api/search-history?id=${h.id}`),
        fetch(`/api/chat-history?projectId=${projectId}&query=${encodeURIComponent(h.query)}`),
      ]);
      const data = await searchRes.json();
      const rec = data.record;
      if (!rec) return;

      setQuery(rec.query);
      if (rec.papers) {
        setPapers(rec.papers as Paper[]);
      }
      if (rec.keyTerms || rec.synonyms || rec.precisionQueries || rec.broadQueries || rec.filters) {
        setSearchPlan({
          translatedInput: rec.translatedQuery ?? undefined,
          keyTerms: (rec.keyTerms as string[]) ?? [],
          synonyms: (rec.synonyms as Record<string, string[]>) ?? {},
          precisionQueries: (rec.precisionQueries as string[]) ?? [],
          broadQueries: (rec.broadQueries as string[]) ?? [],
          filters: (rec.filters as SearchFilters) ?? {},
        });
      }
      if (rec.stats) {
        setSearchStats(rec.stats as SearchStats);
      }
      setMeta({
        total: rec.paperCount ?? 0,
        sources: [],
      });

      // Restore chat history from DB
      const chatData = await chatRes.json().catch(() => ({ messages: [] }));
      if (chatData.messages?.length > 0) {
        setAllChats(prev => ({ ...prev, [h.id]: chatData.messages }));
      }
    } catch {
      toast.error("加载检索记录失败，请重试");
      setQuery(h.query);
    }
  }

  async function handleDeleteHistory(h: SearchHistoryItem) {
    if (!window.confirm(`确定删除对话记录「${h.query.slice(0, 30)}${h.query.length > 30 ? "…" : ""}」？\n关联的检索结果和 AI 对话将一并删除，且不可恢复。`)) return;
    const deletedQuery = h.query;
    // 1. Delete from DB first (search history + associated chat history).
    //    Local copy is only removed after DB confirms — keeps the two in sync.
    //    Records with a local-only id ("new-...") were never saved to DB.
    if (!h.id.startsWith("new-")) {
      try {
        const [resSearch, resChat] = await Promise.all([
          fetch(`/api/search-history?id=${h.id}`, { method: "DELETE" }),
          fetch(`/api/chat-history?projectId=${projectId}&query=${encodeURIComponent(deletedQuery)}`, { method: "DELETE" }),
        ]);
        if (!resSearch.ok || !resChat.ok) {
          toast.error("数据库删除失败，请稍后重试");
          return;
        }
      } catch {
        toast.error("删除检索记录失败，请检查网络");
        return;
      }
    }
    // 2. Remove from local search history + clean up its chat
    setSearchHistory((prev) => prev.filter((x) => x.id !== h.id));
    setAllChats(prev => { const u = { ...prev }; delete u[h.id]; return u; });
    toast.success("对话记录已删除");
    // 3. If deleted query matches current active query, clear everything
    if (query === deletedQuery || query === h.translatedQuery) {
      setActiveSearchId(`new-${Date.now()}`);
      setPapers([]);
      setMeta(null);
      setSearchPlan(null);
      setSearchStats(null);
      setSearchOverview(null);
      setSearchProgress([]);
      setQuery("");
      setError(null);
      setAnalysisResult(null);
      setSelectedPapers(new Set());
      setSearchBatches([]);
      setPaperBatchMap(new Map());
      setFilterBatch("all");
    }
  }

  // Cite popup — fetch all citation styles for a paper (shared across cards)
  async function handleCiteToggle(paper: Paper) {
    if (citePopup === paper.title) { setCitePopup(null); return; }
    setCitePopup(paper.title);
    setCiteData(null);
    setCiteLoading(true);
    try {
      const res = await fetch("/api/papers/cite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paper: { title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, doi: paper.doi },
          allStyles: true,
        }),
      });
      const data = await res.json();
      if (data.citations) setCiteData(data.citations);
      else setCiteData(null);
    } catch {
      setCiteData(null);
    } finally {
      setCiteLoading(false);
    }
  }


  return (
    <div ref={containerRef} className="flex gap-4 overflow-hidden" style={{ height: "calc(100vh - 100px)" }}>
      {/* Left: Search History Panel */}
      <SearchHistoryPanel
        collapsed={historyCollapsed}
        onSetCollapsed={setHistoryCollapsed}
        searchHistory={searchHistory}
        activeSearchId={activeSearchId}
        onNewConversation={resetConversation}
        onSelectHistory={handleSelectHistory}
        onDeleteHistory={handleDeleteHistory}
      />

      {/* Center: Unified Chat Interface */}
      <div className="shrink-0 min-w-0 flex flex-col" style={{ width: leftPanelWidth, height: "calc(100vh - 100px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between pb-3 shrink-0">
        <div>
          <h1 className="font-heading text-xl font-bold">
            文献检索
          </h1>
          <p className="text-muted-foreground text-xs">
            多源聚合搜索 · AI 深度问答
          </p>
        </div>
        {/* Provider fixed to deepseek-fast — hidden from UI */}
      </div>

      {/* Unified Chat Area */}
      <div ref={chatPanelRef} className="flex-1 flex flex-col border border-border/50 rounded-lg bg-card overflow-hidden scroll-mt-16">
        {/* Chat toolbar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs text-muted-foreground">学术检索</span>
              <button
                onClick={() => setSearchMode(v => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors ${searchMode ? "bg-teal" : "bg-muted-foreground/30"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${searchMode ? "translate-x-4" : ""}`} />
              </button>
            </label>
            {searchMode && (
              <>
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={enableRelevance} onChange={(e) => setEnableRelevance(e.target.checked)} className="accent-teal w-3 h-3" />
                  AI 打分
                </label>
                <select
                  value={searchLimit}
                  onChange={(e) => setSearchLimit(Number(e.target.value))}
                  className="h-7 px-2 text-xs border border-input rounded bg-background text-foreground cursor-pointer"
                >
                  <option value={20}>20篇（顶刊）</option>
                  <option value={50}>50篇（顶刊+Q2）</option>
                  <option value={100}>100篇（不限刊）</option>
                  <option value={999}>不限量</option>
                </select>
                <select
                  value={journalLang}
                  onChange={(e) => setJournalLang(e.target.value as "en" | "zh")}
                  className="h-7 px-2 text-xs border border-input rounded bg-background text-foreground cursor-pointer"
                >
                  <option value="en">英文期刊</option>
                  <option value="zh">中文期刊</option>
                </select>
                {journalLang === "zh" && (
                  <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                    由于无法直连 CNKI，中文文献存在较大缺失，仅通过 Google Scholar / OpenAlex / S2 检索
                  </span>
                )}
                <button
                  onClick={() => setJournalFilterOpen((v) => !v)}
                  className={`h-5 px-1.5 text-[10px] border rounded transition-colors ${
                    journalFilters.length > 0
                      ? "border-teal text-teal bg-teal/5"
                      : "border-input text-muted-foreground bg-background"
                  }`}
                >
                  期刊过滤{journalFilters.length > 0 ? ` (${journalFilters.length})` : ""}
                </button>
                <button
                  onClick={() => { setRefSearchOpen((v) => !v); setJournalFilterOpen(false); }}
                  className={`h-5 px-1.5 text-[10px] border rounded transition-colors ${
                    refSearchOpen
                      ? "border-indigo-400 text-indigo-600 bg-indigo-50"
                      : "border-input text-muted-foreground bg-background"
                  }`}
                >
                  参考文献检索
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {papers.length > 0 && (
              <span className="text-[10px] text-muted-foreground">{papers.length} 篇文献</span>
            )}
            {chatMessages.length > 0 && (
              <button
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => {
                  setChatMessages([]);
                  setPapers([]);
                  setMeta(null);
                  setSearchPlan(null);
                  setSearchStats(null);
                  setSearchOverview(null);
                  setSearchProgress([]);
                }}
              >
                清空对话
              </button>
            )}
          </div>
        </div>

        {/* Idea context banner */}
        {ideaContext && (
          <div className="border-b border-blue-200 px-3 py-2 bg-blue-50/50 flex items-center justify-between">
            <span className="text-xs text-blue-700">
              📋 已导入研究想法上下文 — AI 对话将自动关联该想法分析文献
            </span>
            <button onClick={() => setIdeaContext(null)} className="text-xs text-blue-400 hover:text-blue-600">&times; 关闭</button>
          </div>
        )}

        {/* Journal filter panel (collapsible) */}
        {journalFilterOpen && (
          <div className="border-b border-border/50 px-3 py-2 bg-muted/30 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-foreground">模式：</span>
              <button
                onClick={() => switchFilterMode("blacklist")}
                className={`text-[10px] px-2 py-0.5 rounded ${journalFilterMode === "blacklist" ? "bg-red-500 text-white" : "bg-muted text-muted-foreground"}`}
              >
                黑名单
              </button>
              <button
                onClick={() => switchFilterMode("whitelist")}
                className={`text-[10px] px-2 py-0.5 rounded ${journalFilterMode === "whitelist" ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}
              >
                白名单
              </button>
              <span className="text-[10px] text-muted-foreground mx-1">|</span>
              <button onClick={() => loadPreset("ft50")} disabled={journalFilterLoading} className="text-[10px] px-1.5 py-0.5 rounded border border-amber-300 text-amber-600 hover:bg-amber-50">FT50</button>
              <button onClick={() => loadPreset("utd24")} disabled={journalFilterLoading} className="text-[10px] px-1.5 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50">UTD24</button>
              <button onClick={() => loadPreset("abs4star")} disabled={journalFilterLoading} className="text-[10px] px-1.5 py-0.5 rounded border border-purple-300 text-purple-600 hover:bg-purple-50">ABS 4*</button>
              <span className="text-[10px] text-muted-foreground mx-1">|</span>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleCsvUpload}
                className="hidden"
              />
              <button onClick={() => csvInputRef.current?.click()} disabled={journalFilterLoading} className="text-[10px] px-1.5 py-0.5 rounded border border-input text-muted-foreground hover:bg-muted">
                上传 CSV
              </button>
              {journalFilters.length > 0 && (
                <button onClick={clearJournalFilters} className="text-[10px] px-1.5 py-0.5 rounded text-red-500 hover:bg-red-50">
                  清空全部
                </button>
              )}
            </div>
            {/* Add journal manually */}
            <div className="flex gap-1">
              <input
                value={journalFilterInput}
                onChange={(e) => setJournalFilterInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && journalFilterInput.trim()) {
                    addJournalFilter([journalFilterInput.trim()]);
                    setJournalFilterInput("");
                  }
                }}
                placeholder="输入期刊名称，按回车添加"
                className="flex-1 h-6 px-2 text-[11px] border border-input rounded bg-background"
              />
            </div>
            {/* Current filter list */}
            {journalFilters.length > 0 && (
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {journalFilters.map((f) => (
                  <span key={f.id} className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded ${
                    f.filterType === "blacklist" ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}>
                    {f.journalName.length > 30 ? f.journalName.slice(0, 30) + "..." : f.journalName}
                    <button onClick={() => removeJournalFilter(f.id)} className="text-current hover:opacity-60 ml-0.5">&times;</button>
                  </span>
                ))}
              </div>
            )}
            {journalFilterLoading && <div className="text-[10px] text-muted-foreground">加载中...</div>}
          </div>
        )}

        {/* Reference search panel (collapsible) */}
        {refSearchOpen && (
          <div className="border-b border-border/50 px-3 py-2 bg-indigo-50/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">粘贴参考文献列表（支持 APA/MLA/Chicago/Vancouver 等格式）</span>
              {refSearchResult && (
                <span className="text-[10px] text-indigo-600">
                  找到 {refSearchResult.stats.found}/{refSearchResult.stats.total} 篇
                </span>
              )}
            </div>
            <textarea
              value={refSearchInput}
              onChange={(e) => setRefSearchInput(e.target.value)}
              placeholder={"1. Smith, J. (2020). Digital transformation and organizational resilience. Journal of Management, 46(3), 123-145.\n2. Zhang, W., & Lee, K. (2021). AI adoption in healthcare. MIS Quarterly, 45(2), 567-589.\n...\n\n粘贴完整参考文献列表，AI 将自动提取标题并逐篇检索"}
              className="w-full h-28 px-2 py-1.5 text-[11px] border border-input rounded bg-background resize-y font-mono leading-relaxed"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleRefSearch}
                disabled={refSearching || !refSearchInput.trim()}
                className="text-[11px] px-3 py-1 rounded bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors"
              >
                {refSearching ? "检索中..." : "开始批量检索"}
              </button>
              {refSearching && (
                <button onClick={() => refAbort.abort()} className="text-[10px] px-2 py-0.5 rounded border border-red-300 text-red-500 hover:bg-red-50">
                  停止
                </button>
              )}
              {refSearchResult && refSearchResult.stats.notFound > 0 && (
                <span className="text-[10px] text-amber-600">
                  {refSearchResult.stats.notFound} 篇未找到
                </span>
              )}
            </div>
            {/* Not-found list */}
            {refSearchResult && refSearchResult.stats.notFound > 0 && (
              <div className="text-[10px] text-muted-foreground space-y-0.5 max-h-20 overflow-y-auto">
                {refSearchResult.matchResults.filter((r) => !r.found).map((r, i) => (
                  <div key={i} className="pl-2 border-l-2 border-amber-300">
                    {r.queryTitle}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.length === 0 && (
            <div className="text-center py-8 space-y-4">
              <p className="text-sm text-muted-foreground">
                {searchMode
                  ? "输入研究主题，AI 将自动检索相关文献"
                  : papers.length > 0
                    ? `基于已检索到的 ${papers.length} 篇文献，你可以问任何问题`
                    : "请先开启「学术检索」检索文献，再关闭开关进行深度问答"
                }
              </p>
              {!searchMode && papers.length > 0 && (
                <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1.5 max-w-md mx-auto">
                  提示：在提问中引用文献编号（如 [1]、[3,5]），AI 将自动获取该论文全文进行深度分析
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {searchMode ? [
                  "ESG disclosure and corporate financial performance, ABS3星以上",
                  "digital transformation and organizational resilience",
                  "supply chain disruption risk management, 2020年以后",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    className="text-xs px-3 py-1.5 rounded-full border border-teal/30 text-teal hover:bg-teal/5 transition-colors"
                    onClick={() => { setChatInput(suggestion); setTimeout(() => chatInputRef.current?.focus(), 50); }}
                  >
                    {suggestion}
                  </button>
                )) : [
                  "这些文献的核心研究主题有哪些？",
                  "哪些文献的方法论最值得借鉴？",
                  "这个领域的研究空白是什么？",
                  "请比较引用量最高的三篇文献",
                  "这些文献涉及哪些理论框架？",
                  "深入分析 [1] 的研究方法和数据来源",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    className="text-xs px-3 py-1.5 rounded-full border border-teal/30 text-teal hover:bg-teal/5 transition-colors"
                    onClick={() => { setChatInput(suggestion); setTimeout(() => chatInputRef.current?.focus(), 50); }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {chatMessages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-md bg-teal/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] text-teal font-bold">AI</span>
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-teal text-teal-foreground"
                    : "bg-muted/60 text-foreground"
                }`}
              >
                {/* Collapsible thinking process */}
                {msg.thinking && (
                  <details className="mb-2 group">
                    <summary className="text-[10px] text-muted-foreground cursor-pointer select-none list-none flex items-center gap-1 hover:text-foreground">
                      <span className="transition-transform group-open:rotate-90 text-amber-500">▶</span>
                      <span className="text-amber-600 font-medium">思考过程</span>
                      <span className="text-muted-foreground/50 ml-1">({msg.thinking.length} 字)</span>
                    </summary>
                    <div className="mt-1.5 p-2 rounded bg-amber-50/50 border border-amber-200/30 text-[11px] text-amber-800/80 leading-relaxed max-h-48 overflow-y-auto">
                      <pre className="whitespace-pre-wrap font-sans m-0">{msg.thinking}</pre>
                    </div>
                  </details>
                )}
                <pre className="whitespace-pre-wrap font-sans m-0">
                  {msg.role === "assistant" && msg.content
                    ? renderChatContent(msg.content)
                    : (msg.content || "")}
                </pre>
                {chatStreaming && idx === chatMessages.length - 1 && msg.role === "assistant" && (
                  <span className="inline-block w-1.5 h-4 bg-teal/60 animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-6 h-6 rounded-md bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold">你</span>
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Unified input bar */}
        <div className="border-t border-border/50 p-3 flex gap-2 items-end shrink-0">
          <textarea
            ref={chatInputRef}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleUnifiedSend();
              }
            }}
            placeholder={searchMode ? "输入研究主题，如：ESG disclosure and firm performance，ABS3星以上" : "输入问题，对检索文献进行深入分析..."}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal/50 placeholder:text-muted-foreground/60"
            style={{ minHeight: "38px", maxHeight: "120px" }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "38px";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          {chatStreaming ? (
            <StopButton show={true} onClick={() => chatAbort.abort()} label="停止回答" size="default" />
          ) : loading ? (
            <StopButton show={true} onClick={() => { searchManager.abort(); setLoading(false); }} label="停止检索" size="default" />
          ) : (
            <Button
              size="sm"
              disabled={!chatInput.trim()}
              onClick={handleUnifiedSend}
              className="bg-teal text-teal-foreground hover:bg-teal/90 h-[38px] px-4 shrink-0"
            >
              {searchMode ? "检索 ~120s" : "发送"}
            </Button>
          )}
        </div>
      </div>

      </div>

      {/* Draggable Divider */}
      <div
        className="shrink-0 w-1.5 cursor-col-resize group relative select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
        <div className="w-0.5 h-full mx-auto bg-border/40 group-hover:bg-teal/50 group-active:bg-teal transition-colors rounded-full" />
      </div>

      {/* Right: Results Panel */}
      <div className="flex-1 min-w-0 space-y-4 overflow-y-auto" style={{ height: "calc(100vh - 100px)" }}>

      {/* Google Scholar unavailable warning */}
      {searchStats && (searchStats as unknown as Record<string, unknown>).googleScholarAvailable === false && (
        <div className="flex items-center gap-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs">
          <span className="font-medium text-amber-700">⚠ Google Scholar 不可用</span>
          <span className="text-amber-600">
            SerpAPI 额度已用完，当前仅使用 Semantic Scholar + OpenAlex 检索。引用数和摘要可能不完整。
          </span>
        </div>
      )}

      {/* Relevance scoring stats */}
      {searchStats?.relevanceScored && (
        <div className="flex items-center gap-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs flex-wrap">
          <span className="font-medium text-emerald-700">AI 相关性评估完成</span>
          <span className="text-emerald-600">
            检索到 {searchStats.totalBeforeRelevance} 篇 → 经AI评估保留 {searchStats.total} 篇相关文献
          </span>
          <span className="text-emerald-500">
            用时 {(searchStats.durationMs / 1000).toFixed(1)}s
          </span>
          {/* Full-text stats removed — full text is fetched on demand, not during search */}
        </div>
      )}

      {/* Controls bar */}
      {papers.length > 0 && (
        <ResultsToolbar
          papersCount={papers.length}
          displayedCount={displayedPapers.length}
          meta={meta}
          searchStats={searchStats}
          searchPlan={searchPlan}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          filterRankings={filterRankings}
          setFilterRankings={setFilterRankings}
          searchBatches={searchBatches}
          filterBatch={filterBatch}
          onFilterBatchChange={setFilterBatch}
          analyzing={analyzing}
          onAnalyze={handleAnalyze}
          onStopAnalyze={() => analyzeAbort.abort()}
        />
      )}

      {/* AI Analysis Result */}
      {(analysisResult || analyzing) && (
        <Card className="border-teal/20 bg-teal/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              AI 分析结果
              {analyzing && (
                <span className="text-xs text-muted-foreground animate-pulse">
                  正在分析 {displayedPapers.length} 篇文献（{currentAnalysisType === "variables" ? "提取变量" : currentAnalysisType === "review" ? "生成综述" : "生成想法"}）...
                </span>
              )}
              <Badge variant="secondary" className="text-xs ml-auto">
                {
                  ({
                    "gemini-pro": "Gemini 3.1 Pro",
                    gemini: "Gemini 2.5 Flash",
                    "gemini-flash": "Gemini 2.5 Flash",
                    chatgpt: "GPT-4o",
                    deepseek: "DeepSeek Reasoning",
                    claude: "Claude Sonnet 4",
                  } as Record<string, string>)[aiProvider]
                }
              </Badge>
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            <AnalysisResultView content={analysisResult} papers={displayedPapers} onScrollToPaper={scrollToPaperCard} />
          </CardContent>
        </Card>
      )}

      {/* AI Analysis History */}
      {analysisHistory.length > 0 && (
        <Card className="border-border/50">
          <CardHeader
            className="pb-2 py-3 cursor-pointer"
            onClick={() => setHistoryPanelOpen(v => !v)}
          >
            <CardTitle className="text-sm flex items-center gap-2">
              AI 分析记录
              <Badge variant="secondary" className="text-xs">{analysisHistory.length} 条</Badge>
              <span className="ml-auto text-xs text-muted-foreground">{historyPanelOpen ? "▲" : "▼"}</span>
            </CardTitle>
          </CardHeader>
          {historyPanelOpen && (
            <>
              <Separator />
              <CardContent className="pt-3 space-y-3">
                {analysisHistory.map((r, i) => (
                  <div key={i} className="border border-border/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className="text-[10px] h-5">
                        {r.type === "variables" ? "提取变量" : r.type === "review" ? "生成综述" : "生成想法"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{r.paperCount} 篇</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(r.timestamp).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-2 mb-1.5">
                      {r.content.slice(0, 120).replace(/[{}"[\]]/g, " ")}...
                    </div>
                    <button
                      className="text-xs text-teal hover:underline"
                      onClick={() => { setAnalysisResult(r.content); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    >
                      查看完整结果 →
                    </button>
                  </div>
                ))}
              </CardContent>
            </>
          )}
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Search progress panel (live + completed summary) */}
      <SearchProgressPanel
        loading={loading}
        searchProgress={searchProgress}
        progressOpen={progressOpen}
        onToggleOpen={() => setProgressOpen(!progressOpen)}
        onStop={() => { searchManager.abort(); setLoading(false); }}
      />

      {/* Selection bar */}
      {!loading && displayedPapers.length > 0 && selectedPapers.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-teal/5 border border-teal/20 rounded-lg text-sm">
          <span className="font-medium text-teal">
            已选 {selectedPapers.size} 篇
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs bg-teal/10 text-teal border-teal/30"
            onClick={async () => {
              const selected = displayedPapers.filter((_, idx) => selectedPapers.has(idx));
              let saved = 0;
              for (const p of selected) {
                try {
                  const res = await fetch("/api/papers", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      projectId,
                      title: p.title, abstract: p.abstract, authors: p.authors,
                      year: p.year, venue: p.venue, citationCount: p.citationCount,
                      doi: p.doi, source: p.source,
                      pdfUrl: p.openAccessPdf || p.unpaywallUrl,
                      openAccessPdf: p.openAccessPdf,
                    }),
                  });
                  if (res.ok) {
                    saved++;
                    setSavedPaperKeys((prev) => new Set([...prev, p.doi || p.title]));
                  }
                } catch { /* skip */ }
              }
              if (saved < selected.length) {
                toast.error(`${selected.length - saved} 篇保存失败，请重试`);
              }
              alert(`已添加 ${saved} 篇到文献库`);
            }}
          >
            批量添加到文献库
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedPapers(new Set())}>
            清除选择
          </Button>
        </div>
      )}

      {/* Results */}
      {!loading && displayedPapers.length > 0 && (
        <div className="space-y-2">
          {/* Select all */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={selectedPapers.size === displayedPapers.length && displayedPapers.length > 0}
              onChange={selectAll}
              className="accent-teal"
            />
            <span>全选</span>
          </div>
          {displayedPapers.slice(0, visibleCount).map((paper, i) => (
            <PaperCard
              key={i}
              paper={paper}
              index={i}
              projectId={projectId}
              selected={selectedPapers.has(i)}
              onToggleSelect={() => togglePaper(i)}
              relevanceScored={!!searchStats?.relevanceScored}
              saved={savedPaperKeys.has(paper.doi || paper.title)}
              onMarkSaved={(key) => setSavedPaperKeys((prev) => new Set([...prev, key]))}
              fullTextPanel={fullTextPanel?.paperIndex === i ? fullTextPanel : null}
              setFullTextPanel={setFullTextPanel}
              citeOpen={citePopup === paper.title}
              citeData={citeData}
              citeLoading={citeLoading}
              onCiteToggle={() => handleCiteToggle(paper)}
              onCiteClose={() => setCitePopup(null)}
              onJumpToChat={() => chatPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
            />
          ))}
          {/* Windowed rendering sentinel — bumps visible count by 50 when scrolled into view */}
          {visibleCount < displayedPapers.length && (
            <div ref={sentinelRef} className="py-3 text-center text-xs text-muted-foreground">
              已显示 {visibleCount} / {displayedPapers.length} 篇 · 向下滚动加载更多
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && displayedPapers.length === 0 && meta && (
        <div className="text-center py-12 text-muted-foreground">
          {filterRankings.size > 0
            ? `无匹配 ${Array.from(filterRankings).join("/")} 的文献，尝试调整筛选`
            : "未找到相关文献，请尝试其他关键词"}
        </div>
      )}
      </div>
    </div>
  );
}
