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
import { FT50_JOURNALS, UTD24_JOURNALS } from "@/lib/sources/journal-rankings";
import type { SearchResult } from "@/lib/sources/types";
import type { UnifiedPaper } from "@/lib/sources/types";
import { scoreRelevance, type ScoredPaper } from "./relevance-scorer";

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
  if (year >= currentYear && cited > 1) return true;         // 2026+: > 1
  if (year === currentYear - 1 && cited > 5) return true;    // 2025: > 5
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

/** Sort by tiered relevance bands, then citations within each band.
 *  Band A (8-10): highest relevance — sort by citations (most impactful first)
 *  Band B (6-7):  good relevance — sort by citations
 *  Band C (≤5):   marginal — keep original relevance order, then citations
 *  Unscored (null): placed after Band C, sorted by citations
 */
function sortByQuality(papers: ScoredPaper[]): ScoredPaper[] {
  return papers.sort((a, b) => {
    const scoreA = a.relevanceScore ?? -1;
    const scoreB = b.relevanceScore ?? -1;

    // If both scored: sort by relevance band, then citations
    if (scoreA >= 0 && scoreB >= 0) {
      const bandOf = (s: number) => s >= 8 ? 0 : s >= 6 ? 1 : 2;
      const bandA = bandOf(scoreA);
      const bandB = bandOf(scoreB);
      if (bandA !== bandB) return bandA - bandB;
      if (scoreB !== scoreA) return scoreB - scoreA;
      if (b.citationCount !== a.citationCount) return b.citationCount - a.citationCount;
      return (a.title ?? "").localeCompare(b.title ?? "");
    }

    // If only one scored, scored paper wins
    if (scoreA >= 0) return -1;
    if (scoreB >= 0) return 1;

    // Both unscored: fall back to priority tier + citations
    const aTier = getPriorityTier(a);
    const bTier = getPriorityTier(b);
    if (aTier !== bTier) return aTier - bTier;
    if (b.citationCount !== a.citationCount) return b.citationCount - a.citationCount;
    return (a.title ?? "").localeCompare(b.title ?? "");
  });
}

