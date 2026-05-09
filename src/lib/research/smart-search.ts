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
import { searchOpenAlexByJournals } from "@/lib/sources/openalex";
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
  /** Specific journal names user wants to search in (e.g. ["Nature", "Science"]) */
  targetJournals?: string[];
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

/** Sort: relevance → citations → journal grade */
function sortByQuality(papers: ScoredPaper[]): ScoredPaper[] {
  return papers.sort((a, b) => {
    // Primary: relevance score
    const scoreA = a.relevanceScore ?? 0;
    const scoreB = b.relevanceScore ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;

    // Secondary: citation count (same score → higher citations = more authoritative)
    if (b.citationCount !== a.citationCount) return b.citationCount - a.citationCount;

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

STEP 3 — EXTRACT KEY TERMS: From the English translation, extract 3-6 core academic search terms. Each term must be a complete, meaningful academic phrase.
NEVER break compound terms: "AI washing" is ONE term, not "AI" + "washing".

CRITICAL — BIDIRECTIONAL INTERPRETATION: When two concepts A and B are mentioned together (e.g. "AI与碳排放"), ALWAYS consider BOTH causal directions:
- A affects B (e.g. "AI's carbon emissions" — AI training causes CO2)
- B is affected by A (e.g. "AI for decarbonization" — AI helps reduce emissions)
- A and B interact (e.g. "AI climate policy" — the intersection)
You MUST generate key terms covering ALL directions. Missing one direction = missing half the literature.
Example: "AI与碳排放" → MUST include ALL of:
  - "AI carbon footprint" (AI causes emissions)
  - "AI for decarbonization" (AI helps reduce emissions)
  - "AI net-zero emissions" (AI's role in achieving net-zero — this is the term Nature/Science uses!)
  - "AI climate mitigation" (AI for climate action)
  - "AI energy consumption" (AI's energy/power usage)
  - "sustainable AI" (making AI itself greener)
Example: "数字化转型与员工" → BOTH "digital transformation employee displacement" AND "digital transformation employee empowerment"

ALSO CRITICAL — SEMANTIC BREADTH: For any concept like "碳排放" (carbon emissions), you MUST include the FULL semantic family, not just the literal translation:
  "carbon emissions" → also "CO2 emissions", "greenhouse gas", "net-zero", "climate change", "global warming", "decarbonization", "emission reduction", "carbon neutrality"
  Missing "net-zero" when searching for "carbon emissions" = missing landmark Nature/Science papers!

For METHODOLOGICAL queries, you MUST:
- Include the domain + method as a combined term (e.g. "recruitment data analysis")
- Include specific methodological terms used in the field (e.g. "text mining job postings", "NLP hiring data", "web scraping job ads")
- Think about what CONCRETE methods researchers actually use in this domain
- Do NOT just list synonyms of the domain — focus on METHOD + DOMAIN combinations

For RELATIONAL queries:
- Include the full relationship as one term (e.g. "ESG corporate innovation")
- Include each variable separately for broader coverage

STEP 4 — SYNONYMS (CRITICAL — most important step): For each key term, list 10-15 English synonyms and semantically related terms. Be MAXIMALLY EXHAUSTIVE — cover ALL 8 dimensions below:

Dimension 1: DIRECT SYNONYMS — exact same concept, different wording
  e.g. "AI washing" → "AI greenwashing", "artificial intelligence washing"

Dimension 2: BROADER CATEGORY — parent concepts or umbrella terms
  e.g. "AI washing" → "technology greenwashing", "digital deception", "corporate digital fraud"

Dimension 3: NARROWER SUBTYPES — specific instances or manifestations
  e.g. "AI sycophancy" → "reward hacking", "specification gaming", "preference falsification", "people-pleasing AI"

Dimension 4: ADJACENT RESEARCH STREAMS — different fields studying the SAME phenomenon
  e.g. "AI sycophancy" → "AI alignment", "AI safety", "value misalignment", "RLHF failure modes", "human feedback bias"
  e.g. "AI谄媚" → researchers in HCI call it "AI agreeableness", in philosophy it's "epistemic deference"

Dimension 5: FORMAL ACADEMIC TERMS — the precise terminology used in Nature/Science/top journals
  e.g. "AI谄媚" → "sycophancy" (NOT just "flattery"), "sycophantic behavior", "AI sycophant"
  e.g. "AI幻觉" → "hallucination" AND "confabulation" AND "factual grounding failure"
  e.g. "大模型对齐" → "alignment", "RLHF", "constitutional AI", "preference optimization"

Dimension 6: CAUSE/EFFECT/MECHANISM terms — what causes it or what it leads to
  e.g. "AI sycophancy" → "output bias from RLHF", "human feedback loop", "reward model overoptimization"

Dimension 7: MEASUREMENT/METHOD terms — how researchers study this phenomenon
  e.g. "AI sycophancy" → "sycophancy benchmark", "opinion conformity test", "user study AI agreement"

Dimension 8: HISTORICAL/FOUNDATIONAL terms — how the concept was referred to before the current term emerged
  e.g. "AI sycophancy" → "yes-man AI", "AI obsequiousness" (older/informal), "social desirability bias in AI"

CRITICAL RULES:
- For Chinese concepts, ALWAYS include the MOST FORMAL English academic term, not just literal translation
- Think: "What would a Nature/Science paper title say?" — use THAT term
- Each key term MUST have at least 10 synonyms covering at least 5 of the 8 dimensions above
- Missing a synonym = missing a landmark paper from a top journal
- For emerging topics (2023+), include BOTH the new term AND the older terms the concept was known by
- For RELATIONAL/TOPICAL queries with two concepts (A与B), generate synonyms for BOTH directions:
  Direction 1: A→B (how A affects/causes B)
  Direction 2: B→A (how B is addressed/mitigated by A)
  Example: "AI carbon emissions" synonyms must include BOTH "AI training carbon footprint" AND "AI for decarbonization", "AI climate mitigation", "AI net-zero", "machine learning emission reduction"

STEP 5 — BUILD QUERIES: Construct precision and broad search queries.
- precisionQueries (5-8): Each key term + top synonyms as exact-phrase searches. Include at least one query using Dimension 4 (adjacent stream) and Dimension 5 (formal academic term) synonyms.
- broadQueries (3-5): OR-combined synonym groups. Ensure one query covers Dimensions 1-3, another covers Dimensions 4-6, and a third covers Dimensions 5-8. This maximizes coverage across different research communities.

For METHODOLOGICAL queries, also include queries like:
- "methodology" OR "method" combined with the domain
- Specific technique names combined with the domain data source

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
- Specific journal names: "发表在Nature/Science的" → filters.targetJournals = ["Nature", "Science"]
  When user mentions journal FAMILIES (e.g. "Nature及其子刊"), expand to ALL sub-journals:
  - "Nature及其子刊/Nature family" → ["Nature", "Nature Machine Intelligence", "Nature Computational Science", "Nature Human Behaviour", "Nature Communications", "Nature Electronics"]
  - "Science及其子刊/Science family" → ["Science", "Science Advances", "Science Robotics"]
  - "管理学顶刊" / "UTD24" → filters.requireUTD24 = true (use filter, not targetJournals)
  IMPORTANT: targetJournals uses EXACT English journal names. Always use official English names.

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
    "requireSSCI": true,
    "targetJournals": ["Nature", "Science"]
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
- precisionQueries = each keyTerm as exact phrase + top synonyms as exact phrases (5-8 total), ALL IN ENGLISH. Include terms from Dimensions 4 and 5 (adjacent streams + formal terms)
- broadQueries = ALL English synonyms connected with OR; different concept groups connected with AND. Generate 3-5 broad queries covering different synonym dimensions to maximize coverage across research communities
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

    // 60s hard timeout
    const [cnkiResults, gsResults, freeResults, translatedResults] = await Promise.race([
      searchPromise,
      new Promise<[never[], { papers: never[]; results: never[] }, never[], { papers: never[]; results: never[] }]>((resolve) =>
        setTimeout(() => resolve([[], { papers: [], results: [] }, [], { papers: [], results: [] }]), 60000)
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

    // 60s hard timeout — use whatever results we have
    const [gsResults, freeResults, rawResults] = await Promise.race([
      searchPromise,
      new Promise<[typeof gsResults, typeof freeResults, { papers: UnifiedPaper[]; results: SearchResult[] }]>((resolve) =>
        setTimeout(() => {
          console.log("[smart-search] 60s search deadline hit, using partial results");
          resolve([[], [], { papers: [], results: [] }]);
        }, 60000)
      ),
    ]) as [Array<{ papers: UnifiedPaper[]; results: SearchResult[] }>, Array<{ papers: UnifiedPaper[]; results: SearchResult[] }>, { papers: UnifiedPaper[]; results: SearchResult[] }];

    allResults = [...(gsResults ?? []), ...(freeResults ?? []), ...(rawResults ? [rawResults] : [])];
  }

  // ── Targeted journal search (when user specifies specific journals) ──
  // Dual strategy: OpenAlex source ID filter + Google Scholar source: operator
  const targetJournals = plan.filters.targetJournals;
  if (targetJournals && targetJournals.length > 0) {
    onProgress?.("journal-search", `定向检索指定期刊: ${targetJournals.join(", ")}...`);
    const topicQuery = plan.translatedInput || input;
    try {
      // Strategy 1: OpenAlex source ID filter (most precise)
      // Strategy 2: Google Scholar source:"journal" operator (catches papers OpenAlex may miss)
      const gsJournalQueries = targetJournals.slice(0, 3).map(j =>
        `source:"${j}" ${topicQuery}`
      );
      const [oaResults, ...gsJournalResults] = await Promise.all([
        searchOpenAlexByJournals(topicQuery, targetJournals, { yearFrom, yearTo, limit: 50 }),
        ...gsJournalQueries.map(q =>
          searchAllSourcesRaw({
            query: q, limit: 20, yearFrom, yearTo,
            sources: ["google_scholar"],
          }).catch(() => ({ papers: [] as UnifiedPaper[], results: [] as SearchResult[] }))
        ),
      ]);
      if (oaResults.length > 0) {
        allResults.push({ papers: oaResults, results: [] as SearchResult[] });
      }
      for (const r of gsJournalResults) {
        if (r.papers.length > 0) allResults.push(r);
      }
      const totalJournal = oaResults.length + gsJournalResults.reduce((s, r) => s + r.papers.length, 0);
      console.log(`[smart-search] Targeted journal search found ${totalJournal} papers (OA: ${oaResults.length}, GS: ${totalJournal - oaResults.length})`);
    } catch (err) {
      console.error("[smart-search] Targeted journal search failed:", err);
    }
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
  // Cap enrichment at limit (60s timeout protects against SSE disconnect)
  const enrichCap = Math.min(allDeduped.length, Math.max(limit, 80));
  const rawPapers = allDeduped.slice(0, enrichCap);
  if (allDeduped.length > enrichCap) {
    onProgress?.("enrich", `去重后 ${allDeduped.length} 篇，按期刊等级 + 引用量保留前 ${enrichCap} 篇，补全摘要 + 期刊元数据...`);
  } else {
    onProgress?.("enrich", `去重后 ${rawPapers.length} 篇，补全摘要 + 期刊元数据...`);
  }

  // Phase 1: Enrichment (fills abstracts from S2, CrossRef, OpenAlex)
  // 60s timeout — if external APIs are slow, continue with partial data
  let enrichedPapers: typeof rawPapers;
  try {
    enrichedPapers = await Promise.race([
      enrichPapersBatch(rawPapers),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("enrich_timeout")), 60000)),
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

      // Target specific journals — fuzzy match on venue name
      if (f.targetJournals && f.targetJournals.length > 0) {
        const venue = (p.venue ?? "").toLowerCase();
        const match = f.targetJournals.some(j => venue.includes(j.toLowerCase()));
        if (!match) return false;
      }

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
