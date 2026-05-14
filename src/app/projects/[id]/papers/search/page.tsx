"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { searchManager, type SearchJobState } from "@/lib/search-manager";
import { consumeCrossFeatureData } from "@/lib/cross-feature";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AIProvider,
} from "@/components/ai-provider-select";
import { useAbort } from "@/hooks/use-abort";
import { StopButton } from "@/components/stop-button";

interface Author {
  name: string;
}

interface JournalBadges {
  ft50: boolean;
  utd24: boolean;
  abs4star: boolean;
  badges: string[];
}

interface JournalMeta {
  impactFactor?: number;
  sjrQuartile?: string;
  jcrQuartile?: string;
  absRating?: string;
  abdcRating?: string;
  ccfRating?: string;
  ssci: boolean;
  sci: boolean;
  cssci: boolean;
  pkuCore: boolean;
  fms: boolean;
  casZone?: string;
}

interface Paper {
  title: string;
  abstract?: string;
  authors: Author[];
  year?: number;
  venue?: string;
  citationCount: number;
  doi?: string;
  source: string;
  openAccessPdf?: string;
  unpaywallUrl?: string;
  connectedPapersUrl?: string;
  journalRanking?: JournalBadges;
  journalMeta?: JournalMeta;
  relevanceScore?: number;
  relevanceReason?: string;
  relevanceKeyMatch?: string[];
  relevanceContribution?: string;
  relevanceMethodology?: string;
  relevanceInnovation?: string;
  relevanceDataSource?: string;
  hasFullText?: boolean;
}

interface SearchMeta {
  total: number;
  sources: Array<{ source: string; count: number }>;
}

interface SearchStats {
  total: number;
  totalBeforeFilter: number;
  totalBeforeRelevance: number;
  byQuery: Record<string, number>;
  durationMs: number;
  relevanceScored: boolean;
  withFullText?: number;
  withAbstractOnly?: number;
}

type SortBy = "citations" | "year_desc" | "year_asc" | "relevance";

interface SearchFilters {
  minABS?: string;
  minCASZone?: string;
  minJCR?: string;
  minCCF?: string;
  requireSSCI?: boolean;
  requireSCI?: boolean;
  requireCSSCI?: boolean;
  requirePKUCore?: boolean;
  requireFMS?: boolean;
  requireHighQuality?: boolean;
  minIF?: number;
  minCitations?: number;
  yearFrom?: number;
  yearTo?: number;
  requireUTD24?: boolean;
  requireFT50?: boolean;
}

interface SearchPlan {
  translatedInput?: string;
  queryIntent?: "TOPICAL" | "RELATIONAL" | "METHODOLOGICAL" | "REVIEW";
  keyTerms: string[];
  synonyms: Record<string, string[]>;
  precisionQueries: string[];
  broadQueries: string[];
  filters: SearchFilters;
}

const sourceLabels: Record<string, string> = {
  semantic_scholar: "Semantic Scholar",
  openalex: "OpenAlex",
  google_scholar: "Google Scholar",
};

const sourceColors: Record<string, string> = {
  semantic_scholar: "bg-blue-100 text-blue-800",
  openalex: "bg-green-100 text-green-800",
  google_scholar: "bg-orange-100 text-orange-800",
};

const rankingColors: Record<string, string> = {
  // Top-tier lists
  UTD24: "bg-red-600 text-white",
  FT50: "bg-amber-500 text-white",
  FMS: "bg-rose-500 text-white",
  // Indexing
  SSCI: "bg-blue-600 text-white",
  SCI: "bg-cyan-600 text-white",
  CSSCI: "bg-blue-500 text-white",
  "北大核心": "bg-blue-400 text-white",
  // JCR分区
  "JCR Q1": "bg-emerald-600 text-white",
  "JCR Q2": "bg-emerald-500 text-white",
  "JCR Q3": "bg-yellow-600 text-white",
  "JCR Q4": "bg-gray-400 text-white",
  // SJR分区
  "SJR Q1": "bg-teal-600 text-white",
  "SJR Q2": "bg-teal-500 text-white",
  "SJR Q3": "bg-yellow-500 text-white",
  "SJR Q4": "bg-gray-400 text-white",
  // ABS
  "ABS 4*": "bg-purple-700 text-white",
  "ABS 4": "bg-purple-600 text-white",
  "ABS 3": "bg-indigo-500 text-white",
  "ABS 2": "bg-sky-500 text-white",
  "ABS 1": "bg-slate-400 text-white",
  // ABDC
  "ABDC A*": "bg-violet-700 text-white",
  "ABDC A": "bg-violet-500 text-white",
  "ABDC B": "bg-violet-400 text-white",
  "ABDC C": "bg-violet-300 text-white",
  // CCF
  "CCF A": "bg-orange-600 text-white",
  "CCF B": "bg-orange-500 text-white",
  "CCF C": "bg-orange-400 text-white",
  // 中科院分区
  "中科院一区": "bg-red-700 text-white",
  "中科院二区": "bg-orange-600 text-white",
  "中科院三区": "bg-sky-600 text-white",
  "中科院四区": "bg-gray-400 text-white",
  // Conferences
  "Top会议": "bg-rose-600 text-white",
  "A会议": "bg-pink-500 text-white",
  "B会议": "bg-pink-400 text-white",
  // Preprints
  "预印本": "bg-gray-500 text-white",
};