function applyTieredLimit(papers: ScoredPaper[], limit: number, relevanceScored: boolean, journalLang: JournalLang = "en"): ScoredPaper[] {
  const sorted = sortByQuality(papers);

  // Unlimited mode: return all papers sorted by quality (no aggressive filtering)
  if (limit >= 999) {
    return sorted;
  }

  if (limit >= 100) {
    return sorted.slice(0, 100);
  }

  // 20 or 50: sorted by relevance score (if available) → priority tier → citations
  return sorted.slice(0, limit);
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
      noThinking: true,
      temperature: 0,
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
  journalLang: JournalLang = "en",
  onPaperScored?: (paperIndex: number, score: { score: number; reason?: string; keyMatch?: string[]; contribution?: string; methodology?: string; innovation?: string }) => void
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

    // Per-source timeout wrapper — each source gets 60s
    type RawResultZh = { papers: UnifiedPaper[]; results: SearchResult[] };
    const emptyZh: RawResultZh = { papers: [], results: [] };
    const withTimeoutZh = <T>(p: Promise<T>, fallback: T, label: string, ms = 60000): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((resolve) => setTimeout(() => {
          console.warn(`[smart-search] ${label} timed out after ${ms / 1000}s`);
          resolve(fallback);
        }, ms)),
      ]);

    const [cnkiResults, gsResults, freeResults, translatedResults] = await Promise.all([
      // CNKI via Serper (site:cnki.net)
      withTimeoutZh(
        Promise.all(
          cnkiQueries.map((q) =>
            searchCNKI({ query: q, limit: Math.max(20, limit), yearFrom, yearTo })
              .then((r) => ({ papers: r.papers, results: [r] as SearchResult[] }))
              .catch(() => emptyZh)
          )
        ),
        [] as RawResultZh[], "CNKI", 60000
      ),
      // Google Scholar with Chinese keywords
      withTimeoutZh(
        searchAllSourcesRaw({
          query: gsChineseQuery, limit: Math.max(50, limit), yearFrom, yearTo,
          sources: ["google_scholar"],
        }).catch(() => emptyZh),
        emptyZh, "Google Scholar (ZH)", 60000
      ),
      // OpenAlex + Semantic Scholar with Chinese keywords
      withTimeoutZh(
        Promise.all(
          freeQueries.map((q) =>
            searchAllSourcesRaw({ query: q, limit: 20, yearFrom, yearTo, freeOnly: true })
              .catch(() => emptyZh)
          )
        ),
        [] as RawResultZh[], "Free sources (ZH)", 60000
      ),
      // English translation query
      withTimeoutZh(
        searchAllSourcesRaw({ query: translatedQuery, limit: 30, yearFrom, yearTo, freeOnly: true })
          .catch(() => emptyZh),
        emptyZh, "Translated query", 45000
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
    // Increase per-query limit to cast a wider net (was ~30, now 50)
    const freeLimit = Math.max(50, Math.ceil((limit * 4) / (freeQueries.length || 1)));
    // Raw semantic query (no quotes) — supplementary, catches diverse terminology
    const rawSemanticQuery = plan.translatedInput || input;

    const totalQueries = gsQueries.length + freeQueries.length + 2;
    onProgress?.("search", `并行检索 ${totalQueries} 个查询...`);

    // Run all searches in parallel, each with its own per-source timeout.
    // Use Promise.allSettled so slow/failed sources don't block others.
    type RawResult = { papers: UnifiedPaper[]; results: SearchResult[] };
    const emptyResult: RawResult = { papers: [], results: [] };

    // Per-source timeout wrapper — each source gets 60s to respond
    const withTimeout = <T>(p: Promise<T>, fallback: T, label: string, ms = 60000): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((resolve) => setTimeout(() => {
          console.warn(`[smart-search] ${label} timed out after ${ms / 1000}s`);
          resolve(fallback);
        }, ms)),
      ]);

    const [gsResults, freeResults, rawResults, broadOAResults] = await Promise.all([
      // Google Scholar (with extras like arXiv, CORE, etc.)
      withTimeout(
        Promise.all(
          gsQueries.map((q) =>
            searchAllSourcesRaw({
              query: q, limit: Math.max(50, limit), yearFrom, yearTo,
              sources: ["google_scholar"],
            }).catch(() => emptyResult)
          )
        ),
        [] as RawResult[], "Google Scholar", 60000
      ),
      // Free sources: precise + broad queries (exact-phrase focused)
      withTimeout(
        Promise.all(
          freeQueries.map((q) =>
            searchAllSourcesRaw({ query: q, limit: freeLimit, yearFrom, yearTo, freeOnly: true })
              .catch(() => emptyResult)
          )
        ),
        [] as RawResult[], "Free sources", 60000
      ),
      // Raw semantic query — supplementary catch-all
      withTimeout(
        searchAllSourcesRaw({ query: rawSemanticQuery, limit: 50, yearFrom, yearTo, freeOnly: true })
          .catch(() => emptyResult),
        emptyResult, "Raw semantic", 45000
      ),
      // Broad OpenAlex sweep: 200 results to capture papers from diverse journals
      withTimeout(
        searchAllSourcesRaw({
          query: rawSemanticQuery, limit: 200, yearFrom, yearTo,
          sources: ["openalex"],
        }).catch(() => emptyResult),
        emptyResult, "Broad OpenAlex", 45000
      ),
    ]);

    allResults = [
      ...(gsResults ?? []),
      ...(freeResults ?? []),
      ...(rawResults ? [rawResults] : []),
      ...(broadOAResults?.papers?.length ? [broadOAResults] : []),
    ];
  }

  // ── Targeted journal search (when user specifies specific journals or journal lists) ──
  // When user says "Nature子刊 + FT50", we search ALL those journals via OpenAlex.
  // Dual strategy: OpenAlex source ID filter + Google Scholar source: operator
  const targetJournals = plan.filters.targetJournals ?? [];
  const expandedJournals = new Set(targetJournals.map(j => j.toLowerCase()));

  // Expand to include ALL FT50/UTD24 journals when those filters are set
  if (plan.filters.requireFT50) {
    for (const j of FT50_JOURNALS) expandedJournals.add(j.toLowerCase());
  }
  if (plan.filters.requireUTD24) {
    for (const j of UTD24_JOURNALS) expandedJournals.add(j.toLowerCase());
  }

  const allTargetJournals = [...expandedJournals];

  if (allTargetJournals.length > 0) {
    const labelParts: string[] = [];
    if (targetJournals.length > 0) labelParts.push(targetJournals.slice(0, 5).join(", "));
    if (plan.filters.requireFT50) labelParts.push("FT50 (50刊)");
    if (plan.filters.requireUTD24) labelParts.push("UTD24 (24刊)");
    onProgress?.("journal-search", `定向检索指定期刊: ${labelParts.join(" + ")}...`);

    const topicQuery = plan.translatedInput || input;
    try {
      // Strategy 1: OpenAlex source ID filter (most precise, covers all journals)
      // Strategy 2: Google Scholar source:"journal" operator (for user-specified journals only)
      const gsJournalQueries = targetJournals.slice(0, 3).map(j =>
        `source:"${j}" ${topicQuery}`
      );
      // For large journal lists (FT50=50, UTD24=24), increase OpenAlex limit
      const oaLimit = allTargetJournals.length > 10 ? 100 : 50;
      const [oaResults, ...gsJournalResults] = await Promise.all([
        searchOpenAlexByJournals(topicQuery, allTargetJournals, { yearFrom, yearTo, limit: oaLimit }),
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

  // Step 5.5: Sort all papers by priority tier + citation count
  // P1 (Nature/Science/ABS3+/Q1) → P2 (high citations) → P3 (recent arXiv) → rest
  const allDeduped = Array.from(seen.values());
  allDeduped.sort((a, b) => {
    const aTier = getPriorityTier(a);
    const bTier = getPriorityTier(b);
    if (aTier !== bTier) return aTier - bTier;
    if (b.citationCount !== a.citationCount) return b.citationCount - a.citationCount;
    return (a.title ?? "").localeCompare(b.title ?? "");
  });

  // Take top papers for enrichment (limit + 20 buffer for quality filtering)
  const enrichCap = Math.min(allDeduped.length, limit + 20);
  const rawPapers = allDeduped.slice(0, enrichCap);

  if (allDeduped.length > enrichCap) {
    onProgress?.("enrich", `去重后 ${allDeduped.length} 篇，按期刊等级 + 引用量保留前 ${enrichCap} 篇，补全摘要 + 期刊元数据...`);
  } else {
    onProgress?.("enrich", `去重后 ${rawPapers.length} 篇，补全摘要 + 期刊元数据...`);
  }

  // Enrichment: fill abstracts + journal metadata from S2, CrossRef, OpenAlex
  let enrichedPapers: typeof rawPapers;
  try {
    enrichedPapers = await Promise.race([
      enrichPapersBatch(rawPapers),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("enrich_timeout")), 120000)),
    ]);
  } catch (err) {
    if ((err as Error).message === "enrich_timeout") {
      console.warn("[smart-search] Enrichment timed out after 120s, using partial data");
      onProgress?.("enrich", "元数据补全超时，使用已有数据继续...");
      // enrichPapersBatch creates new objects with journalRanking — on timeout,
      // fall back to basic enrichment (sync, always completes)
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

      // UTD24 / FT50 / Target journals — OR logic when multiple journal-source
      // filters coexist. User says "Nature子刊 + UTD24" meaning papers from
      // Nature family OR UTD24, not Nature AND UTD24.
      const hasJournalSourceFilter =
        f.requireUTD24 || f.requireFT50 ||
        (f.targetJournals && f.targetJournals.length > 0);

      if (hasJournalSourceFilter) {
        const matchesUTD24 = f.requireUTD24 ? !!ranking?.utd24 : false;
        const matchesFT50 = f.requireFT50 ? !!ranking?.ft50 : false;

        let matchesTargetJournal = false;
        if (f.targetJournals && f.targetJournals.length > 0) {
          const venue = (p.venue ?? "").toLowerCase().trim();
          matchesTargetJournal = f.targetJournals.some(j => {
            const target = j.toLowerCase().trim();
            if (venue === target) return true;
            // startsWith but require word boundary after match
            // "nature" matches "nature communications" but not "nature-inspired"
            if (venue.startsWith(target)) {
              return target.length >= venue.length || /[\s,;:]/.test(venue[target.length]);
            }
            if (target.startsWith(venue)) {
              return venue.length >= target.length || /[\s,;:]/.test(target[venue.length]);
            }
            // For targets with multiple words (e.g. "Nature Human Behaviour"),
            // check if venue words are abbreviation-prefixes of target words.
            // "Nat. Hum. Behav." → ["nat", "hum", "behav"] matches ["nature", "human", "behaviour"]
            const venueWords = venue.replace(/\./g, "").split(/\s+/).filter(Boolean);
            const targetWords = target.split(/\s+/).filter(Boolean);
            if (venueWords.length >= 2 && targetWords.length >= 2 && venueWords.length === targetWords.length) {
              const allPrefixMatch = venueWords.every((vw, i) => targetWords[i].startsWith(vw) || vw.startsWith(targetWords[i]));
              if (allPrefixMatch) return true;
            }
            return false;
          });

          // Fallback: check NATURE_SCIENCE_KEYWORDS for Nature/Science family journals
          // This catches abbreviated venue names like "Nat Hum Behav" when the user
          // requests Nature family journals
          if (!matchesTargetJournal) {
            const hasNatureScienceTargets = f.targetJournals.some(j =>
              NATURE_SCIENCE_KEYWORDS.some(k => j.toLowerCase().includes(k))
            );
            if (hasNatureScienceTargets) {
              matchesTargetJournal = NATURE_SCIENCE_KEYWORDS.some(k => {
                // Short generic keywords ("nature", "science", "cell") — require venue to start with them
                // to avoid "management science", "computer science", "nature-inspired" etc.
                if (!k.includes(" ")) {
                  return venue.startsWith(k) && (venue.length === k.length || /[\s,;:]/.test(venue[k.length]));
                }
                // Multi-word keywords ("nature human behav", "science advances") — substring OK
                return venue.includes(k);
              });
            }
          }
        }

        // OR: paper must match at least ONE journal-source condition
        if (!matchesUTD24 && !matchesFT50 && !matchesTargetJournal) return false;
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

    if (papers.length < totalBeforeFilter) {
      onProgress?.("filter", `期刊质量过滤: ${totalBeforeFilter} → ${papers.length} 篇`);
    }
  }

  // Step 7: AI relevance scoring on the pre-selected papers (limit+20 pool)
  // Papers were pre-selected by journal tier + citations — now AI scores for relevance
  const isQualityTier = limit <= 50;
  let scoredPapers: ScoredPaper[];
  let relevanceScored = false;

  if (enableRelevanceScoring && papers.length > 0) {
    onProgress?.("score", `AI 摘要快速评分: 0/${papers.length} 篇...`);
    try {
      scoredPapers = await scoreRelevance(papers, input, plan.translatedInput, "deepseek-fast",
        (scored, total) => onProgress?.("score", `AI 摘要快速评分: ${scored}/${total} 篇...`),
        onPaperScored
      );
      // Don't pre-filter here — let applyTieredLimit handle the final selection
      // Sort by score descending so applyTieredLimit picks best papers first
      scoredPapers.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
      relevanceScored = true;
    } catch (err) {
      console.error("[smart-search] abstract scoring failed:", err);
      scoredPapers = papers.map((p) => ({ ...p, relevanceScore: undefined }));
    }
  } else {
    scoredPapers = papers.map((p) => ({ ...p, relevanceScore: undefined }));
  }

  // Apply tiered limit: P1 → P2 → P3 → rest, up to user's limit
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
      totalBeforeRelevance: papers.length,
      byQuery,
      durationMs: Date.now() - startTime,
      relevanceScored,
      googleScholarAvailable: !(globalThis as Record<string, unknown>).__serpapi_exhausted,
      withFullText,
      withAbstractOnly: withAbstract - withFullText,
    },
  };
}
