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
import { scoreRelevance, filterByRelevance, type ScoredPaper } from "./relevance-scorer";

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
  };
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

STEP 4 — SYNONYMS: For each key term, list 5-8 English synonyms and closely related terms actually used in academic papers. Be EXHAUSTIVE — think from multiple angles:
- Direct synonyms (e.g. "AI washing" → "AI greenwashing")
- Broader category terms (e.g. "AI washing" → "technology greenwashing", "digital washing")
- Related misconduct terms (e.g. "AI washing" → "AI fraud", "AI snake oil", "AI theater")
- Academic jargon variants (e.g. "AI washing" → "performative AI adoption", "symbolic AI")
- Abbreviated or informal forms used in papers
- Terms used in adjacent research streams that study the same phenomenon

The goal is to catch ALL relevant papers, not just the obvious ones. Missing a relevant synonym = missing relevant papers.
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

export async function buildSmartSearchPlan(
  input: string,
  provider: AIProvider = "gemini"
): Promise<SmartSearchPlan> {
  try {
    console.log(`[smart-search] Calling AI provider: ${provider}`);
    const response = await callAI({
      provider,
      system: EXTRACT_SYSTEM,
      messages: [{ role: "user", content: input }],
      jsonMode: true,
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

export async function smartSearch(
  input: string,
  provider: AIProvider = "gemini",
  limit: number = 20,
  enableRelevanceScoring: boolean = true,
  onProgress?: (phase: string, detail: string) => void
): Promise<SmartSearchResult> {
  const startTime = Date.now();

  // Step 1-2: Extract terms + synonyms
  onProgress?.("plan", "AI 提取关键词与同义词...");
  const plan = await buildSmartSearchPlan(input, provider);

  // Pass year filters to search APIs for server-side filtering (much more effective)
  const yearFrom = plan.filters.yearFrom;
  const yearTo = plan.filters.yearTo;

  // Step 3-4: Search strategy — conserve SerpAPI credits
  // Google Scholar: merge all precision queries into 1 call, all broad into 1 call = 2 SerpAPI calls total
  // Free sources: all queries in parallel
  // For unlimited mode (limit >= 999), use more queries for broader coverage
  const isUnlimited = limit >= 999;
  const precisionQueries = plan.precisionQueries.slice(0, isUnlimited ? 10 : 5);
  const broadQueries = plan.broadQueries.slice(0, isUnlimited ? 5 : 3);

  // Merge queries for Google Scholar (1 SerpAPI call each)
  const gsPrecisionQuery = precisionQueries.join(" OR ");
  const gsBroadQuery = broadQueries.join(" OR ");

  // Phase A+B: Google Scholar + Free sources — ALL in parallel
  // GS queries run concurrently with free-source queries for maximum speed
  const gsQueries = [gsPrecisionQuery, gsBroadQuery].filter(Boolean);
  const allQueries = [...precisionQueries, ...broadQueries];

  onProgress?.("search", `并行检索 ${gsQueries.length + allQueries.length} 个查询...`);
  const [gsResults, freeResults] = await Promise.all([
    // Google Scholar: all queries in parallel
    Promise.all(
      gsQueries.map((q) =>
        searchAllSourcesRaw({
          query: q, limit: Math.max(40, limit), yearFrom, yearTo,
          sources: ["google_scholar"],
        }).catch(() => ({ papers: [] as UnifiedPaper[], results: [] as SearchResult[] }))
      )
    ),
    // Free sources: all queries in parallel
    Promise.all(
      allQueries.map((q) =>
        searchAllSourcesRaw({ query: q, limit, yearFrom, yearTo, freeOnly: true }).catch(() => ({
          papers: [] as UnifiedPaper[],
          results: [] as SearchResult[],
        }))
      )
    ),
  ]);

  const allResults = [...gsResults, ...freeResults];
  const totalRaw = allResults.reduce((sum, r) => sum + r.papers.length, 0);
  onProgress?.("dedup", `检索到 ${totalRaw} 条结果，正在去重合并...`);

  // Step 5: Merge and deduplicate — GS results first (as base), free sources supplement
  const seen = new Map<string, UnifiedPaper>();
  const byQuery: Record<string, number> = {};

  // Label GS results
  const allLabels = [...gsQueries.map((q) => `GS: ${q.slice(0, 50)}`), ...allQueries];

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

  // Step 5.5: Enrich abstracts first (fast), THEN score with complete data
  const rawPapers = Array.from(seen.values()).sort((a, b) => b.citationCount - a.citationCount);
  onProgress?.("enrich", `去重后 ${rawPapers.length} 篇，补全摘要 + 期刊元数据...`);

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

        const isArxivPreprint = p.venue?.toLowerCase().startsWith("arxiv");
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

  // Step 7: Score with enriched + filtered papers (all have abstracts now)
  const totalBeforeRelevance = papers.length;
  let scoredPapers: ScoredPaper[];
  let relevanceScored = false;

  if (enableRelevanceScoring && papers.length > 0) {
    onProgress?.("score", `AI 评分: ${papers.length} 篇论文...`);
    try {
      scoredPapers = await scoreRelevance(papers, input, plan.translatedInput, provider);
      scoredPapers = filterByRelevance(scoredPapers, 4);
      relevanceScored = true;
    } catch (err) {
      console.error("[smart-search] scoring failed:", err);
      scoredPapers = papers.map((p) => ({ ...p, relevanceScore: undefined }));
    }
  } else {
    scoredPapers = papers.map((p) => ({ ...p, relevanceScore: undefined }));
  }

  return {
    plan,
    papers: scoredPapers,
    stats: {
      total: scoredPapers.length,
      totalBeforeFilter,
      totalBeforeRelevance,
      byQuery,
      durationMs: Date.now() - startTime,
      relevanceScored,
      googleScholarAvailable: !(globalThis as Record<string, unknown>).__serpapi_exhausted,
    },
  };
}
