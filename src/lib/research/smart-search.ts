/**
 * Smart search with keyword extraction + synonym expansion.
 *
 * 1. Extract key terms from user's natural language input
 * 2. Generate synonyms for each term
 * 3. Precision: search each key term as exact phrase
 * 4. Broad: combine terms + synonyms with OR logic
 * 5. Merge and deduplicate
 */
import { callAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { searchAllSourcesRaw, enrichPapersBatch } from "@/lib/sources/aggregator";
import type { SearchResult } from "@/lib/sources/types";
import type { UnifiedPaper } from "@/lib/sources/types";
import { scoreRelevance, scoreRelevanceWithFullText, filterByRelevance, type ScoredPaper } from "./relevance-scorer";
import { batchFetchFullText, type FullTextResult } from "./fulltext-fetcher";

export interface SearchFilters {
  minABS?: "1" | "2" | "3" | "4" | "4*";
  minCASZone?: "一区" | "二区" | "三区" | "四区";
  minJCR?: "Q1" | "Q2" | "Q3" | "Q4";
  minCCF?: "A" | "B" | "C";
  requireSSCI?: boolean;
  requireSCI?: boolean;
  requireCSSCI?: boolean;
  requirePKUCore?: boolean;
  requireFMS?: boolean;
  requireHighQuality?: boolean; // "高质量期刊" = any recognized quality index
  minIF?: number;
  minCitations?: number;
  yearFrom?: number;
  yearTo?: number;
  requireUTD24?: boolean;
  requireFT50?: boolean;
}

export interface SmartSearchPlan {
  translatedInput?: string;
  queryIntent?: "TOPICAL" | "RELATIONAL" | "METHODOLOGICAL" | "REVIEW";
  keyTerms: string[];
  synonyms: Record<string, string[]>;
  precisionQueries: string[];
  broadQueries: string[];
  filters: SearchFilters;
}

export interface SmartSearchResult {
  plan: SmartSearchPlan;
  papers: ScoredPaper[];
  stats: {
    total: number;
    totalBeforeFilter: number;
    totalBeforeRelevance: number;
    byQuery: Record<string, number>;
    durationMs: number;
    relevanceScored: boolean;
    googleScholarAvailable: boolean;
    withFullText: number;
    withAbstractOnly: number;
  };
}

// ─── Tiered quality filtering ─────────────────────────────
// limit=20:  arXiv + JCR Q1 + SSCI Q1 + SCI Q1 + ABS 3+ only, sorted by relevance + citations
// limit=50:  same as 20; if < 50, relax to JCR Q2
// limit=100: no journal filter, sorted by relevance + citations, cap at 100
// limit=999: unlimited, keep all with relevance ≥ 5

// ─── Three-tier priority system ──────────────────
//
// P1 (最高): Nature及子刊, Science及子刊, ABS3*+, JCR Q1 → 不看引用量，永远最前
// P2 (次高): 高引论文（年份动态阈值）
// P3 (第三): arXiv 2026年发表且引用>0

const NATURE_SCIENCE_KEYWORDS = [
  "nature", "science", "cell", "lancet", "new england journal",
  "nature human behav", "nature machine intel", "nature biomedical",
  "nature commun", "nature medicine", "nature neurosci", "nature climate",
  "nature energy", "nature sustain", "nature food", "nature comput",
  "science advances", "science robotics",
];

/** P1: Top journal — by venue name (pre-enrichment) or journalMeta (post-enrichment) */
function isPriority1(p: UnifiedPaper | ScoredPaper): boolean {
  const venue = String(p.venue ?? "").toLowerCase();
  // Nature/Science family by name
  if (NATURE_SCIENCE_KEYWORDS.some(k => venue.includes(k))) return true;
  // JCR Q1
  if (p.journalMeta?.jcrQuartile === "Q1") return true;
  // ABS 3*+
  const absOrder = ["1", "2", "3", "4", "4*"];
  if (p.journalMeta?.absRating && absOrder.indexOf(p.journalMeta.absRating) >= 2) return true;
  // UTD24 / FT50
  if (p.journalRanking?.utd24 || p.journalRanking?.ft50) return true;
  return false;
}

/** P2: High citation relative to year */
function isPriority2(p: UnifiedPaper | ScoredPaper): boolean {
  const year = p.year ?? 0;
  const cited = p.citationCount ?? 0;
  const currentYear = new Date().getFullYear();
  if (year >= currentYear && cited > 0) return true;         // 2026+: > 0
  if (year === currentYear - 1 && cited > 30) return true;   // 2025: > 30
  if (year === currentYear - 2 && cited > 100) return true;  // 2024: > 100
  if (year <= currentYear - 3 && cited > 200) return true;   // 2023-: > 200
  return false;
}

/** P3: Recent arXiv with citations */
function isPriority3(p: UnifiedPaper | ScoredPaper): boolean {
  const venue = String(p.venue ?? "").toLowerCase();
  const isArxiv = venue.startsWith("arxiv") || venue.includes("arxiv");
  return isArxiv && (p.year ?? 0) >= new Date().getFullYear() && (p.citationCount ?? 0) > 0;
}

/** Get priority tier (0=highest) */
function getPriorityTier(p: UnifiedPaper | ScoredPaper): number {
  if (isPriority1(p)) return 0;
  if (isPriority2(p)) return 1;
  if (isPriority3(p)) return 2;
  return 3; // no priority
}

/** Also consider SSCI/SCI/top conferences as quality sources for pre-enrichment cap */
function isQualitySource(p: UnifiedPaper): boolean {
  if (getPriorityTier(p) <= 2) return true;
  if (p.journalMeta?.ssci || p.journalMeta?.sci) return true;
  if (p.journalMeta?.conference?.tier === "Top" || p.journalMeta?.conference?.tier === "A") return true;
  return false;
}

/** Sort: relevance → priority tier → journal grade → IF → citations */
function sortByQuality(papers: ScoredPaper[]): ScoredPaper[] {
  return papers.sort((a, b) => {
    // Primary: relevance score
    const scoreA = a.relevanceScore ?? 0;
    const scoreB = b.relevanceScore ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;

    // Secondary: priority tier
    const aTier = getPriorityTier(a);
    const bTier = getPriorityTier(b);
    if (aTier !== bTier) return aTier - bTier;

    // Tertiary: journal grade (UTD24/FT50 > JCR Q1 > Q2)
    const jcrOrder: Record<string, number> = { Q1: 4, Q2: 3, Q3: 2, Q4: 1 };
    const aGrade = (a.journalRanking?.utd24 ? 10 : 0) + (a.journalRanking?.ft50 ? 10 : 0) +
      (jcrOrder[a.journalMeta?.jcrQuartile ?? ""] ?? 0);
    const bGrade = (b.journalRanking?.utd24 ? 10 : 0) + (b.journalRanking?.ft50 ? 10 : 0) +
      (jcrOrder[b.journalMeta?.jcrQuartile ?? ""] ?? 0);
    if (bGrade !== aGrade) return bGrade - aGrade;

    // Quaternary: impact factor
    const aIF = a.journalMeta?.impactFactor ?? 0;
    const bIF = b.journalMeta?.impactFactor ?? 0;
    if (aIF !== bIF) return bIF - aIF;

    // Last: citations
    return b.citationCount - a.citationCount;
  });
}

function applyTieredLimit(papers: ScoredPaper[], limit: number, relevanceScored: boolean, journalLang: JournalLang = "en"): ScoredPaper[] {
  // Chinese journals: skip quality filter
  if (journalLang === "zh") {
    const sorted = sortByQuality(papers);
    if (relevanceScored) return sorted.filter(p => (p.relevanceScore ?? 0) >= 3).slice(0, limit >= 999 ? sorted.length : limit);
    return sorted.slice(0, limit >= 999 ? sorted.length : limit);
  }

  const sorted = sortByQuality(papers);

  if (limit >= 999) {
    return relevanceScored ? sorted.filter(p => (p.relevanceScore ?? 0) >= 5) : sorted;
  }

  if (limit >= 100) {
    // 100 (不限刊): keep all three tiers, up to 100
    return sorted.slice(0, 100);
  }

  // 20 or 50: P1 first, then P2, then P3
  const p1 = sorted.filter(p => isPriority1(p));
  const p2 = sorted.filter(p => !isPriority1(p) && isPriority2(p));
  const p3 = sorted.filter(p => !isPriority1(p) && !isPriority2(p) && isPriority3(p));

  const combined = [...p1, ...p2, ...p3];
  return combined.slice(0, limit);
}

const EXTRACT_SYSTEM = `You are an academic literature search expert. Given a user query (any language), output a JSON search plan.

TRANSLATE: Strip Chinese filler words (帮我找/有关/的文章/请搜索). Translate to English academic terms.

QUERY INTENT: TOPICAL | RELATIONAL | METHODOLOGICAL | REVIEW

KEY TERMS (3-5 complete academic phrases):
- NEVER split compound terms ("AI washing" = one term)
- RELATIONAL queries (A与B): include BOTH A→B AND B→A directions
- METHODOLOGICAL queries: include domain+method combinations (e.g. "text mining job postings")
- Use the FORMAL academic term top journals use, not literal translation (e.g. "AI谄媚" → "sycophancy")
- For broad concepts (e.g. "碳排放"): include the full semantic family (carbon emissions, CO2, net-zero, decarbonization, greenhouse gas)

SYNONYMS (6-8 per key term, ALL English): cover — direct synonyms, broader/narrower terms, adjacent research streams, formal academic terms, mechanism/measurement terms.

QUERIES:
- precisionQueries (4-6): exact-phrase searches using key terms + top synonyms
- broadQueries (2-3): OR-connected synonym groups; for RELATIONAL include both directions in one broad query

FILTERS (only extract if user explicitly mentioned):
- Journal: "SSCI"→requireSSCI, "SCI"→requireSCI, "ABS3星+"→minABS="3", "JCR Q1"→minJCR="Q1", "CCF A"→minCCF="A", "CSSCI/C刊"→requireCSSCI, "北大核心"→requirePKUCore, "UTD24"→requireUTD24, "FT50"→requireFT50, "FMS"→requireFMS, "高质量/好期刊/权威期刊"→requireHighQuality, "影响因子N+"→minIF, "引用N+"→minCitations
- Year: "2020以后"→yearFrom:2020, "近两年"→yearFrom:${new Date().getFullYear() - 2}, "近三年"→yearFrom:${new Date().getFullYear() - 3}, "近五年"→yearFrom:${new Date().getFullYear() - 5}, "最新/最近"→yearFrom:${new Date().getFullYear() - 1}, "今年"→yearFrom+yearTo:${new Date().getFullYear()}
- requireHighQuality = ANY quality index (SSCI/SCI/CSSCI/UTD24/FT50/ABS2+/JCR Q1-Q2/CCF A-B/CAS一二区)

Output STRICT JSON:
{
  "translatedInput": "English translation of search topic only",
  "queryIntent": "TOPICAL",
  "keyTerms": ["AI washing"],
  "synonyms": { "AI washing": ["AI greenwashing", "technology washing", "AI hype", "digital deception", "AI fraud disclosure", "corporate AI misrepresentation"] },
  "precisionQueries": ["\"AI washing\"", "\"AI greenwashing\""],
  "broadQueries": ["\"AI washing\" OR \"AI greenwashing\" OR \"technology washing\" OR \"AI hype\" OR \"digital deception\""],
  "filters": {}
}

RULES: ALL keyTerms/synonyms/queries in English only (never Chinese — Chinese reserved for CNKI). Filters not in queries.`;

const EXTRACT_SYSTEM_ZH = `You are an academic search assistant. Given a research topic (in any language), extract CHINESE keywords and queries for searching Chinese academic databases (CNKI 知网, CSSCI, PKU Core).

ALL keyTerms, synonyms, precisionQueries, and broadQueries MUST be in CHINESE (中文). Even if the user's input is in English, translate everything to Chinese academic terms.

Output STRICT JSON only:
{
  "translatedInput": "中文翻译（完整学术翻译）",
  "queryIntent": "TOPICAL" | "RELATIONAL" | "METHODOLOGICAL" | "REVIEW",
  "keyTerms": ["人工智能伦理"],
  "synonyms": {
    "人工智能伦理": ["AI伦理", "机器伦理", "算法伦理", "智能系统伦理"]
  },
  "precisionQueries": ["\"人工智能伦理\"", "\"AI伦理\""],
  "broadQueries": ["(\"人工智能伦理\" OR \"AI伦理\" OR \"机器伦理\" OR \"算法伦理\")"],
  "filters": {}
}

RULES:
- CHINESE ONLY: ALL keyTerms, synonyms, precisionQueries, and broadQueries MUST be in Chinese
- keyTerms = 2-5 Chinese academic terms/phrases
- synonyms: 4-6 per key term, ALL IN CHINESE, covering direct synonyms, broader terms, related academic jargon
- precisionQueries = exact phrase searches in Chinese
- broadQueries = Chinese synonyms connected with OR
- filters: same as English mode (yearFrom, yearTo, etc.)
- SEPARATE search terms from quality requirements`;

export async function buildSmartSearchPlan(
  input: string,
  provider: AIProvider = "deepseek-fast",
  journalLang: JournalLang = "en"
): Promise<SmartSearchPlan> {
  try {
    const system = journalLang === "zh" ? EXTRACT_SYSTEM_ZH : EXTRACT_SYSTEM;
    console.log(`[smart-search] Calling AI provider: ${provider}, lang: ${journalLang}`);
    const response = await callAI({
      provider,
      system,
      messages: [{ role: "user", content: input }],
      jsonMode: true,
      noThinking: true,
      temperature: 0.2,
      maxTokens: 1500,
    });

    console.log(`[smart-search] AI response (${response.provider}):`, response.content.slice(0, 200));
    return JSON.parse(response.content) as SmartSearchPlan;
  } catch (err) {
    console.error(`[smart-search] AI call failed:`, err instanceof Error ? err.message : String(err));
    // Fallback: extract English phrases and meaningful Chinese terms
    const cleaned = input
      .replace(/帮我找|有关|的文章|的论文|相关|研究|关于|请|搜索/g, "")
      .trim();

    // Extract quoted phrases and English word groups
    const englishPhrases = cleaned.match(/[a-zA-Z][\w\s-]+[a-zA-Z]/g) ?? [];
    const chineseTerms = cleaned
      .replace(/[a-zA-Z][\w\s-]+[a-zA-Z]/g, "")
      .split(/[,，、;；和与或]/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);

    const terms = [...englishPhrases, ...chineseTerms].filter(Boolean);
    const finalTerms = terms.length > 0 ? terms : [cleaned || input];

    return {
      keyTerms: finalTerms,
      synonyms: {},
      precisionQueries: finalTerms.map((t) => `"${t}"`),
      broadQueries: [finalTerms.join(" ")],
      filters: {},
    };
  }
}

export type JournalLang = "en" | "zh";

export async function smartSearch(
  input: string,
  provider: AIProvider = "deepseek-fast",
  limit: number = 20,
  enableRelevanceScoring: boolean = true,
  onProgress?: (phase: string, detail: string) => void,
  journalLang: JournalLang = "en"
): Promise<SmartSearchResult> {
  const startTime = Date.now();

  // Step 1-2: Extract terms + synonyms
  // Always use deepseek-fast for keyword extraction — fastest for structured extraction
  const extractionProvider: AIProvider = "deepseek-fast";
  onProgress?.("plan", journalLang === "zh" ? "AI 提取中文关键词..." : "AI 提取关键词与同义词...");
  const plan = await buildSmartSearchPlan(input, extractionProvider, journalLang);

  // Pass year filters to search APIs for server-side filtering (much more effective)
  const yearFrom = plan.filters.yearFrom;
  const yearTo = plan.filters.yearTo;

  // Step 3-4: Search strategy
  const isUnlimited = limit >= 999;
  const precisionQueries = plan.precisionQueries.slice(0, isUnlimited ? 15 : 8);
  const broadQueries = plan.broadQueries.slice(0, isUnlimited ? 8 : 5);

  let allResults: Array<{ papers: UnifiedPaper[]; results: SearchResult[] }>;

  if (journalLang === "zh") {
    // ── Chinese mode: CNKI + Google Scholar + OpenAlex + Semantic Scholar ──
    const { searchCNKI } = await import("@/lib/sources/cnki");

    // Use top 4 queries for CNKI, top 2 for free sources
    const cnkiQueries = [...precisionQueries.slice(0, 2), ...broadQueries.slice(0, 2)];
    const freeQueries = [...precisionQueries.slice(0, 2), ...broadQueries.slice(0, 1)];
    const gsChineseQuery = cnkiQueries.join(" OR ");

    // Also prepare English translation for OpenAlex/S2 (they index Chinese papers with English metadata)
    const translatedQuery = plan.translatedInput || input;

    const totalQ = cnkiQueries.length + freeQueries.length + 2;
    onProgress?.("search", `中文检索：CNKI + Google Scholar + OpenAlex + S2（${totalQ} 个查询）...`);

    const searchPromise = Promise.all([
      // CNKI via Serper (site:cnki.net)
      Promise.all(
        cnkiQueries.map((q) =>
          searchCNKI({ query: q, limit: Math.max(20, limit), yearFrom, yearTo })
            .then((r) => ({ papers: r.papers, results: [r] as SearchResult[] }))
            .catch(() => ({ papers: [] as UnifiedPaper[], results: [] as SearchResult[] }))
        )
      ),
      // Google Scholar with Chinese keywords
      searchAllSourcesRaw({
        query: gsChineseQuery, limit: Math.max(40, limit), yearFrom, yearTo,
        sources: ["google_scholar"],
      }).catch(() => ({ papers: [] as UnifiedPaper[], results: [] as SearchResult[] })),
      // OpenAlex + Semantic Scholar with Chinese keywords (they index Chinese journals)
      Promise.all(
        freeQueries.map((q) =>
          searchAllSourcesRaw({ query: q, limit: 20, yearFrom, yearTo, freeOnly: true })
            .catch(() => ({ papers: [] as UnifiedPaper[], results: [] as SearchResult[] }))
        )
      ),
      // Also search with English translation (many Chinese papers have English metadata in OpenAlex/S2)
      searchAllSourcesRaw({ query: translatedQuery, limit: 30, yearFrom, yearTo, freeOnly: true })
        .catch(() => ({ papers: [] as UnifiedPaper[], results: [] as SearchResult[] })),
    ]);

    // 30s hard timeout
    const [cnkiResults, gsResults, freeResults, translatedResults] = await Promise.race([
      searchPromise,
      new Promise<[never[], { papers: never[]; results: never[] }, never[], { papers: never[]; results: never[] }]>((resolve) =>
        setTimeout(() => resolve([[], { papers: [], results: [] }, [], { papers: [], results: [] }]), 30000)
      ),
    ]);

    allResults = [...(cnkiResults ?? []), ...(gsResults ? [gsResults] : []), ...(freeResults ?? []), ...(translatedResults ? [translatedResults] : [])];
  } else {
    // ── English mode: original pipeline ──
    // Google Scholar: merge all precision queries into 1 call, all broad into 1 call
    const gsPrecisionQuery = precisionQueries.join(" OR ");
    const gsBroadQuery = broadQueries.join(" OR ");
    const gsQueries = [gsPrecisionQuery, gsBroadQuery].filter(Boolean);
    // Free source queries: 3 precision + 2 broad (exact-phrase focused)
    const freeQueries = [...precisionQueries.slice(0, 3), ...broadQueries.slice(0, 2)];
    const freeLimit = Math.max(20, Math.ceil((limit * 3) / (freeQueries.length || 1)));
    // Raw semantic query (no quotes, small limit) — supplementary, catches diverse terminology
    const rawSemanticQuery = plan.translatedInput || input;

    const totalQueries = gsQueries.length + freeQueries.length + 1;
    onProgress?.("search", `并行检索 ${totalQueries} 个查询...`);

    // Race all searches against a 30s hard deadline
    const searchPromise = Promise.all([
      // Google Scholar (with extras like arXiv, CORE, etc.)
      Promise.all(
        gsQueries.map((q) =>
          searchAllSourcesRaw({
            query: q, limit: Math.max(40, limit), yearFrom, yearTo,
            sources: ["google_scholar"],
          }).catch(() => ({ papers: [] as UnifiedPaper[], results: [] as SearchResult[] }))
        )
      ),
      // Free sources: precise + broad queries (exact-phrase focused)
      Promise.all(
        freeQueries.map((q) =>
          searchAllSourcesRaw({ query: q, limit: freeLimit, yearFrom, yearTo, freeOnly: true }).catch(() => ({
            papers: [] as UnifiedPaper[],
            results: [] as SearchResult[],
          }))
        )
      ),
      // Raw semantic query (no quotes, limit 20) — supplementary catch-all
      searchAllSourcesRaw({ query: rawSemanticQuery, limit: 20, yearFrom, yearTo, freeOnly: true }).catch(() => ({
        papers: [] as UnifiedPaper[],
        results: [] as SearchResult[],
      })),
    ]);

    // 30s hard timeout — use whatever results we have
    const [gsResults, freeResults, rawResults] = await Promise.race([
      searchPromise,
      new Promise<[typeof gsResults, typeof freeResults, { papers: UnifiedPaper[]; results: SearchResult[] }]>((resolve) =>
        setTimeout(() => {
          console.log("[smart-search] 30s search deadline hit, using partial results");
          resolve([[], [], { papers: [], results: [] }]);
        }, 30000)
      ),
    ]) as [Array<{ papers: UnifiedPaper[]; results: SearchResult[] }>, Array<{ papers: UnifiedPaper[]; results: SearchResult[] }>, { papers: UnifiedPaper[]; results: SearchResult[] }];

    allResults = [...(gsResults ?? []), ...(freeResults ?? []), ...(rawResults ? [rawResults] : [])];
  }
  const totalRaw = allResults.reduce((sum, r) => sum + r.papers.length, 0);
  onProgress?.("dedup", `检索到 ${totalRaw} 条结果，正在去重合并...`);

  // Step 5: Merge and deduplicate — GS results first (as base), free sources supplement
  const seen = new Map<string, UnifiedPaper>();
  const byQuery: Record<string, number> = {};

  // Build human-readable labels for each result set
  let allLabels: string[];
  if (journalLang === "zh") {
    const cnkiQueries = [...plan.precisionQueries.slice(0, 2), ...plan.broadQueries.slice(0, 2)];
    const freeQueries = [...plan.precisionQueries.slice(0, 2), ...plan.broadQueries.slice(0, 1)];
    const translatedQuery = plan.translatedInput || input;
    allLabels = [
      ...cnkiQueries.map((q) => `CNKI: ${q}`),
      `GS: ${cnkiQueries.join(" OR ")}`,
      ...freeQueries.map((q) => `S2+OA: ${q}`),
      `翻译: ${translatedQuery}`,
    ];
  } else {
    const precisionQs = plan.precisionQueries.slice(0, limit >= 999 ? 15 : 8);
    const broadQs = plan.broadQueries.slice(0, limit >= 999 ? 8 : 5);
    const gsPrecisionQuery = precisionQs.join(" OR ");
    const gsBroadQuery = broadQs.join(" OR ");
    const gsQueries = [gsPrecisionQuery, gsBroadQuery].filter(Boolean);
    const freeQs = [...precisionQs.slice(0, 2), ...broadQs.slice(0, 2)];
    const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max - 3) + "..." : s;
    allLabels = [
      ...(gsPrecisionQuery ? [`GS精确: ${truncate(gsPrecisionQuery, 50)}`] : []),
      ...(gsBroadQuery ? [`GS广度: ${truncate(gsBroadQuery, 50)}`] : []),
      ...freeQs.map((q) => `S2+OA: ${truncate(q, 35)}`),
    ];
    // Ensure labels count matches gsQueries + freeQs (gsQueries filters empty)
    if (allLabels.length !== gsQueries.length + freeQs.length) {
      allLabels = allResults.map((_, i) => `query-${i}`);
    }
  }

  for (let i = 0; i < allResults.length; i++) {
    const result = allResults[i];
    const queryLabel = allLabels[i] ?? `query-${i}`;
    byQuery[queryLabel] = result.papers.length;

    for (const paper of result.papers) {
      const key =
        paper.doi?.toLowerCase() ||
        paper.title
          ?.toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fff]/g, "")
          .slice(0, 80);
      if (!key) continue;
      const existing = seen.get(key);
      if (!existing || paper.citationCount > existing.citationCount) {
        seen.set(key, paper);
      }
    }
  }

  // Step 5.5: Cap papers before enrichment
  // Sort by 3-tier priority: P1 (Nature/Science/ABS3+/Q1) → P2 (high citations) → P3 (recent arXiv) → rest
  const allDeduped = Array.from(seen.values());
  allDeduped.sort((a, b) => {
    const aTier = getPriorityTier(a);
    const bTier = getPriorityTier(b);
    if (aTier !== bTier) return aTier - bTier;
    return b.citationCount - a.citationCount;
  });
  // Hard cap at 100 — scoring 200 papers causes SSE timeout
  // Cap enrichment at limit (30s timeout protects against SSE disconnect)
  const enrichCap = Math.min(allDeduped.length, Math.max(limit, 80));
  const rawPapers = allDeduped.slice(0, enrichCap);
  if (allDeduped.length > enrichCap) {
    onProgress?.("enrich", `去重后 ${allDeduped.length} 篇，按期刊等级 + 引用量保留前 ${enrichCap} 篇，补全摘要 + 期刊元数据...`);
  } else {
    onProgress?.("enrich", `去重后 ${rawPapers.length} 篇，补全摘要 + 期刊元数据...`);
  }

  // Phase 1: Enrichment (fills abstracts from S2, CrossRef, OpenAlex)
  // 30s timeout — if external APIs are slow, continue with partial data
  let enrichedPapers: typeof rawPapers;
  try {
    enrichedPapers = await Promise.race([
      enrichPapersBatch(rawPapers),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("enrich_timeout")), 30000)),
    ]);
  } catch (err) {
    if ((err as Error).message === "enrich_timeout") {
      console.warn("[smart-search] Enrichment timed out after 30s, using partial data");
      onProgress?.("enrich", "元数据补全超时，使用已有数据继续...");
      // Fall back to papers with just journal rankings (sync, always completes)
      const { enrichPapers } = await import("@/lib/sources/aggregator");
      enrichedPapers = enrichPapers(rawPapers);
    } else {
      throw err;
    }
  }

  let papers = enrichedPapers;

  // Step 6: Apply filters from user's quality requirements (BEFORE scoring to avoid wasting API calls)
  const f = plan.filters;
  const totalBeforeFilter = papers.length;

  if (f && Object.keys(f).length > 0) {
    papers = papers.filter((p) => {
      const meta = p.journalMeta;
      const ranking = p.journalRanking;

      // ABS filter
      if (f.minABS && meta?.absRating) {
        const absOrder = ["1", "2", "3", "4", "4*"];
        const paperLevel = absOrder.indexOf(meta.absRating);
        const minLevel = absOrder.indexOf(f.minABS);
        if (paperLevel < minLevel) return false;
      } else if (f.minABS && !meta?.absRating) {
        return false; // No ABS rating = excluded when ABS filter is set
      }

      // SSCI filter
      if (f.requireSSCI && !meta?.ssci) return false;

      // SCI filter
      if (f.requireSCI && !meta?.sci) return false;

      // CSSCI filter
      if (f.requireCSSCI && !meta?.cssci) return false;

      // PKU Core filter
      if (f.requirePKUCore && !meta?.pkuCore) return false;

      // FMS filter
      if (f.requireFMS && !meta?.fms) return false;

      // CAS zone filter
      if (f.minCASZone && meta?.casZone) {
        const zoneOrder = ["四区", "三区", "二区", "一区"];
        const paperZone = zoneOrder.indexOf(meta.casZone);
        const minZone = zoneOrder.indexOf(f.minCASZone);
        if (paperZone < minZone) return false;
      } else if (f.minCASZone && !meta?.casZone) {
        return false;
      }

      // JCR quartile filter
      if (f.minJCR && meta?.jcrQuartile) {
        const jcrOrder = ["Q4", "Q3", "Q2", "Q1"];
        const paperJCR = jcrOrder.indexOf(meta.jcrQuartile);
        const minJCR = jcrOrder.indexOf(f.minJCR);
        if (paperJCR < minJCR) return false;
      } else if (f.minJCR && !meta?.jcrQuartile) {
        return false;
      }

      // CCF rating filter
      if (f.minCCF && meta?.ccfRating) {
        const ccfOrder = ["C", "B", "A"];
        const paperCCF = ccfOrder.indexOf(meta.ccfRating);
        const minCCF = ccfOrder.indexOf(f.minCCF);
        if (paperCCF < minCCF) return false;
      } else if (f.minCCF && !meta?.ccfRating) {
        return false;
      }

      // IF filter
      if (f.minIF && (meta?.impactFactor ?? 0) < f.minIF) return false;

      // Citation filter
      if (f.minCitations && p.citationCount < f.minCitations) return false;

      // Year filter
      if (f.yearFrom && (p.year ?? 0) < f.yearFrom) return false;
      if (f.yearTo && (p.year ?? 9999) > f.yearTo) return false;

      // UTD24 / FT50
      if (f.requireUTD24 && !ranking?.utd24) return false;
      if (f.requireFT50 && !ranking?.ft50) return false;

      // "高质量期刊" — OR logic: paper must match at least ONE quality indicator
      if (f.requireHighQuality) {
        const absOrder = ["1", "2", "3", "4", "4*"];
        const hasABS2Plus = meta?.absRating && absOrder.indexOf(meta.absRating) >= 1; // ABS 2+
        const hasJCRQ1Q2 = meta?.jcrQuartile === "Q1" || meta?.jcrQuartile === "Q2";
        const hasSJRQ1Q2 = meta?.sjrQuartile === "Q1" || meta?.sjrQuartile === "Q2";
        const hasCASTop = meta?.casZone === "一区" || meta?.casZone === "二区";
        const hasCCFAB = meta?.ccfRating === "A" || meta?.ccfRating === "B";
        const hasHighIF = (meta?.impactFactor ?? 0) >= 3;

        const isArxivPreprint = String(p.venue ?? "").toLowerCase().startsWith("arxiv");
        const isHighQuality =
          meta?.ssci || meta?.sci || meta?.cssci || meta?.pkuCore || meta?.fms ||
          ranking?.utd24 || ranking?.ft50 ||
          hasABS2Plus || hasJCRQ1Q2 || hasSJRQ1Q2 || hasCASTop || hasCCFAB || hasHighIF ||
          meta?.conference?.tier === "Top" || meta?.conference?.tier === "A" ||
          isArxivPreprint; // arXiv preprints pass quality filter (will be ranked by relevance later)

        if (!isHighQuality) return false;
      }

      return true;
    });
  }

  // Step 6.5: Pre-scoring truncation — only when paper count is very high (>500)
  // Use citation count as primary signal (universally available, correlates with relevance)
  // Journal grade as secondary — avoids discarding niche-venue papers that may be highly relevant
  if (limit < 999 && papers.length > 500) {
    papers.sort((a, b) => b.citationCount - a.citationCount);
    const candidatePool = Math.max(limit * 5, 200);
    papers = papers.slice(0, candidatePool);
    onProgress?.("truncate", `按引用量排序，保留前 ${papers.length} 篇候选进入评分`);
  }

  // Step 7: Two-phase scoring pipeline
  // Phase 1: Fast abstract-based scoring to narrow down candidates
  // Phase 2: Full text fetch + deep scoring for top candidates only (quality tiers)
  const isQualityTier = limit <= 50;
  const totalBeforeRelevance = papers.length;
  let scoredPapers: ScoredPaper[];
  let relevanceScored = false;

  if (enableRelevanceScoring && papers.length > 0) {
    // Phase 1: Quick abstract-based scoring (ALL papers)
    onProgress?.("score", `AI 摘要快速评分: 0/${papers.length} 篇...`);
    try {
      // Always use deepseek-fast for scoring — fastest + cheapest for structured JSON
      scoredPapers = await scoreRelevance(papers, input, plan.translatedInput, "deepseek-fast",
        (scored, total) => onProgress?.("score", `AI 摘要快速评分: ${scored}/${total} 篇...`)
      );
      scoredPapers = filterByRelevance(scoredPapers, 3); // Lower threshold for first pass
      relevanceScored = true;
    } catch (err) {
      console.error("[smart-search] abstract scoring failed:", err);
      scoredPapers = papers.map((p) => ({ ...p, relevanceScore: undefined }));
    }

    // Phase 2: Full-text fetching is DEFERRED — results are returned first,
    // full text is fetched later via the /api/papers/fulltext endpoint.
    // This prevents the search from hanging on slow/unreachable PDF sources.
  } else {
    scoredPapers = papers.map((p) => ({ ...p, relevanceScore: undefined }));
  }

  // Step 9: Tiered quality filtering based on user-selected limit
  const finalPapers = applyTieredLimit(scoredPapers, limit, relevanceScored, journalLang);

  // Step 10: Optional SPECTER2 semantic re-ranking for quality tiers
  if (isQualityTier && finalPapers.length > 0) {
    try {
      const { findSimilarPapers, isSpecterAvailable } = await import("@/lib/sources/specter");
      if (isSpecterAvailable()) {
        onProgress?.("semantic", "SPECTER2 语义相似度重排序...");
        const similarities = await findSimilarPapers(
          plan.translatedInput || input,
          undefined,
          finalPapers.map(p => ({ title: p.title, abstract: p.abstract, doi: p.doi })),
          finalPapers.length,
        );

        // Blend SPECTER2 similarity score with existing relevance score
        for (const sim of similarities) {
          const paper = finalPapers.find(p => p.title === sim.title);
          if (paper && paper.relevanceScore != null) {
            const semanticScore = sim.similarity * 10;
            paper.relevanceScore = paper.relevanceScore * 0.7 + semanticScore * 0.3;
          }
        }

        finalPapers.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
        console.log(`[smart-search] SPECTER2 re-ranking applied to ${similarities.length} papers`);
      }
    } catch (err) {
      console.error("[smart-search] SPECTER2 re-ranking failed:", (err as Error).message);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withFullText = finalPapers.filter((p: any) => p.hasFullText).length;
  const withAbstract = finalPapers.filter((p) => p.abstract && p.abstract.length > 100).length;

  return {
    plan,
    papers: finalPapers,
    stats: {
      total: finalPapers.length,
      totalBeforeFilter,
      totalBeforeRelevance,
      byQuery,
      durationMs: Date.now() - startTime,
      relevanceScored,
      googleScholarAvailable: !(globalThis as Record<string, unknown>).__serpapi_exhausted,
      withFullText,
      withAbstractOnly: withAbstract - withFullText,
    },
  };
}
