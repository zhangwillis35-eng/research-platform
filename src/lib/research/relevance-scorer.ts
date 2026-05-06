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

const SCORING_CONCURRENCY = 80;
const BATCH_SCORING_THRESHOLD = 20; // Use batch mode above this count (more aggressive batching)

/** Aggressive batch size — minimize API calls, maximize parallelism */
function getBatchSize(paperCount: number): number {
  if (paperCount >= 80) return 40;  // 80+: 40/call → 2-3 calls total
  if (paperCount >= 40) return 25;  // 40-79: 25/call → 2-3 calls
  return 15;                         // <40: 15/call → 2-3 calls
}
const SCORING_DEFAULT_PROVIDER: AIProvider = "deepseek-fast";

const SINGLE_SYSTEM = `You are a management research literature expert. Evaluate the paper's relevance to the user's query.

You are given the paper's title, abstract, and possibly CITATION CONTEXTS (sentences from OTHER papers that cite this paper — these reveal the paper's key contributions and findings even without the full text).

Scoring (0-10): 9-10 exact match, 7-8 highly relevant, 5-6 moderately relevant, 3-4 marginally relevant, 0-2 irrelevant.
Rules: Base analysis strictly on actual content provided. Use citation contexts to understand the paper's impact and findings. Never fabricate.

Output a JSON object. Use Chinese for all text fields:
{"score":8,"reason":"(1-2 sentences in Chinese)","keyMatch":["matched concepts"],"contribution":"(1-2 sentences in Chinese)","methodology":"(1 sentence in Chinese)","innovation":"(1 sentence in Chinese)","dataSource":"摘要+引用上下文"}`;

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

const BATCH_SYSTEM = `You are a management research literature expert. Evaluate multiple papers' relevance to the user's query.

Each paper includes title, abstract, and possibly CITATION CONTEXTS (sentences from other papers citing this paper — these reveal contributions and findings even without full text).

Scoring (0-10): 9-10 exact match, 7-8 highly relevant, 5-6 moderately relevant, 3-4 marginally relevant, 0-2 irrelevant.
Rules: Base analysis on ALL provided content (abstract + citation contexts). Never fabricate.

Output a JSON array, one element per paper. Use Chinese for all text fields:
[{"index":0,"score":8,"reason":"(1-2 sentences in Chinese)","keyMatch":["concepts"],"contribution":"(1-2 sentences in Chinese)","methodology":"(1 sentence in Chinese)","innovation":"(1 sentence in Chinese)","dataSource":"摘要+引用上下文"}]`;

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
  const queryDesc = translatedQuery
    ? `查询: "${userQuery}" (${translatedQuery})`
    : `查询: "${userQuery}"`;

  const papersText = papers
    .map((p, i) => {
      const idx = offset + i;
      const ext = p as any;
      const ctxs = ext._citationContexts as string[] | undefined;
      const tldr = ext._tldr as string | undefined;
      let text = `[${idx}] Title: ${p.title}\nVenue: ${p.venue ?? "Unknown"}\nAbstract: ${p.abstract ?? "N/A"}`;
      if (tldr) text += `\nTL;DR: ${tldr}`;
      if (ctxs && ctxs.length > 0) {
        text += `\nCitation Contexts (what other papers say about this paper):\n${ctxs.slice(0, 5).map(c => `- "${c}"`).join("\n")}`;
      }
      return text;
    })
    .join("\n\n---\n\n");

  return `${queryDesc}\n\nEvaluate the following ${papers.length} papers:\n\n${papersText}`;
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
  provider: AIProvider = SCORING_DEFAULT_PROVIDER
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
  const batchSize = getBatchSize(papers.length);

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
          temperature: 0.1,
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
        if (completed % 5 === 0 || completed === total) {
          console.log(`[relevance-scorer] Batch progress: ${completed}/${total} batches`);
        }
      }
    );
  } else {
    // Single mode: 1 paper per AI call — better quality for smaller sets
    await concurrentPool(
      papers,
      async (paper, idx) => {
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
          temperature: 0.1,
          maxTokens: 400,
        });

        const cleaned = response.content
          .replace(/```json\s*/g, "")
          .replace(/```\s*/g, "")
          .trim();
        const parsed = JSON.parse(cleaned);
        const s = Array.isArray(parsed) ? parsed[0] : parsed;
        allScores.set(idx, parseScore(s));
      },
      SCORING_CONCURRENCY,
      (completed, total) => {
        if (completed % 10 === 0 || completed === total) {
          console.log(`[relevance-scorer] Progress: ${completed}/${total}`);
        }
      }
    );
  }

  // Merge scores back into papers
  return papers.map((paper, i) => {
    const score = allScores.get(i);
    return {
      ...paper,
      relevanceScore: score?.score ?? 5,
      relevanceReason: score?.reason || `该论文与"${userQuery}"相关`,
      relevanceContribution: score?.contribution || "",
      relevanceMethodology: score?.methodology || "",
      relevanceInnovation: score?.innovation || "",
      relevanceDataSource: "摘要",
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
        temperature: 0.1,
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
  return papers.map((paper, i) => {
    const score = allScores.get(i);
    const p = paper as UnifiedPaper & { fullText?: string; hasFullText?: boolean; fullTextSource?: string; fullTextWordCount?: number };
    return {
      ...paper,
      relevanceScore: score?.score ?? 5,
      relevanceReason: score?.reason || `该论文与"${userQuery}"相关`,
      relevanceContribution: score?.contribution || "",
      relevanceMethodology: score?.methodology || "",
      relevanceInnovation: score?.innovation || "",
      relevanceDataSource: score?.dataSource || (p.hasFullText ? "全文" : "摘要"),
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