// ─── Variable Relation Visualization ─────────────────────────
interface VariableRelation {
  independentVar: string;
  dependentVar: string;
  mediators?: string[];
  moderators?: string[];
  direction?: string;
  effectSize?: string;
  sampleContext?: string;
  sources?: number[];
}

const directionColors: Record<string, string> = {
  positive: "text-emerald-600 bg-emerald-50 border-emerald-200",
  negative: "text-red-600 bg-red-50 border-red-200",
  mixed: "text-amber-600 bg-amber-50 border-amber-200",
  nonsignificant: "text-gray-500 bg-gray-50 border-gray-200",
};

const directionLabels: Record<string, string> = {
  positive: "正向",
  negative: "负向",
  mixed: "混合",
  nonsignificant: "不显著",
};

function AnalysisResultView({ content, papers }: { content: string | null; papers?: Paper[] }) {
  if (!content) return null;

  // Try to parse as JSON with relations
  try {
    const parsed = JSON.parse(content);
    if (parsed.relations && Array.isArray(parsed.relations)) {
      return <RelationsView relations={parsed.relations} papers={papers} />;
    }
    // Other JSON structures — render as formatted text
    if (typeof parsed === "object") {
      return (
        <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap leading-relaxed">
          {JSON.stringify(parsed, null, 2)}
        </div>
      );
    }
  } catch {
    // Not JSON — render as plain text (possibly markdown-like)
  }

  return (
    <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap leading-relaxed">
      {content}
    </div>
  );
}

