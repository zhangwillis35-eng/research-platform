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

/** Check if a paper is from a quality source (ABS 3+, JCR Q1, arXiv) — used for pre-enrichment cap */
function isQualitySource(p: UnifiedPaper): boolean {
  const venue = String(p.venue ?? "").toLowerCase() ?? "";
  // arXiv preprints
  if (venue.startsWith("arxiv") || venue.includes("arxiv")) return true;
  // JCR Q1
  if (p.journalMeta?.jcrQuartile === "Q1") return true;
  // ABS 3 or above
  const absOrder = ["1", "2", "3", "4", "4*"];
  if (p.journalMeta?.absRating && absOrder.indexOf(p.journalMeta.absRating) >= 2) return true;
  // SSCI / SCI indexed
  if (p.journalMeta?.ssci || p.journalMeta?.sci) return true;
  // UTD24 / FT50
  if (p.journalRanking?.utd24 || p.journalRanking?.ft50) return true;
  // Top conferences (CHI, CSCW, NeurIPS, ICML, etc.)
  if (p.journalMeta?.conference?.tier === "Top" || p.journalMeta?.conference?.tier === "A") return true;
  return false;
}

function isTopTierJournal(p: ScoredPaper): boolean {
  const meta = p.journalMeta;
  if (!meta) return false;

  // arXiv preprints always pass
  if (String(p.venue ?? "").toLowerCase().startsWith("arxiv")) return true;

  // JCR Q1 (covers both SSCI Q1 and SCI Q1)
  if (meta.jcrQuartile === "Q1") return true;

  // ABS 3 star and above
  const absOrder = ["1", "2", "3", "4", "4*"];
  if (meta.absRating && absOrder.indexOf(meta.absRating) >= 2) return true;

  return false;
}

function isQ2Journal(p: ScoredPaper): boolean {
  return p.journalMeta?.jcrQuartile === "Q2";
}

/** Sort by relevance (desc), then journal grade (desc), then IF (desc), then citations (desc) */
function sortByQuality(papers: ScoredPaper[]): ScoredPaper[] {
  return papers.sort((a, b) => {
    // Primary: relevance score
    const scoreA = a.relevanceScore ?? 0;
    const scoreB = b.relevanceScore ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;

    // Secondary: journal grade (UTD24/FT50 > JCR Q1 > Q2 > ...)
    const jcrOrder: Record<string, number> = { Q1: 4, Q2: 3, Q3: 2, Q4: 1 };
    const aGrade = (a.journalRanking?.utd24 ? 10 : 0) + (a.journalRanking?.ft50 ? 10 : 0) +
      (jcrOrder[a.journalMeta?.jcrQuartile ?? ""] ?? 0);
    const bGrade = (b.journalRanking?.utd24 ? 10 : 0) + (b.journalRanking?.ft50 ? 10 : 0) +
      (jcrOrder[b.journalMeta?.jcrQuartile ?? ""] ?? 0);
    if (bGrade !== aGrade) return bGrade - aGrade;

    // Tertiary: impact factor
    const aIF = a.journalMeta?.impactFactor ?? 0;
    const bIF = b.journalMeta?.impactFactor ?? 0;
    if (aIF !== bIF) return bIF - aIF;

    // Quaternary: citations
    return b.citationCount - a.citationCount;
  });
}

function applyTieredLimit(papers: ScoredPaper[], limit: number, relevanceScored: boolean, journalLang: JournalLang = "en"): ScoredPaper[] {
  // Chinese journals don't have UTD24/FT50/ABS rankings — skip quality filter
  if (journalLang === "zh") {
    const sorted = sortByQuality(papers);
    if (relevanceScored) {
      return sorted.filter(p => (p.relevanceScore ?? 0) >= 3).slice(0, limit >= 999 ? sorted.length : limit);
    }
    return sorted.slice(0, limit >= 999 ? sorted.length : limit);
  }
  const sorted = sortByQuality(papers);

  if (limit >= 999) {
    // Unlimited: keep all with relevance ≥ 5 (if scored), no journal filter
    if (relevanceScored) {
      return sorted.filter(p => (p.relevanceScore ?? 0) >= 5);
    }
    return sorted;
  }

  if (limit >= 100) {
    // 100: no journal filter, just top 100 by quality
    return sorted.slice(0, 100);
  }

  // 20 or 50: strict quality filter
  const topTier = sorted.filter(isTopTierJournal);

  if (limit <= 20) {
    // 20: only top-tier journals, max 20
    return topTier.slice(0, 20);
  }

  // 50: top-tier first, then relax to Q2 if not enough
  if (topTier.length >= 50) {
    return topTier.slice(0, 50);
  }
  const q2Papers = sorted.filter(p => isQ2Journal(p) && !isTopTierJournal(p));
  const combined = [...topTier, ...q2Papers];
  return combined.slice(0, 50);
}

