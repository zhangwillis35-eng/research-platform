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

const SCORING_CONCURRENCY = 5; // 5 concurrent to avoid DeepSeek rate limiting
// Single mode: 1 paper per LLM call — best score differentiation
const BATCH_SCORING_THRESHOLD = 999; // disabled — always single mode
const SCORING_DEFAULT_PROVIDER: AIProvider = "deepseek-fast";

const SINGLE_SYSTEM = `You are a strict academic paper relevance scorer. Evaluate ONE paper against the user's query.

SCORING RULES (follow EXACTLY):
- 9-10: Paper is a COMPREHENSIVE review/survey of the EXACT query topic, OR a landmark foundational paper defining the field
- 7-8: Paper directly studies the query topic as its PRIMARY focus
- 5-6: Paper is related but the query topic is only a SECONDARY aspect
- 3-4: Paper shares some keywords but studies a DIFFERENT topic
- 0-2: Paper is about a completely unrelated field

CRITICAL: Most papers should get 7-8 if they're on-topic. Reserve 9-10 ONLY for comprehensive reviews/surveys and highly-cited foundational works. Score 5-6 means the paper is NOT primarily about the query topic.

Output JSON (Chinese text):
{"score":8,"reason":"具体说明为什么给这个分数（2-3句话，引用论文标题中的关键词）","keyMatch":["匹配的概念"],"contribution":"该论文的核心贡献（1-2句）","methodology":"研究方法（1句）","innovation":"创新点（1句）","dataSource":"摘要"}`;

const FULLTEXT_SYSTEM = `You are a management research literature expert. Evaluate the paper's relevance to the user's query based on its FULL TEXT content.

You have access to the paper's full text. Perform a deep analysis covering:
1. Research question and hypotheses
2. Theoretical framework and literature positioning
3. Methodology (data, sample, analytical techniques)
4. Key findings and contributions
5. Limitations and future research directions

Scoring (0-10): 9-10 exact match to query, 7-8 highly relevant, 5-6 moderately relevant, 3-4 marginally relevant, 0-2 irrelevant.
Rules: Base analysis strictly on ACTUAL CONTENT from the full text. Never fabricate. Provide detailed analysis since you have the full paper.

Output a JSON object. Use Chinese for all text fields:
{"score":8,"reason":"(2-3 sentences in Chinese, detailed)","keyMatch":["matched concepts"],"contribution":"(2-3 sentences in Chinese, specific findings)","methodology":"(2-3 sentences in Chinese, specific methods/data)","innovation":"(1-2 sentences in Chinese)","dataSource":"全文"}`;

const FULLTEXT_BATCH_SYSTEM = `You are a management research literature expert. Evaluate multiple papers' relevance to the user's query. Some papers include full text, others only have abstracts.

For papers WITH full text: perform deep analysis of research questions, methodology, findings, and contributions.
For papers with ABSTRACT only: evaluate based on available information.

Scoring (0-10): 9-10 exact match, 7-8 highly relevant, 5-6 moderately relevant, 3-4 marginally relevant, 0-2 irrelevant.
Rules: Base analysis strictly on actual content provided. Never fabricate. For full-text papers, provide more detailed analysis.

Output a JSON array, one element per paper. Use Chinese for all text fields:
[{"index":0,"score":8,"reason":"(detailed in Chinese)","keyMatch":["concepts"],"contribution":"(specific in Chinese)","methodology":"(specific in Chinese)","innovation":"(Chinese)","dataSource":"全文 or 摘要"}]`;

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
  translatedQuery: string | undefined
): string {
  const queryDesc = translatedQuery
    ? `Query: "${userQuery}" (${translatedQuery})`
    : `Query: "${userQuery}"`;

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

function buildFullTextPrompt(
  paper: UnifiedPaper & { fullText?: string; hasFullText?: boolean },
  userQuery: string,
  translatedQuery: string | undefined
): string {
  const queryDesc = translatedQuery
    ? `Query: "${userQuery}" (${translatedQuery})`
    : `Query: "${userQuery}"`;

  const fullText = paper.fullText;
  if (fullText && fullText.length > 500) {
    // Include full text (truncated to 8000 chars for token budget)
    const truncatedText = fullText.slice(0, 8000);
    return `${queryDesc}\n\nTitle: ${paper.title}\nVenue: ${paper.venue ?? "Unknown"}\nYear: ${paper.year ?? "N/A"}\n\nFull Text:\n${truncatedText}`;
  }

  // Fallback to abstract
  return `${queryDesc}\n\nTitle: ${paper.title}\nVenue: ${paper.venue ?? "Unknown"}\nAbstract: ${paper.abstract ?? "N/A"}`;
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

function buildFullTextBatchPrompt(
  papers: Array<UnifiedPaper & { fullText?: string; hasFullText?: boolean }>,
  offset: number,
  userQuery: string,
  translatedQuery: string | undefined
): string {
  const queryDesc = translatedQuery
    ? `查询: "${userQuery}" (${translatedQuery})`
    : `查询: "${userQuery}"`;

  const papersText = papers
    .map((p, i) => {
      const idx = offset + i;
      const hasFullText = p.fullText && p.fullText.length > 500;
      if (hasFullText) {
        // Include truncated full text (5000 chars per paper in batch to stay within token limits)
        const truncatedText = p.fullText!.slice(0, 5000);
        return `[${idx}] Title: ${p.title}\nVenue: ${p.venue ?? "Unknown"}\nYear: ${p.year ?? "N/A"}\n[数据来源: 全文]\n${truncatedText}`;
      }
      return `[${idx}] Title: ${p.title}\nVenue: ${p.venue ?? "Unknown"}\n[数据来源: 摘要]\nAbstract: ${p.abstract ?? "N/A"}`;
    })
    .join("\n\n---\n\n");

  return `${queryDesc}\n\nEvaluate the following ${papers.length} papers (some include full text, others only abstracts):\n\n${papersText}`;
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
  onPaperScored?: (index: number, score: RelevanceScore) => void
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
      }
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
                  content: buildSinglePrompt(paper, userQuery, translatedQuery),
                },
              ],
              jsonMode: true,
              noThinking: true,
              temperature: 0,
              maxTokens: 500,
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
      }
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
 * Score relevance WITH full text — used for quality tiers (20/50 papers).
 * Papers with fullText get deep analysis; papers without get abstract-based scoring.
 * Uses smaller batches (4 per call) to accommodate full text token usage.
 */