function RelationsView({ relations, papers }: { relations: VariableRelation[]; papers?: Paper[] }) {
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  function scrollToPaper(index: number) {
    // Paper indices are 1-based in the LLM output
    const paperEl = document.querySelector(`[data-paper-index="${index - 1}"]`);
    if (paperEl) {
      paperEl.scrollIntoView({ behavior: "smooth", block: "center" });
      paperEl.classList.add("ring-2", "ring-teal", "ring-offset-2");
      setTimeout(() => paperEl.classList.remove("ring-2", "ring-teal", "ring-offset-2"), 3000);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground mb-2">
        共提取 {relations.length} 组变量关系
      </div>
      {relations.map((rel, i) => {
        const dirClass = directionColors[rel.direction ?? ""] ?? "text-gray-600 bg-gray-50 border-gray-200";
        const dirLabel = directionLabels[rel.direction ?? ""] ?? rel.direction ?? "未知";
        const sourceKey = `rel-${i}`;

        return (
          <div key={i} className="border border-border/60 rounded-lg p-3 bg-card hover:shadow-sm transition-shadow">
            {/* Main relationship: IV → DV */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs font-medium border border-emerald-200">
                IV: {rel.independentVar}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${dirClass}`}>
                {dirLabel === "正向" ? "→ +" : dirLabel === "负向" ? "→ −" : "→ ?"} {dirLabel}
              </span>
              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-medium border border-blue-200">
                DV: {rel.dependentVar}
              </span>
              {/* Source paper badges */}
              {rel.sources && rel.sources.length > 0 && (
                <span className="ml-auto flex items-center gap-1">
                  {rel.sources.map((src) => (
                    <button
                      key={src}
                      onClick={() => scrollToPaper(src)}
                      className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-medium border border-gray-300 hover:bg-teal/10 hover:text-teal hover:border-teal/30 transition-colors cursor-pointer"
                      title={papers && papers[src - 1] ? papers[src - 1].title : `Paper [${src}]`}
                    >
                      [{src}]
                    </button>
                  ))}
                </span>
              )}
            </div>

            {/* Mediators & Moderators */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rel.mediators && rel.mediators.length > 0 && rel.mediators.map((m, j) => (
                <span key={`med-${j}`} className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] border border-amber-200">
                  中介: {m}
                </span>
              ))}
              {rel.moderators && rel.moderators.length > 0 && rel.moderators.map((m, j) => (
                <span key={`mod-${j}`} className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px] border border-purple-200">
                  调节: {m}
                </span>
              ))}
            </div>

            {/* Effect size & Sample context */}
            {(rel.effectSize || rel.sampleContext) && (
              <div className="mt-1.5 text-[10px] text-muted-foreground flex gap-3">
                {rel.effectSize && <span>效应量: {rel.effectSize}</span>}
                {rel.sampleContext && <span>样本: {rel.sampleContext}</span>}
              </div>
            )}

            {/* Expandable source details */}
            {rel.sources && rel.sources.length > 0 && papers && (
              <div className="mt-1.5">
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => setExpandedSource(expandedSource === sourceKey ? null : sourceKey)}
                >
                  {expandedSource === sourceKey ? "收起来源" : `查看来源 (${rel.sources.length} 篇)`}
                </button>
                {expandedSource === sourceKey && (
                  <div className="mt-1 space-y-1">
                    {rel.sources.map((src) => {
                      const paper = papers[src - 1];
                      if (!paper) return null;
                      return (
                        <div
                          key={src}
                          className="text-[10px] pl-2 border-l-2 border-teal/30 cursor-pointer hover:bg-teal/5 rounded-r py-0.5"
                          onClick={() => scrollToPaper(src)}
                        >
                          <span className="font-medium text-teal">[{src}]</span>{" "}
                          <span className="text-foreground/80">{paper.title}</span>
                          <span className="text-muted-foreground ml-1">
                            ({paper.year ?? "N/A"}{paper.venue ? ` — ${paper.venue}` : ""})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function sortPapers(papers: Paper[], sortBy: SortBy): Paper[] {
  const sorted = [...papers];
  switch (sortBy) {
    case "citations":
      return sorted.sort((a, b) => b.citationCount - a.citationCount);
    case "year_desc":
      return sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    case "year_asc":
      return sorted.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
    case "relevance":
    default:
      return sorted.sort(
        (a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)
      );
  }
}

function getRelevanceColor(score: number): string {
  if (score >= 8) return "text-emerald-600 bg-emerald-50 border-emerald-200";
  if (score >= 6) return "text-blue-600 bg-blue-50 border-blue-200";
  if (score >= 4) return "text-amber-600 bg-amber-50 border-amber-200";
  return "text-gray-500 bg-gray-50 border-gray-200";
}

function getRelevanceLabel(score: number): string {
  if (score >= 9) return "完全匹配";
  if (score >= 7) return "高度相关";
  if (score >= 5) return "一般相关";
  if (score >= 3) return "边缘相关";
  return "不相关";
}

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
  const [searchHistory, setSearchHistory] = usePersistedState<Array<{
    id: string;
    query: string;
    translatedQuery?: string;
    keyTerms?: string[];
    paperCount: number;
    provider?: string;
    createdAt: string;
  }>>(NS, "searchHistory", []);
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
    } catch { /* skip */ }
    setJournalFilterLoading(false);
  }

  async function removeJournalFilter(filterId: string) {
    await fetch("/api/papers/journal-filter", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, filterId }),
    });
    setJournalFilters((prev) => prev.filter((f) => f.id !== filterId));
  }

  async function clearJournalFilters() {
    await fetch("/api/papers/journal-filter", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, clearAll: true }),
    });
    setJournalFilters([]);
    setJournalFilterMode(null);
  }

  async function switchFilterMode(mode: "blacklist" | "whitelist") {
    await fetch("/api/papers/journal-filter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, mode }),
    });
    setJournalFilterMode(mode);
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
    } catch { /* skip */ }
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
    } catch { /* skip */ }
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

  interface AnalysisRecord {
    type: "variables" | "review" | "ideas";
    content: string;
    timestamp: string;
    paperCount: number;
  }
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisRecord[]>([]);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [fullTextPanel, setFullTextPanel] = useState<{
    paperIndex: number;
    loading: boolean;
    text?: string;
    source?: string;
    wordCount?: number;
    error?: string;
  } | null>(null);
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
    }).catch(() => {});
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
    } catch { /* non-critical */ }
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
                onClick={() => document.getElementById(`paper-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
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
                onClick={() => document.getElementById(`paper-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
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

  return (
    <div ref={containerRef} className="flex gap-4 overflow-hidden" style={{ height: "calc(100vh - 100px)" }}>
      {/* Left: Search History Panel */}
      <div className={`shrink-0 transition-all duration-200 overflow-y-auto ${historyCollapsed ? "w-10" : "w-56"}`}>
        <div className="space-y-2">
          {/* New conversation button */}
          {historyCollapsed ? (
            <button
              onClick={() => {
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
              }}
              className="w-full border border-border/50 rounded-lg bg-card p-2 flex items-center justify-center text-teal hover:bg-teal/5 transition-colors"
              title="新建对话"
            >
              <span className="text-sm">+</span>
            </button>
          ) : (
            <button
              onClick={() => {
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
              }}
              className="w-full border border-teal/30 rounded-lg bg-teal/5 hover:bg-teal/10 transition-colors px-3 py-2 flex items-center gap-2 text-teal text-sm font-medium"
            >
              <span>+</span>
              <span>新建对话</span>
            </button>
          )}

          {/* History panel */}
          {historyCollapsed ? (
            <div className="border border-border/50 rounded-lg bg-card overflow-hidden">
              <button
                onClick={() => setHistoryCollapsed(false)}
                className="w-full flex flex-col items-center gap-2 py-3 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title="展开检索记录"
              >
                <span className="text-xs">»</span>
                <span className="text-[10px] tracking-widest" style={{ writingMode: "vertical-rl" }}>检索记录</span>
                {searchHistory.length > 0 && (
                  <span className="text-[9px] bg-teal/10 text-teal rounded-full w-5 h-5 flex items-center justify-center">
                    {searchHistory.length}
                  </span>
                )}
              </button>
            </div>
          ) : (
            <div className="border border-border/50 rounded-lg bg-card overflow-hidden">
              <div className="p-3 border-b border-border/50 flex items-center justify-between">
                <span className="text-sm font-medium">检索记录</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">{searchHistory.length} 条</span>
                  <button
                    onClick={() => setHistoryCollapsed(true)}
                    className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    title="收起检索记录"
                  >
                    <span className="text-xs">«</span>
                  </button>
                </div>
              </div>
              <div className="max-h-[calc(100vh-160px)] overflow-y-auto">
                {searchHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3 text-center">暂无检索记录</p>
                ) : (
                  searchHistory.map((h) => (
                    <div
                      key={h.id}
                      className={`group p-3 border-b border-border/30 cursor-pointer transition-colors ${activeSearchId === h.id ? "bg-teal/10 border-l-2 border-l-teal" : "hover:bg-muted/50"}`}
                      onClick={async () => {
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
                          setQuery(h.query);
                        }
                      }}
                    >
                      <p className="text-xs font-medium leading-snug line-clamp-2 group-hover:text-teal transition-colors">
                        {h.query}
                      </p>
                      {h.translatedQuery && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          → {h.translatedQuery}
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-muted-foreground">
                          {h.paperCount} 篇 · {h.provider ?? ""}
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-muted-foreground/60">
                            {new Date(h.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <button
                            className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400 hover:text-red-600 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              const deletedQuery = h.query;
                              // 1. Delete from DB (search history + associated chat history)
                              Promise.all([
                                fetch(`/api/search-history?id=${h.id}`, { method: "DELETE" }),
                                fetch(`/api/chat-history?projectId=${projectId}&query=${encodeURIComponent(deletedQuery)}`, { method: "DELETE" }),
                              ]).catch(() => {});
                              // 2. Remove from local search history + clean up its chat
                              setSearchHistory((prev) => prev.filter((x) => x.id !== h.id));
                              setAllChats(prev => { const u = { ...prev }; delete u[h.id]; return u; });
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
                            }}
                            title="删除"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      {h.keyTerms && (h.keyTerms as string[]).length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {(h.keyTerms as string[]).slice(0, 3).map((t) => (
                            <span key={t} className="text-[9px] px-1 py-0 rounded bg-teal/10 text-teal">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

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
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground whitespace-nowrap">
              共 {displayedPapers.length} 篇
              {(filterRankings.size > 0 || filterBatch !== "all" || (searchPlan?.filters && Object.keys(searchPlan.filters).length > 0)) &&
                papers.length !== displayedPapers.length &&
                ` (从 ${papers.length} 篇中筛选)`}
              {searchStats?.relevanceScored && searchStats.totalBeforeRelevance > searchStats.total &&
                ` · AI过滤了 ${searchStats.totalBeforeRelevance - searchStats.total} 篇不相关文献`}
            </span>
            {meta?.sources.map((s) => {
              const label = sourceLabels[s.source] ?? s.source;
              const shortLabel = label.length > 35 ? label.slice(0, 32) + "..." : label;
              return (
                <Badge
                  key={s.source}
                  variant="secondary"
                  className={`text-xs ${sourceColors[s.source] ?? ""}`}
                  title={label}
                >
                  {shortLabel}: {s.count}
                </Badge>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Sort */}
            <Select value={sortBy} onValueChange={(v) => v && setSortBy(v as SortBy)}>
              <SelectTrigger className="w-[150px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="citations">按引用量排序</SelectItem>
                <SelectItem value="year_desc">按年份（新→旧）</SelectItem>
                <SelectItem value="year_asc">按年份（旧→新）</SelectItem>
                <SelectItem value="relevance">按相关度排序</SelectItem>
              </SelectContent>
            </Select>

            {/* Filter by ranking — multi-select */}
            <div className="relative group">
              <button className="flex items-center gap-1 h-8 px-3 rounded-md border border-input bg-background text-xs hover:bg-accent">
                {filterRankings.size === 0 ? "全部期刊" : `${filterRankings.size} 项已选`}
                <span className="text-[10px] ml-1">▼</span>
              </button>
              <div className="absolute top-full left-0 mt-1 w-48 bg-popover border border-border rounded-md shadow-md z-50 hidden group-hover:block hover:block max-h-64 overflow-y-auto py-1">
                {filterRankings.size > 0 && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-accent"
                    onClick={() => setFilterRankings(new Set())}
                  >
                    清除筛选
                  </button>
                )}
                {[
                  { value: "UTD24", label: "UTD24" },
                  { value: "FT50", label: "FT50" },
                  { value: "FMS", label: "FMS推荐" },
                  { value: "SSCI", label: "SSCI" },
                  { value: "SCI", label: "SCI" },
                  { value: "CSSCI", label: "CSSCI 南大核心" },
                  { value: "ABS 4*", label: "ABS 4*" },
                  { value: "ABS 4", label: "ABS 4 及以上" },
                  { value: "ABS 3", label: "ABS 3 及以上" },
                  { value: "JCR Q1", label: "JCR Q1" },
                  { value: "JCR Q2", label: "JCR Q1-Q2" },
                  { value: "ABDC A*", label: "ABDC A*" },
                  { value: "CCF A", label: "CCF A" },
                  { value: "CCF B", label: "CCF A-B" },
                  { value: "中科院一区", label: "中科院一区" },
                  { value: "中科院二区", label: "中科院一二区" },
                  { value: "arXiv", label: "arXiv 预印本" },
                ].map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filterRankings.has(value)}
                      onChange={() => {
                        setFilterRankings(prev => {
                          const next = new Set(prev);
                          if (next.has(value)) next.delete(value);
                          else next.add(value);
                          return next;
                        });
                      }}
                      className="accent-teal w-3 h-3"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Filter by search batch */}
            {searchBatches.length > 0 && (
              <Select value={filterBatch} onValueChange={(v) => v && setFilterBatch(v)}>
                <SelectTrigger className="w-[200px] h-8 text-xs">
                  <SelectValue placeholder="全部检索" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部检索（{papers.length} 篇）</SelectItem>
                  {searchBatches.map((b, idx) => (
                    <SelectItem key={b.id} value={b.id}>
                      第{idx + 1}轮: {b.query.slice(0, 15)}{b.query.length > 15 ? "..." : ""}（{b.count} 篇）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* AI Actions */}
            <Separator orientation="vertical" className="h-6" />
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleAnalyze("variables")} disabled={analyzing}>
              提取变量
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleAnalyze("review")} disabled={analyzing}>
              生成综述
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleAnalyze("ideas")} disabled={analyzing}>
              生成想法
            </Button>
            <StopButton show={analyzing} onClick={() => analyzeAbort.abort()} label="停止分析" />
          </div>
        </div>
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
            <AnalysisResultView content={analysisResult} papers={displayedPapers} />
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

      {/* Search progress panel */}
      {loading && (
        <div className="border border-teal/20 rounded-lg bg-teal/5 overflow-hidden">
          <div className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-teal">
            <span className="flex items-center gap-2 cursor-pointer hover:opacity-80" onClick={() => setProgressOpen(!progressOpen)}>
              <span className="inline-block w-3.5 h-3.5 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
              检索进行中...
              <span className="text-[10px] text-muted-foreground">{progressOpen ? "▲ 收起" : "▼ 展开"}</span>
            </span>
            <StopButton show={loading} onClick={() => { searchManager.abort(); setLoading(false); }} label="停止检索" />
          </div>
          {progressOpen && searchProgress.length > 0 && (
            <div className="px-4 pb-3 space-y-1.5 border-t border-teal/10">
              {searchProgress.map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {step.done ? (
                    <span className="text-teal mt-0.5 shrink-0">✓</span>
                  ) : (
                    <span className="inline-block w-3 h-3 border-2 border-teal/30 border-t-teal rounded-full animate-spin mt-0.5 shrink-0" />
                  )}
                  <span className={step.done ? "text-muted-foreground" : "text-foreground"}>
                    {step.message}
                  </span>
                </div>
              ))}
            </div>
          )}
          {progressOpen && searchProgress.length === 0 && (
            <div className="px-4 pb-3 border-t border-teal/10">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block w-3 h-3 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
                初始化搜索...
              </div>
            </div>
          )}
        </div>
      )}

      {/* Completed progress — collapsible after search finishes */}
      {!loading && searchProgress.length > 0 && (
        <div className="border border-border/50 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
            onClick={() => setProgressOpen(!progressOpen)}
          >
            <span className="flex items-center gap-1.5">
              <span className="text-teal">✓</span>
              检索完成 · {searchProgress.length} 个步骤
            </span>
            <span className="text-[10px]">{progressOpen ? "▲ 收起" : "▼ 展开"}</span>
          </button>
          {progressOpen && (
            <div className="px-4 pb-2.5 space-y-1 border-t border-border/30">
              {searchProgress.map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-teal mt-0.5 shrink-0">✓</span>
                  <span className="text-muted-foreground">{step.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
          {displayedPapers.map((paper, i) => (
            <div
              key={i}
              id={`paper-${i + 1}`}
              data-paper-index={i}
              className="group border border-border/50 rounded-lg p-4 hover:border-teal/20 transition-all duration-150 bg-card scroll-mt-16"
            >
              {/* Row 1: checkbox + relevance score + title */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedPapers.has(i)}
                  onChange={() => togglePaper(i)}
                  className="accent-teal mt-1.5 shrink-0"
                />
                <button
                  className="text-xs text-muted-foreground/60 font-mono mt-1 shrink-0 w-5 text-right hover:text-teal hover:font-bold transition-colors cursor-pointer"
                  title="跳回对话"
                  onClick={() => chatPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
                >{i + 1}</button>
                {/* Relevance score badge */}
                {paper.relevanceScore != null ? (
                  <div
                    className={`shrink-0 w-10 h-10 rounded-lg border flex flex-col items-center justify-center ${getRelevanceColor(paper.relevanceScore)}`}
                    title={paper.relevanceReason || getRelevanceLabel(paper.relevanceScore)}
                  >
                    <span className="text-sm font-bold leading-none">{paper.relevanceScore}</span>
                    <span className="text-[8px] leading-none mt-0.5">{getRelevanceLabel(paper.relevanceScore).slice(0, 2)}</span>
                  </div>
                ) : searchStats?.relevanceScored ? (
                  <div
                    className="shrink-0 w-10 h-10 rounded-lg border border-gray-300 bg-gray-50 flex flex-col items-center justify-center"
                    title="评分失败，请重新检索"
                  >
                    <span className="text-sm font-bold leading-none text-gray-400">?</span>
                    <span className="text-[8px] leading-none mt-0.5 text-gray-400">未评</span>
                  </div>
                ) : null}
                {/* Full text indicator */}
                {paper.hasFullText ? (
                  <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-200" title="已获取全文">全文</span>
                ) : paper.abstract && paper.abstract.length > 100 ? (
                  <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-medium bg-gray-50 text-gray-500 border border-gray-200" title="仅有摘要">摘要</span>
                ) : null}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <h3 className="font-medium text-[15px] leading-snug group-hover:text-teal transition-colors flex-1">
                      {paper.title}
                    </h3>
                    <a
                      href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
                      title="在 Google Scholar 中查看（大陆需代理）"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Scholar ⚠
                    </a>
                  </div>
                  {/* Row 2: authors + year + venue */}
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-muted-foreground flex-1">
                      {paper.authors.slice(0, 3).map((a) => a.name).join(", ")}
                      {paper.authors.length > 3 && " et al."}
                      {paper.year && ` (${paper.year})`}
                      {paper.venue && ` — ${paper.venue}`}
                    </p>
                    {(!paper.abstract || paper.abstract.length < 80) && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
                        {!paper.abstract ? "仅标题" : "摘要不完整"}
                      </span>
                    )}
                  </div>
                  {/* AI Analysis — 每篇都显示 */}
                  {/* AI Analysis — 每篇论文都必须有 */}
                  {paper.relevanceScore != null && (
                    <details open className="mt-2 group">
                      <summary className="list-none flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
                        <span className="transition-transform group-open:rotate-90 text-emerald-600">▶</span>
                        <span className="font-medium text-emerald-800">AI 分析</span>
                        {paper.relevanceDataSource && (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0">
                            基于{paper.relevanceDataSource}
                          </Badge>
                        )}
                        {paper.relevanceKeyMatch && paper.relevanceKeyMatch.length > 0 && (
                          <span className="flex gap-0.5">
                            {paper.relevanceKeyMatch.map((k) => (
                              <Badge key={k} variant="secondary" className="text-[9px] px-1 py-0">{k}</Badge>
                            ))}
                          </span>
                        )}
                      </summary>
                      <div className="mt-1.5 p-2.5 rounded-md bg-emerald-50/50 border border-emerald-100 space-y-1">
                        {paper.relevanceReason && (
                          <p className="text-[11px] text-emerald-700">
                            <span className="font-medium">相关性：</span>{paper.relevanceReason}
                          </p>
                        )}
                        {paper.relevanceContribution && (
                          <p className="text-[11px] text-emerald-700">
                            <span className="font-medium">贡献：</span>{paper.relevanceContribution}
                          </p>
                        )}
                        {paper.relevanceMethodology && (
                          <p className="text-[11px] text-emerald-700">
                            <span className="font-medium">方法：</span>{paper.relevanceMethodology}
                          </p>
                        )}
                        {paper.relevanceInnovation && (
                          <p className="text-[11px] text-emerald-700">
                            <span className="font-medium">创新：</span>{paper.relevanceInnovation}
                          </p>
                        )}
                      </div>
                    </details>
                  )}
                  {/* Row 3: abstract — collapsible, or missing-abstract prompt */}
                  {paper.abstract ? (
                    <details className="mt-2 group">
                      <summary className="text-xs text-muted-foreground/70 cursor-pointer hover:text-muted-foreground select-none list-none flex items-center gap-1">
                        <span className="transition-transform group-open:rotate-90">▶</span>
                        <span>摘要</span>
                        {paper.abstract.length < 100 && (
                          <span className="text-[9px] text-amber-500 ml-1">（摘要可能不完整）</span>
                        )}
                      </summary>
                      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                        {paper.abstract}
                      </p>
                    </details>
                  ) : (
                    <div className="mt-2 flex items-center gap-2 p-2 rounded bg-amber-50/50 border border-amber-200/50 text-[11px] text-amber-700">
                      <span>摘要缺失，AI 分析仅基于标题。</span>
                      <a
                        href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        前往 Google Scholar 查看全文（需代理）→
                      </a>
                    </div>
                  )}
                  {/* Full text panel (expandable per paper) */}
                  {fullTextPanel?.paperIndex === i && (
                    <div className="mt-3 p-3 bg-muted/50 rounded-lg border border-border/50">
                      {fullTextPanel.loading && (
                        <p className="text-xs text-muted-foreground animate-pulse">正在获取全文...</p>
                      )}
                      {fullTextPanel.error && fullTextPanel.error !== "SHOW_PLAYWRIGHT_OPTION" && (
                        <p className="text-xs text-red-500">{fullTextPanel.error}</p>
                      )}
                      {fullTextPanel.error === "SHOW_PLAYWRIGHT_OPTION" && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">开放获取渠道未找到全文。可尝试通过浏览器深度获取（需连接校园网或 VPN）：</p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-indigo-300 text-indigo-700"
                            onClick={async () => {
                              setFullTextPanel({ paperIndex: i, loading: true });
                              try {
                                const res = await fetch("/api/papers/fulltext", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    doi: paper.doi,
                                    openAccessPdf: paper.openAccessPdf,
                                    title: paper.title,
                                    usePlaywright: true,
                                  }),
                                });
                                const data = await res.json();
                                if (data.available) {
                                  setFullTextPanel({
                                    paperIndex: i,
                                    loading: false,
                                    text: data.text,
                                    source: data.source + " (Playwright)",
                                    wordCount: data.wordCount,
                                  });
                                } else {
                                  setFullTextPanel({
                                    paperIndex: i,
                                    loading: false,
                                    error: "深度获取也未能获得全文（可能需要登录学校 VPN）",
                                  });
                                }
                              } catch {
                                setFullTextPanel({ paperIndex: i, loading: false, error: "深度获取失败" });
                              }
                            }}
                          >
                            🔍 深度获取（Playwright 浏览器）
                          </Button>
                        </div>
                      )}
                      {fullTextPanel.text && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] text-muted-foreground">
                              来源: {fullTextPanel.source === "semantic_scholar" ? "Semantic Scholar" : fullTextPanel.source === "html_scrape" ? "Publisher HTML" : fullTextPanel.source} · {fullTextPanel.wordCount?.toLocaleString()} 词
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 text-[10px] px-1"
                              onClick={() => setFullTextPanel(null)}
                            >
                              收起
                            </Button>
                          </div>
                          <p className="text-xs leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap">
                            {fullTextPanel.text}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Row 4: actions (left) + badges (right) */}
                  <div className="flex items-center justify-between mt-3 gap-2">
                    {/* Left: action buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className={`h-6 text-[11px] px-2 ${savedPaperKeys.has(paper.doi || paper.title) ? "bg-teal/10 text-teal border-teal/30" : ""}`}
                        disabled={savedPaperKeys.has(paper.doi || paper.title)}
                        onClick={async () => {
                          try {
                            const res = await fetch("/api/papers", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                projectId,
                                title: paper.title,
                                abstract: paper.abstract,
                                authors: paper.authors,
                                year: paper.year,
                                venue: paper.venue,
                                citationCount: paper.citationCount,
                                doi: paper.doi,
                                source: paper.source,
                                pdfUrl: paper.openAccessPdf || paper.unpaywallUrl,
                                openAccessPdf: paper.openAccessPdf,
                              }),
                            });
                            if (res.ok) {
                              setSavedPaperKeys((prev) => new Set([...prev, paper.doi || paper.title]));
                            } else {
                              const data = await res.json();
                              if (data.details?.includes("Unique constraint")) {
                                setSavedPaperKeys((prev) => new Set([...prev, paper.doi || paper.title]));
                              } else {
                                alert("保存失败: " + (data.error || "未知错误"));
                              }
                            }
                          } catch {
                            alert("保存失败，请检查网络");
                          }
                        }}
                      >
                        {savedPaperKeys.has(paper.doi || paper.title) ? "✓ 已添加" : "添加到文献库"}
                      </Button>

                      {/* 引用格式 — Google Scholar 风格弹窗，服务端 citation-js 生成 */}
                      <div className="relative">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px] px-2 text-amber-700"
                          onClick={async () => {
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
                          }}
                        >
                          Cite
                        </Button>
                        {citePopup === paper.title && (
                          <div className="absolute left-0 top-7 z-50 w-[520px] bg-white border border-border rounded-lg shadow-xl p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-foreground">引用格式</span>
                              <button className="text-muted-foreground hover:text-foreground text-xs" onClick={() => setCitePopup(null)}>✕</button>
                            </div>
                            {citeLoading ? (
                              <p className="text-xs text-muted-foreground animate-pulse py-4 text-center">正在生成引用...</p>
                            ) : citeData ? (
                              <>
                                {[
                                  { key: "apa", label: "APA" },
                                  { key: "mla", label: "MLA" },
                                  { key: "chicago", label: "Chicago" },
                                  { key: "gb-t-7714", label: "GB/T 7714" },
                                  { key: "bibtex", label: "BibTeX" },
                                ].map(({ key, label }) => (
                                  citeData[key] && (
                                    <div
                                      key={key}
                                      className="flex gap-3 group cursor-pointer hover:bg-muted/50 rounded px-2 py-1.5 -mx-2"
                                      onClick={async () => {
                                        await navigator.clipboard.writeText(citeData[key].replace(/\*/g, ""));
                                        setCitePopup(null);
                                        alert(`${label} 引用已复制到剪贴板`);
                                      }}
                                    >
                                      <span className="text-muted-foreground/70 w-20 shrink-0 text-xs font-medium pt-0.5">{label}</span>
                                      <span
                                        className="text-xs text-foreground leading-relaxed"
                                        dangerouslySetInnerHTML={{
                                          __html: citeData[key]
                                            .replace(/\*([^*]+)\*/g, "<em>$1</em>")
                                            .replace(/\n/g, "<br/>"),
                                        }}
                                      />
                                    </div>
                                  )
                                ))}
                                <p className="text-[10px] text-muted-foreground/50 pt-1 border-t border-border/30">点击任意格式复制到剪贴板</p>
                              </>
                            ) : (
                              <p className="text-xs text-red-500 py-4 text-center">引用生成失败，请重试</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Row 5: External links — organized by category */}
                    <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-border/30 text-[11px]">
                      {/* 文献获取 */}
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-16 shrink-0 text-[10px]">文献获取</span>
                        {(paper.openAccessPdf || paper.unpaywallUrl) && (
                          <a href={paper.openAccessPdf || paper.unpaywallUrl} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:underline">PDF 下载</a>
                        )}
                        {paper.doi && (
                          <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:underline">DOI 原文页</a>
                        )}
                        {!paper.openAccessPdf && !paper.unpaywallUrl && !paper.doi && (
                          <span className="text-muted-foreground/50">无直接获取链接</span>
                        )}
                      </div>

                      {/* 查找全文 — Google Scholar + 知网 */}
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-16 shrink-0 text-[10px]">查找全文</span>
                        <a href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" title="大陆需代理访问">Google Scholar ⚠</a>
                        <a href={`https://kns.cnki.net/kns8s/search?classid=WD0FTY92&korder=SU&kw=${encodeURIComponent(paper.title)}`} target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline">知网 CNKI</a>
                        {paper.connectedPapersUrl && (
                          <a href={paper.connectedPapersUrl} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline">相关论文图谱</a>
                        )}
                      </div>

                      {/* 工具 */}
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-16 shrink-0 text-[10px]">工具</span>
                        <button
                          className="text-purple-600 hover:underline cursor-pointer"
                          onClick={() => {
                            const obsUrl = localStorage.getItem("obsidian_base_url") || "https://127.0.0.1:27124";
                            const apiKey = localStorage.getItem("obsidian_api_key") || "";
                            if (!apiKey) {
                              alert("请先在「设置」页面配置 Obsidian API Key");
                              return;
                            }
                            const filename = paper.title.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
                            const notePath = `ScholarFlow/Papers/${filename}.md`;
                            const content = `---\ntitle: "${paper.title}"\nyear: ${paper.year ?? "unknown"}\nvenue: "${paper.venue ?? ""}"\ndoi: "${paper.doi ?? ""}"\ntags: [paper]\n---\n\n# ${paper.title}\n\n${paper.authors.map((a) => a.name).join(", ")} (${paper.year ?? "N/A"})\n${paper.venue ?? ""}\n\n## 摘要\n${paper.abstract ?? "_No abstract_"}\n`;
                            const hdrs: HeadersInit = { "Content-Type": "text/markdown" };
                            if (apiKey) hdrs["Authorization"] = `Bearer ${apiKey}`;
                            fetch(`${obsUrl}/vault/${encodeURIComponent(notePath)}`, { method: "PUT", headers: hdrs, body: content })
                              .then((r) => { if (r.ok) alert("✅ 已推送到 Obsidian"); else alert("推送失败: HTTP " + r.status); })
                              .catch(() => alert("推送失败，请确认 Obsidian 已打开且 Local REST API 插件已启用"));
                          }}
                        >
                          推送到 Obsidian
                        </button>
                        <button
                          className="text-red-600 hover:underline cursor-pointer"
                          onClick={async () => {
                            const zKey = localStorage.getItem("zotero_api_key");
                            const zUser = localStorage.getItem("zotero_user_id");
                            if (!zKey || !zUser) {
                              alert("请先在「设置」页面配置 Zotero API Key 和 User ID");
                              return;
                            }
                            try {
                              const res = await fetch("/api/integrations/zotero", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  action: "add",
                                  apiKey: zKey,
                                  userId: zUser,
                                  paper: { title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, doi: paper.doi, abstract: paper.abstract },
                                }),
                              });
                              const data = await res.json();
                              if (data.success) alert("✅ 已保存到 Zotero");
                              else alert("保存失败: " + (data.error ?? "未知错误"));
                            } catch {
                              alert("保存失败，请检查网络和 Zotero 配置");
                            }
                          }}
                        >
                          保存到 Zotero
                        </button>
                      </div>
                    </div>
                    {/* Right: metadata + badges */}
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      {paper.journalMeta?.impactFactor != null && (
                        <span className="text-[10px] font-mono text-teal font-bold whitespace-nowrap">
                          IF {paper.journalMeta.impactFactor.toFixed(1)}
                        </span>
                      )}
                      {paper.journalRanking?.badges?.map((badge) => (
                        <Badge
                          key={badge}
                          className={`text-[9px] px-1 py-0 font-bold leading-tight ${rankingColors[badge] ?? "bg-gray-400 text-white"}`}
                        >
                          {badge}
                        </Badge>
                      ))}
                      <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                        {paper.citationCount.toLocaleString()} 引用
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
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