const EXTRACT_SYSTEM = `You are an academic literature search expert. Follow these steps IN ORDER:

STEP 1 — TRANSLATE: If the user's input contains ANY Chinese, first translate the ENTIRE input into English. Remove filler words (帮我找, 有关, 的文章, 相关论文, 请搜索, etc.). Keep only the academic meaning.
Example: "帮我找AI washing的文章" → "AI washing"
Example: "数字化转型与组织韧性的关系" → "digital transformation and organizational resilience"
Example: "ESG对企业创新的影响" → "ESG impact on corporate innovation"
Example: "企业招聘数据的处理方法" → "methods for processing corporate recruitment data"

STEP 2 — UNDERSTAND QUERY INTENT: Determine the type of research query:
- TOPICAL: user wants papers about a specific topic/phenomenon (e.g. "AI washing")
- RELATIONAL: user wants papers about relationships between variables (e.g. "ESG对企业创新的影响")
- METHODOLOGICAL: user wants papers about methods/techniques/approaches (e.g. "招聘数据的处理方法", "文本分析方法")
- REVIEW: user wants survey/review papers (e.g. "数字化转型综述")

This matters for STEP 3 — different query types need different term extraction strategies.

STEP 3 — EXTRACT KEY TERMS: From the English translation, extract 2-5 core academic search terms. Each term must be a complete, meaningful academic phrase.
NEVER break compound terms: "AI washing" is ONE term, not "AI" + "washing".

For METHODOLOGICAL queries, you MUST:
- Include the domain + method as a combined term (e.g. "recruitment data analysis")
- Include specific methodological terms used in the field (e.g. "text mining job postings", "NLP hiring data", "web scraping job ads")
- Think about what CONCRETE methods researchers actually use in this domain
- Do NOT just list synonyms of the domain — focus on METHOD + DOMAIN combinations

For RELATIONAL queries:
- Include the full relationship as one term (e.g. "ESG corporate innovation")
- Include each variable separately for broader coverage

STEP 4 — SYNONYMS: For each key term, list 8-12 English synonyms and closely related terms actually used in academic papers. Be MAXIMALLY EXHAUSTIVE — think from ALL possible angles:
- Direct synonyms (e.g. "AI washing" → "AI greenwashing")
- Broader category terms (e.g. "AI washing" → "technology greenwashing", "digital washing")
- Related misconduct terms (e.g. "AI washing" → "AI fraud", "AI snake oil", "AI theater")
- Academic jargon variants (e.g. "AI washing" → "performative AI adoption", "symbolic AI")
- Abbreviated or informal forms used in papers
- Terms used in adjacent research streams that study the same phenomenon
- FORMAL ACADEMIC TERMS that might not be obvious translations (e.g. "AI谄媚" → "AI sycophancy" which is the FORMAL term, NOT just "AI flattery")
- Terms used in TOP JOURNALS like Nature, Science (these often use specific terminology)
- Related concepts from AI safety/alignment research (e.g. "reward hacking", "specification gaming", "alignment tax")

CRITICAL: For Chinese concepts, you MUST include the MOST FORMAL and TECHNICAL English translation, not just the colloquial one.
Example: "AI谄媚" → MUST include "sycophancy", "sycophantic behavior", "AI sycophancy" — these are the terms used in Nature/Science papers.
Example: "AI幻觉" → MUST include "hallucination" AND "confabulation" — both are used in top journals.
Example: "大模型对齐" → MUST include "alignment", "RLHF", "constitutional AI", "value alignment"

The goal is to catch ALL relevant papers especially those in Nature/Science/top venues. Missing a relevant synonym = missing a landmark paper.
For METHODOLOGICAL queries, synonyms should include concrete technique names, not just rephrasing.

STEP 5 — BUILD QUERIES: Construct precision and broad search queries.
For METHODOLOGICAL queries, also include queries like:
- "methodology" OR "method" combined with the domain
- Specific technique names (e.g. "text mining", "machine learning", "NLP") combined with the domain data source

STEP 6 — EXTRACT FILTERS: If the user specifies quality requirements OR time ranges, extract them as filters. These are NOT search terms.

IMPORTANT: "高质量期刊" / "好期刊" / "权威期刊" / "核心期刊" / "高水平期刊" → filters.requireHighQuality = true
This means: keep papers from ANY recognized quality index (SSCI, SCI, CSSCI, UTD24, FT50, ABS 2+, JCR Q1-Q2, CCF A/B, 中科院一二区, 北大核心, etc.)
Do NOT interpret "高质量" as only SSCI or only one specific index.

Specific filter examples:
- "ABS3星以上" → filters.minABS = "3"
- "SSCI期刊" → filters.requireSSCI = true
- "SCI期刊" → filters.requireSCI = true
- "CSSCI" / "C刊" / "南大核心" → filters.requireCSSCI = true
- "北大核心" / "中文核心" → filters.requirePKUCore = true
- "中科院一区" → filters.minCASZone = "一区"
- "JCR Q1" / "JCR一区" → filters.minJCR = "Q1"
- "CCF A类" / "CCF-A" → filters.minCCF = "A"
- "CCF B类以上" → filters.minCCF = "B"
- "FMS推荐" → filters.requireFMS = true
- "影响因子5以上" → filters.minIF = 5
- "引用100以上" → filters.minCitations = 100
- "UTD24期刊" → filters.requireUTD24 = true
- "FT50" → filters.requireFT50 = true
- "高质量期刊" / "好期刊" / "权威期刊" → filters.requireHighQuality = true

Year/time filter examples (IMPORTANT — extract ALL time references):
- "2020年以后" / "2020年之后" / "从2020年开始" → filters.yearFrom = 2020
- "2025年以前" / "2025年之前" → filters.yearTo = 2025
- "2025-2026年" / "2025到2026年" / "2025-2026年间" / "发表于2025至2026" → filters.yearFrom = 2025, filters.yearTo = 2026
- "近两年" / "最近两年" → filters.yearFrom = ${new Date().getFullYear() - 2}
- "近三年" → filters.yearFrom = ${new Date().getFullYear() - 3}
- "近五年" → filters.yearFrom = ${new Date().getFullYear() - 5}
- "最新的" / "最近的" / "最新研究" → filters.yearFrom = ${new Date().getFullYear() - 1}
- "今年" → filters.yearFrom = ${new Date().getFullYear()}, filters.yearTo = ${new Date().getFullYear()}

Output STRICT JSON only:
{
  "translatedInput": "the full English translation (search part only, not filters)",
  "queryIntent": "TOPICAL" | "RELATIONAL" | "METHODOLOGICAL" | "REVIEW",
  "keyTerms": ["AI washing"],
  "synonyms": {
    "AI washing": ["AI greenwashing", "artificial intelligence washing", "AI hype", "AI fraud"]
  },
  "precisionQueries": ["\"AI washing\""],
  "broadQueries": ["\"AI washing\" OR \"AI greenwashing\" OR \"artificial intelligence washing\" OR \"AI hype\""],
  "filters": {
    "minABS": "3",
    "requireSSCI": true
  }
}

Example for METHODOLOGICAL query:
Input: "企业招聘数据的处理方法，2025-2026年"
{
  "translatedInput": "methods for processing corporate recruitment data",
  "queryIntent": "METHODOLOGICAL",
  "keyTerms": ["recruitment data processing methodology", "text mining job postings", "online job advertisement data", "labor market analytics"],
  "synonyms": {
    "recruitment data processing methodology": ["hiring data analysis methods", "job posting data methodology", "employment data processing"],
    "text mining job postings": ["NLP job advertisements", "web scraping job ads", "automated job posting analysis"],
    "online job advertisement data": ["online vacancy data", "job board data", "digital hiring data"],
    "labor market analytics": ["workforce analytics", "talent analytics", "HR analytics"]
  },
  "precisionQueries": ["\"recruitment data\" methodology", "\"job posting\" \"text mining\"", "\"online job advertisement\" data analysis"],
  "broadQueries": [
    "(\"recruitment data\" OR \"job posting data\" OR \"hiring data\" OR \"job advertisement data\") AND (methodology OR \"text mining\" OR \"machine learning\" OR \"data processing\" OR NLP OR \"web scraping\")",
    "\"labor market data\" AND (method OR analysis OR processing)"
  ],
  "filters": { "yearFrom": 2025, "yearTo": 2026 }
}

RULES:
- ENGLISH ONLY: ALL keyTerms, synonyms, precisionQueries, and broadQueries MUST be in English. The search targets English-language journals (SSCI, SCI, UTD24, FT50, etc.). NEVER include Chinese terms in any search query — Chinese is reserved exclusively for CNKI searches.
- keyTerms = complete English academic phrases, NEVER single letters or broken words
- synonyms: 5-8 per key term, ALL IN ENGLISH. Cover direct synonyms, broader terms, related concepts, academic jargon variants
- precisionQueries = each keyTerm as exact phrase + top 2-3 most important synonyms as exact phrases (3-5 total), ALL IN ENGLISH
- broadQueries = ALL English synonyms connected with OR; different concept groups connected with AND. Generate 2-3 broad queries with different synonym combinations to maximize coverage
- If only one concept, broadQuery = all English synonyms joined with OR (include ALL of them)
- filters: only include fields the user explicitly mentioned. If no filters mentioned, return empty object {}
- SEPARATE search terms from quality requirements. "ABS3星以上" is a FILTER, not a search term
- ALWAYS extract year/time references into filters — they are NOT search terms`;

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
  onProgress?.("plan", journalLang === "zh" ? "AI 提取中文关键词..." : "AI 提取关键词与同义词...");
  const plan = await buildSmartSearchPlan(input, provider, journalLang);

  // Pass year filters to search APIs for server-side filtering (much more effective)
  const yearFrom = plan.filters.yearFrom;
  const yearTo = plan.filters.yearTo;

  // Step 3-4: Search strategy
  const isUnlimited = limit >= 999;
  const precisionQueries = plan.precisionQueries.slice(0, isUnlimited ? 15 : 8);
  const broadQueries = plan.broadQueries.slice(0, isUnlimited ? 8 : 5);

  let allResults: Array<{ papers: UnifiedPaper[]; results: SearchResult[] }>;

  if (journalLang === "zh") {
    // ── Chinese mode: CNKI (via Serper site:cnki.net) + Google Scholar with Chinese keywords ──
    const { searchCNKI } = await import("@/lib/sources/cnki");

    const cnkiQueries = [...precisionQueries, ...broadQueries];
    const gsChineseQuery = cnkiQueries.join(" OR ");

    onProgress?.("search", `中文检索：CNKI + Google Scholar（${cnkiQueries.length} 个查询）...`);

    const [cnkiResults, gsResults] = await Promise.all([
      // CNKI: search each query independently
      Promise.all(
        cnkiQueries.map((q) =>
          searchCNKI({ query: q, limit: Math.max(20, limit), yearFrom, yearTo })
            .then((r) => ({ papers: r.papers, results: [r] as SearchResult[] }))
            .catch(() => ({ papers: [] as UnifiedPaper[], results: [] as SearchResult[] }))
        )
      ),
      // Google Scholar with Chinese keywords (catches papers indexed by Google but not via site:cnki.net)
      searchAllSourcesRaw({
        query: gsChineseQuery, limit: Math.max(40, limit), yearFrom, yearTo,
        sources: ["google_scholar"],
      }).catch(() => ({ papers: [] as UnifiedPaper[], results: [] as SearchResult[] })),
    ]);

    // Direct search with original Chinese input
    const directResults = await Promise.all(
      plan.keyTerms.slice(0, 3).map((term) =>
        searchCNKI({ query: term, limit: 10, yearFrom, yearTo })
          .then((r) => ({ papers: r.papers, results: [r] as SearchResult[] }))
          .catch(() => ({ papers: [] as UnifiedPaper[], results: [] as SearchResult[] }))
      )
    );

    allResults = [...cnkiResults, gsResults, ...directResults];
  } else {
    // ── English mode: original pipeline ──
    // Google Scholar: merge all precision queries into 1 call, all broad into 1 call
    const gsPrecisionQuery = precisionQueries.join(" OR ");
    const gsBroadQuery = broadQueries.join(" OR ");
    const gsQueries = [gsPrecisionQuery, gsBroadQuery].filter(Boolean);
    // Cap free queries at 4 to avoid 50+ API calls
    const freeQueries = [...precisionQueries.slice(0, 2), ...broadQueries.slice(0, 2)];
    const freeLimit = Math.max(20, Math.ceil((limit * 3) / (freeQueries.length || 1)));

    const totalQueries = gsQueries.length + freeQueries.length;
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
      // Free sources only (S2 + OpenAlex, no extras)
      Promise.all(
        freeQueries.map((q) =>
          searchAllSourcesRaw({ query: q, limit: freeLimit, yearFrom, yearTo, freeOnly: true }).catch(() => ({
            papers: [] as UnifiedPaper[],
            results: [] as SearchResult[],
          }))
        )
      ),
    ]);

    // 30s hard timeout — use whatever results we have
    const [gsResults, freeResults] = await Promise.race([
      searchPromise,
      new Promise<[typeof gsResults, typeof freeResults]>((resolve) =>
        setTimeout(() => {
          console.log("[smart-search] 30s search deadline hit, using partial results");
          resolve([[], []]);
        }, 30000)
      ),
    ]) as [Array<{ papers: UnifiedPaper[]; results: SearchResult[] }>, Array<{ papers: UnifiedPaper[]; results: SearchResult[] }>];

    allResults = [...(gsResults ?? []), ...(freeResults ?? [])];
  }
  const totalRaw = allResults.reduce((sum, r) => sum + r.papers.length, 0);
  onProgress?.("dedup", `检索到 ${totalRaw} 条结果，正在去重合并...`);

  // Step 5: Merge and deduplicate — GS results first (as base), free sources supplement
  const seen = new Map<string, UnifiedPaper>();
  const byQuery: Record<string, number> = {};

  // Label results for logging
  const allLabels = allResults.map((_, i) => `query-${i}`);

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

  // Step 5.5: Cap papers before enrichment — never enrich more than we could need
  // Priority: quality-source papers first (ABS 3+, JCR Q1, arXiv), then by citations
  // This preserves recent high-quality papers that have low citations due to recency
  const allDeduped = Array.from(seen.values());
  allDeduped.sort((a, b) => {
    // Tier 1: Quality source papers always come first
    const aQuality = isQualitySource(a) ? 1 : 0;
    const bQuality = isQualitySource(b) ? 1 : 0;
    if (aQuality !== bQuality) return bQuality - aQuality;
    // Tier 2: Within same tier, sort by citations
    return b.citationCount - a.citationCount;
  });
  const enrichCap = Math.min(allDeduped.length, Math.max(limit * 2, 80));
  const rawPapers = allDeduped.slice(0, enrichCap);
  if (allDeduped.length > enrichCap) {
    onProgress?.("enrich", `去重后 ${allDeduped.length} 篇，按引用量保留前 ${enrichCap} 篇，补全摘要 + 期刊元数据...`);
  } else {
    onProgress?.("enrich", `去重后 ${rawPapers.length} 篇，补全摘要 + 期刊元数据...`);
  }

  // Phase 1: Enrichment (fills abstracts from S2, CrossRef, OpenAlex)
  const enrichedPapers = await enrichPapersBatch(rawPapers);

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
    onProgress?.("score", `AI 摘要快速评分: ${papers.length} 篇...`);
    try {
      scoredPapers = await scoreRelevance(papers, input, plan.translatedInput, provider);
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