export async function scoreRelevanceWithFullText(
  papers: UnifiedPaper[],
  userQuery: string,
  translatedQuery: string | undefined,
  provider: AIProvider = SCORING_DEFAULT_PROVIDER
): Promise<ScoredPaper[]> {
  if (papers.length === 0) return [];

  const scoringProvider: AIProvider =
    provider === "deepseek" || provider === "deepseek-pro" ? "deepseek-fast" : provider;

  const papersWithFT = papers as Array<UnifiedPaper & { fullText?: string; hasFullText?: boolean }>;
  const ftCount = papersWithFT.filter(p => p.fullText && p.fullText.length > 500).length;
  console.log(
    `[relevance-scorer] Full-text scoring: ${papers.length} papers (${ftCount} with full text, ${scoringProvider})`
  );

  const allScores = new Map<number, RelevanceScore>();

  // For full-text mode: smaller batches (4 papers), since full text uses more tokens
  const batchSize = 4;
  const batches: { papers: typeof papersWithFT; offset: number }[] = [];
  for (let i = 0; i < papers.length; i += batchSize) {
    batches.push({ papers: papersWithFT.slice(i, i + batchSize), offset: i });
  }

  await concurrentPool(
    batches,
    async (batch) => {
      const hasFT = batch.papers.some(p => p.fullText && p.fullText.length > 500);
      const systemPrompt = hasFT ? FULLTEXT_BATCH_SYSTEM : BATCH_SYSTEM;
      const prompt = hasFT
        ? buildFullTextBatchPrompt(batch.papers, batch.offset, userQuery, translatedQuery)
        : buildBatchPrompt(batch.papers, batch.offset, userQuery, translatedQuery);

      const response = await callAI({
        provider: scoringProvider,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
        jsonMode: true,
        noThinking: true,
        temperature: 0,
        maxTokens: batch.papers.length * 300, // More tokens for detailed full-text analysis
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
      if (completed % 3 === 0 || completed === total) {
        console.log(`[relevance-scorer] Full-text batch progress: ${completed}/${total}`);
      }
    }
  );

  // Merge scores back into papers
  // Papers that failed scoring get undefined relevanceScore (not a fake default 5)
  return papers.map((paper, i) => {
    const score = allScores.get(i);
    const p = paper as UnifiedPaper & { fullText?: string; hasFullText?: boolean; fullTextSource?: string; fullTextWordCount?: number };
    return {
      ...paper,
      relevanceScore: score?.score,
      relevanceReason: score?.reason || "",
      relevanceContribution: score?.contribution || "",
      relevanceMethodology: score?.methodology || "",
      relevanceInnovation: score?.innovation || "",
      relevanceDataSource: score?.dataSource || "",
      relevanceKeyMatch: score?.keyMatch ?? [],
      hasFullText: !!p.hasFullText,
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
