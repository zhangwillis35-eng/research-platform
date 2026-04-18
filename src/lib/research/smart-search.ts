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
import { searchAllSources } from "@/lib/sources/aggregator";
import type { UnifiedPaper } from "@/lib/sources/types";

export interface SearchFilters {
  minABS?: "1" | "2" | "3" | "4" | "4*";
  minCASZone?: "一区" | "二区" | "三区" | "四区";
  requireSSCI?: boolean;
  requireSCI?: boolean;
  minIF?: number;
  minCitations?: number;
  yearFrom?: number;
  yearTo?: number;
  requireUTD24?: boolean;
  requireFT50?: boolean;
}

export interface SmartSearchPlan {
  translatedInput?: string;
  keyTerms: string[];
  synonyms: Record<string, string[]>;
  precisionQueries: string[];
  broadQueries: string[];
  filters: SearchFilters;
}

export interface SmartSearchResult {
  plan: SmartSearchPlan;
  papers: UnifiedPaper[];
  stats: {
    total: number;
    totalBeforeFilter: number;
    byQuery: Record<string, number>;
    durationMs: number;
  };
}

const EXTRACT_SYSTEM = `You are an academic literature search expert. Follow these steps IN ORDER:

STEP 1 — TRANSLATE: If the user's input contains ANY Chinese, first translate the ENTIRE input into English. Remove filler words (帮我找, 有关, 的文章, 相关论文, 请搜索, etc.). Keep only the academic meaning.
Example: "帮我找AI washing的文章" → "AI washing"
Example: "数字化转型与组织韧性的关系" → "digital transformation and organizational resilience"
Example: "ESG对企业创新的影响" → "ESG impact on corporate innovation"

STEP 2 — EXTRACT KEY TERMS: From the English translation, extract 1-4 core academic search terms. Each term must be a complete, meaningful academic phrase.
NEVER break compound terms: "AI washing" is ONE term, not "AI" + "washing".

STEP 3 — SYNONYMS: For each key term, list 2-4 English synonyms actually used in academic papers.

STEP 4 — BUILD QUERIES: Construct precision and broad search queries.

STEP 5 — EXTRACT FILTERS: If the user specifies quality requirements, extract them as filters. These are NOT search terms.
Examples:
- "ABS3星以上" → filters.minABS = "3"
- "SSCI期刊" → filters.requireSSCI = true
- "中科院一区" → filters.minCASZone = "一区"
- "影响因子5以上" → filters.minIF = 5
- "引用100以上" → filters.minCitations = 100
- "UTD24期刊" → filters.requireUTD24 = true
- "FT50" → filters.requireFT50 = true
- "2020年以后" → filters.yearFrom = 2020

Output STRICT JSON only:
{
  "translatedInput": "the full English translation (search part only, not filters)",
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

RULES:
- keyTerms = complete English academic phrases, NEVER single letters or broken words
- precisionQueries = each keyTerm wrapped in double quotes
- broadQueries = synonyms connected with OR; different concept groups connected with AND
- If only one concept, broadQuery = all synonyms joined with OR
- filters: only include fields the user explicitly mentioned. If no filters mentioned, return empty object {}
- SEPARATE search terms from quality requirements. "ABS3星以上" is a FILTER, not a search term`;

export async function buildSmartSearchPlan(
  input: string,
  provider: AIProvider = "gemini"
): Promise<SmartSearchPlan> {
  try {
    const response = await callAI({
      provider,
      system: EXTRACT_SYSTEM,
      messages: [{ role: "user", content: input }],
      jsonMode: true,
      temperature: 0.2,
    });

    return JSON.parse(response.content) as SmartSearchPlan;
  } catch {
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
  limit: number = 20
): Promise<SmartSearchResult> {
  const startTime = Date.now();

  // Step 1-2: Extract terms + synonyms
  const plan = await buildSmartSearchPlan(input, provider);

  // Step 3: Precision search (each key term separately)
  const precisionPromises = plan.precisionQueries.slice(0, 3).map((q) =>
    searchAllSources({ query: q, limit }).catch(() => ({
      papers: [] as UnifiedPaper[],
      results: [],
    }))
  );

  // Step 4: Broad search (with synonyms)
  const broadPromises = plan.broadQueries.slice(0, 2).map((q) =>
    searchAllSources({ query: q, limit }).catch(() => ({
      papers: [] as UnifiedPaper[],
      results: [],
    }))
  );

  const allResults = await Promise.all([...precisionPromises, ...broadPromises]);

  // Step 5: Merge and deduplicate
  const seen = new Map<string, UnifiedPaper>();
  const byQuery: Record<string, number> = {};
  const allQueries = [...plan.precisionQueries.slice(0, 3), ...plan.broadQueries.slice(0, 2)];

  for (let i = 0; i < allResults.length; i++) {
    const result = allResults[i];
    const queryLabel = allQueries[i] ?? `query-${i}`;
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

  let papers = Array.from(seen.values()).sort(
    (a, b) => b.citationCount - a.citationCount
  );

  // Step 6: Apply filters from user's quality requirements
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

      // CAS zone filter
      if (f.minCASZone && meta?.casZone) {
        const zoneOrder = ["四区", "三区", "二区", "一区"];
        const paperZone = zoneOrder.indexOf(meta.casZone);
        const minZone = zoneOrder.indexOf(f.minCASZone);
        if (paperZone < minZone) return false;
      } else if (f.minCASZone && !meta?.casZone) {
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

      return true;
    });
  }

  return {
    plan,
    papers,
    stats: {
      total: papers.length,
      totalBeforeFilter,
      byQuery,
      durationMs: Date.now() - startTime,
    },
  };
}
