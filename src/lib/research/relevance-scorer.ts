/**
 * Post-search LLM relevance re-ranking.
 *
 * Speed-optimized:
 * - NO full-text fetching (uses abstract only — full text is for batch-analyze)
 * - 30 concurrent AI calls (avoids DeepSeek server-side throttling)
 * - Batch mode for 50+ papers (5 papers per AI call)
 * - noThinking mode for fastest structured extraction
 */
import { callAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import type { UnifiedPaper } from "@/lib/sources/types";
import { concurrentPool } from "@/lib/concurrent-pool";

export interface RelevanceScore {
  paperId: string;
  score: number; // 0-10
  reason: string;
  keyMatch: string[];
  contribution: string;
  methodology: string;
  innovation: string;
  dataSource: string;
}

export interface ScoredPaper extends UnifiedPaper {
  relevanceScore?: number;
  relevanceReason?: string;
  relevanceKeyMatch?: string[];
  relevanceContribution?: string;
  relevanceMethodology?: string;
  relevanceInnovation?: string;
  relevanceDataSource?: string;
  hasFullText?: boolean;
}

// 25 concurrent — DeepSeek tolerates this well; fetchWithRetry backs off on 429.
// Raised from 5 so the larger scoring pool (3x limit) finishes in the same wall time.
const SCORING_CONCURRENCY = 25;
// Single mode: 1 paper per LLM call — best score differentiation
const BATCH_SCORING_THRESHOLD = 999; // disabled — always single mode
const SCORING_DEFAULT_PROVIDER: AIProvider = "deepseek-fast";

const SINGLE_SYSTEM = `You are a strict academic paper relevance scorer. Evaluate ONE paper against the user's query.

PROCEDURE (follow IN ORDER — your score must be the CONCLUSION of your analysis, not a first impression):
1. Identify the paper's PRIMARY research question from its title and abstract.
2. Compare it against the user's query: is the query topic the paper's main focus, a secondary aspect, or mere keyword overlap?
3. Write the "reason" field FIRST (2-3 sentences citing keywords from the title), THEN assign a score consistent with that reason.

SCORING RULES (follow EXACTLY):
- 9-10: Paper is a COMPREHENSIVE review/survey of the EXACT query topic, OR a landmark foundational paper defining the field
- 7-8: Paper directly studies the query topic as its PRIMARY focus
- 5-6: Paper is related but the query topic is only a SECONDARY aspect
- 3-4: Paper shares some keywords but studies a DIFFERENT topic
- 0-2: Paper is about a completely unrelated field

CRITICAL: Reserve 9-10 ONLY for comprehensive reviews/surveys and highly-cited foundational works — they should be RARE. You MUST differentiate: do not default to 8. Score 5-6 means the paper is NOT primarily about the query topic.

If "Key search dimensions" are listed, they show the BREADTH of the user's topic (synonyms; for relational queries, both causal directions):
- For a relational query (concept A x concept B), a paper primarily studying the A-B relationship in EITHER direction is on-topic (7-8).
- A paper about only ONE concept that never engages the other concept(s) is AT MOST 5-6, even if it matches a dimension keyword exactly.
- Never require a single paper to cover all dimensions.

Output JSON (Chinese text). "reason" MUST come before "score" and they must be consistent:
{"reason":"先分析：该论文的核心研究问题是什么，与查询主题的关系（2-3句话，引用论文标题中的关键词）","keyMatch":["匹配的概念"],"score":8,"contribution":"该论文的核心贡献（1-2句）","methodology":"研究方法（1句）","innovation":"创新点（1句）","dataSource":"摘要"}`;

const BATCH_SYSTEM = `You are an academic literature relevance scorer. Your ONLY job is to evaluate how well each paper matches the user's SPECIFIC search query.

CRITICAL RULES:
1. Score STRICTLY based on topical relevance to the user's query.
2. You MUST differentiate scores — NOT all papers should get the same score.
3. First mentally RANK papers from most to least relevant, THEN assign scores.

Scoring (0-10):
- 9-10: ONLY for comprehensive reviews/surveys of the EXACT query topic
- 7-8: Paper's PRIMARY focus matches the query topic
- 5-6: Query topic is a SECONDARY aspect of the paper
- 3-4: Shares keywords but studies a DIFFERENT topic
- 0-2: Completely unrelated field

Output a JSON array. Use Chinese for text fields:
[{"index":0,"score":8,"reason":"具体说明为什么给这个分数","keyMatch":["matched concepts"],"contribution":"核心贡献（1-2句）","methodology":"方法（1句）","innovation":"创新点（1句）","dataSource":"摘要"}]`;

function buildSinglePrompt(
  paper: UnifiedPaper,
  userQuery: string,
  translatedQuery: string | undefined,
  keyTerms?: string[]
): string {
  let queryDesc = translatedQuery
    ? `Query: "${userQuery}" (${translatedQuery})`
    : `Query: "${userQuery}"`;
  if (keyTerms && keyTerms.length > 0) {
    queryDesc += `\nKey search dimensions: ${keyTerms.join("; ")}`;
  }

  const ext = paper as any;
  const ctxs = ext._citationContexts as string[] | undefined;
  const tldr = ext._tldr as string | undefined;
  let paperText = `Title: ${paper.title}\nVenue: ${paper.venue ?? "Unknown"}\nAbstract: ${paper.abstract ?? "N/A"}`;
  if (tldr) paperText += `\nTL;DR: ${tldr}`;
  if (ctxs && ctxs.length > 0) {
    paperText += `\nCitation Contexts (what other papers say about this paper):\n${ctxs.slice(0, 5).map(c => `- "${c}"`).join("\n")}`;
  }

  return `${queryDesc}\n\n${paperText}`;
}

function buildBatchPrompt(
  papers: UnifiedPaper[],
  offset: number,
  userQuery: string,
  translatedQuery: string | undefined
): string {
  const queryLine = translatedQuery
    ? `>>> USER QUERY: "${userQuery}" (English: ${translatedQuery}) <<<`
    : `>>> USER QUERY: "${userQuery}" <<<`;

  const papersText = papers
    .map((p, i) => {
      const idx = offset + i;
      const ext = p as any;
      const ctxs = ext._citationContexts as string[] | undefined;
      const tldr = ext._tldr as string | undefined;
      let text = `[${idx}] Title: ${p.title}\nVenue: ${p.venue ?? "Unknown"}\nAbstract: ${(p.abstract ?? "N/A").slice(0, 400)}`;
      if (tldr) text += `\nTL;DR: ${tldr}`;
      if (ctxs && ctxs.length > 0) {
        text += `\nCitations:\n${ctxs.slice(0, 3).map(c => `- "${c.slice(0, 150)}"`).join("\n")}`;
      }
      return text;
    })
    .join("\n\n---\n\n");

  return `${queryLine}\n\nScore each paper's relevance to the ABOVE query:\n\n${papersText}`;
}

function parseScore(s: Record<string, unknown>): RelevanceScore {
  return {
    paperId: String(s.index ?? ""),
    score: Math.min(10, Math.max(0, (s.score as number) ?? 5)),
    reason: (s.reason as string) || "",
    keyMatch: (s.keyMatch as string[]) ?? [],
    contribution: (s.contribution as string) || "",
    methodology: (s.methodology as string) || "",
    innovation: (s.innovation as string) || "",
    dataSource: (s.dataSource as string) || "",
  };
}

/**
 * Score relevance with citation context enrichment.
 * For papers without full text, fetches S2 citation contexts to supplement abstracts.
 * Uses batch mode for 20+ papers.
 */
export async function scoreRelevance(
  papers: UnifiedPaper[],
  userQuery: string,
  translatedQuery: string | undefined,
  provider: AIProvider = SCORING_DEFAULT_PROVIDER,
  onProgress?: (scored: number, total: number) => void,
  onPaperScored?: (index: number, score: RelevanceScore) => void,
  signal?: AbortSignal,
  /** Key terms from the search plan — gives the scorer the topic's full facet breadth */
  keyTerms?: string[]
): Promise<ScoredPaper[]> {
  if (papers.length === 0) return [];

  // Always use deepseek-fast for scoring — fastest structured extraction model
  const scoringProvider: AIProvider = "deepseek-fast";

  // Enrich papers with S2 citation contexts (parallel, non-blocking)
  // This gives us insight into what other papers say about each paper
  try {
    const { getExtendedPaperInfo } = await import("@/lib/sources/semantic-scholar");
    const needContext = papers.filter(p =>
      (p.doi || p.externalId) && !(p as any).fullText
    ).slice(0, 20); // Top 20 papers (reduced from 40 to avoid S2 429 rate limits)

    if (needContext.length > 0) {
      console.log(`[relevance-scorer] Fetching citation contexts for ${needContext.length} papers...`);
      const contextPromises = needContext.map(async (paper) => {
        const id = paper.externalId || paper.doi!;
        const info = await getExtendedPaperInfo(id).catch(() => null);
        if (info) {
          const p = paper as any;
          if (info.contexts.length > 0) {
            p._citationContexts = info.contexts;
          }
          if (info.tldr && (!paper.abstract || info.tldr.length > paper.abstract.length * 0.5)) {
            p._tldr = info.tldr;
          }
        }
      });
      // 10s timeout — citation contexts are nice-to-have, not critical
      await Promise.race([
        Promise.all(contextPromises),
        new Promise((resolve) => setTimeout(resolve, 10000)),
      ]);
    }
  } catch (err) {
    console.error("[relevance-scorer] Citation context fetch failed:", err);
  }

  const useBatchMode = papers.length >= BATCH_SCORING_THRESHOLD;
  const batchSize = 10; // only used if batch mode is enabled (currently disabled)

  console.log(
    `[relevance-scorer] Scoring ${papers.length} papers (${scoringProvider}, ` +
    `${useBatchMode ? `batch mode: ${batchSize}/call` : "single mode"}, ` +
    `${SCORING_CONCURRENCY} concurrent)`
  );

  const allScores = new Map<number, RelevanceScore>();

  if (useBatchMode) {
    const batches: { papers: UnifiedPaper[]; offset: number }[] = [];
    for (let i = 0; i < papers.length; i += batchSize) {
      batches.push({ papers: papers.slice(i, i + batchSize), offset: i });
    }

    await concurrentPool(
      batches,
      async (batch) => {
        const response = await callAI({
          provider: scoringProvider,
          system: BATCH_SYSTEM,
          messages: [
            {
              role: "user",
              content: buildBatchPrompt(batch.papers, batch.offset, userQuery, translatedQuery),
            },
          ],
          jsonMode: true,
          noThinking: true,
          temperature: 0,
          maxTokens: batch.papers.length * 150,
          signal,
        });

        const cleaned = response.content
          .replace(/```json\s*/g, "")
          .replace(/```\s*/g, "")
          .trim();
        const parsed = JSON.parse(cleaned);
        const scores = Array.isArray(parsed) ? parsed : [parsed];

        for (const s of scores) {
          const idx = typeof s.index === "number" ? s.index : batch.offset;
          allScores.set(idx, parseScore(s));
        }
      },
      SCORING_CONCURRENCY,
      (completed, total) => {
        const scored = Math.min(completed * batchSize, papers.length);
        onProgress?.(scored, papers.length);
        if (completed % 5 === 0 || completed === total) {
          console.log(`[relevance-scorer] Batch progress: ${completed}/${total} batches`);
        }
      },
      signal
    );
  } else {
    // Single mode: 1 paper per AI call — better quality for smaller sets
    // Includes 1 retry on failure to ensure complete analysis
    await concurrentPool(
      papers,
      async (paper, idx) => {
        const MAX_ATTEMPTS = 4;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          try {
            const response = await callAI({
              provider: scoringProvider,
              system: SINGLE_SYSTEM,
              messages: [
                {
                  role: "user",
                  content: buildSinglePrompt(paper, userQuery, translatedQuery, keyTerms),
                },
              ],
              jsonMode: true,
              noThinking: true,
              temperature: 0,
              // 700 — Chinese JSON (reason/contribution/methodology/innovation) can
              // exceed 500 tokens and truncate, causing parse failures + retries
              maxTokens: 700,
              signal,
            });

            const cleaned = response.content
              .replace(/```json\s*/g, "")
              .replace(/```\s*/g, "")
              .trim();
            const parsed = JSON.parse(cleaned);
            const s = Array.isArray(parsed) ? parsed[0] : parsed;
            const score = parseScore(s);
            allScores.set(idx, score);
            onPaperScored?.(idx, score);
            return; // success
          } catch (err) {
            // Caller aborted (client disconnect / stop button) — stop retrying immediately
            if (signal?.aborted) throw err;
            if (attempt < MAX_ATTEMPTS - 1) {
              // Exponential backoff: 1s, 2s, 4s
              const delay = 1000 * Math.pow(2, attempt);
              await new Promise(r => setTimeout(r, delay));
            } else {
              console.warn(`[relevance-scorer] Failed after ${MAX_ATTEMPTS} attempts for paper ${idx}: ${(err as Error).message?.slice(0, 80)}`);
            }
          }
        }
      },
      SCORING_CONCURRENCY,
      (completed, total) => {
        onProgress?.(completed, total);
        if (completed % 10 === 0 || completed === total) {
          console.log(`[relevance-scorer] Progress: ${completed}/${total}`);
        }
      },
      signal
    );
  }

  // Merge scores back into papers
  // Papers that failed scoring get undefined relevanceScore (not a fake default 5)
  return papers.map((paper, i) => {
    const score = allScores.get(i);
    return {
      ...paper,
      relevanceScore: score?.score,
      relevanceReason: score?.reason || "",
      relevanceContribution: score?.contribution || "",
      relevanceMethodology: score?.methodology || "",
      relevanceInnovation: score?.innovation || "",
      relevanceDataSource: score ? "摘要" : "",
      relevanceKeyMatch: score?.keyMatch ?? [],
      hasFullText: false,
    } as ScoredPaper;
  });
}

/**
 * Filter and sort papers by relevance score.
 */
export function filterByRelevance(
  papers: ScoredPaper[],
  minScore: number = 4
): ScoredPaper[] {
  return papers
    .filter((p) => (p.relevanceScore ?? 0) >= minScore)
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
}
