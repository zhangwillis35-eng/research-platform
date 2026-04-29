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

const SCORING_CONCURRENCY = 50; // Increased for faster feedback
const BATCH_SCORING_THRESHOLD = 30; // Use batch mode above this count (more aggressive batching)
const BATCH_SIZE = 10; // Papers per AI call in batch mode
const SCORING_DEFAULT_PROVIDER: AIProvider = "deepseek-fast";

const SINGLE_SYSTEM = `You are a management research literature expert. Evaluate the paper's relevance to the user's query based on its title and abstract.

Scoring (0-10): 9-10 exact match, 7-8 highly relevant, 5-6 moderately relevant, 3-4 marginally relevant, 0-2 irrelevant.
Rules: Base analysis strictly on actual content provided (title + abstract). Never fabricate.

Output a JSON object. Use Chinese for all text fields:
{"score":8,"reason":"(1 sentence in Chinese)","keyMatch":["matched concepts"],"contribution":"(1 sentence in Chinese)","methodology":"(1 sentence in Chinese)","innovation":"(1 sentence in Chinese)","dataSource":"摘要"}`;

const BATCH_SYSTEM = `You are a management research literature expert. Evaluate multiple papers' relevance to the user's query based on their titles and abstracts.

Scoring (0-10): 9-10 exact match, 7-8 highly relevant, 5-6 moderately relevant, 3-4 marginally relevant, 0-2 irrelevant.
Rules: Base analysis strictly on actual content provided (title + abstract). Never fabricate.

Output a JSON array, one element per paper. Use Chinese for all text fields:
[{"index":0,"score":8,"reason":"(1 sentence in Chinese)","keyMatch":["concepts"],"contribution":"(1 sentence in Chinese)","methodology":"(1 sentence in Chinese)","innovation":"(1 sentence in Chinese)","dataSource":"摘要"}]`;

function buildSinglePrompt(
  paper: UnifiedPaper,
  userQuery: string,
  translatedQuery: string | undefined
): string {
  const queryDesc = translatedQuery
    ? `Query: "${userQuery}" (${translatedQuery})`
    : `Query: "${userQuery}"`;

  // Always include abstract — papers without abstracts should have been enriched upstream
  const paperText = `Title: ${paper.title}\nVenue: ${paper.venue ?? "Unknown"}\nAbstract: ${paper.abstract ?? "N/A"}`;

  return `${queryDesc}\n\n${paperText}`;
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
      return `[${idx}] Title: ${p.title}\nVenue: ${p.venue ?? "Unknown"}\nAbstract: ${p.abstract ?? "N/A"}`;
    })
    .join("\n\n---\n\n");

  return `${queryDesc}\n\nEvaluate the following ${papers.length} papers:\n\n${papersText}`;
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
 * Score relevance — abstract-only, no full-text fetching.
 * Uses batch mode for 50+ papers (8 per AI call) for speed at scale.
 */
export async function scoreRelevance(
  papers: UnifiedPaper[],
  userQuery: string,
  translatedQuery: string | undefined,
  provider: AIProvider = SCORING_DEFAULT_PROVIDER
): Promise<ScoredPaper[]> {
  if (papers.length === 0) return [];

  // Auto-downgrade to deepseek-fast for scoring
  const scoringProvider: AIProvider =
    provider === "deepseek" || provider === "deepseek-pro" ? "deepseek-fast" : provider;

  const useBatchMode = papers.length >= BATCH_SCORING_THRESHOLD;

  console.log(
    `[relevance-scorer] Scoring ${papers.length} papers (${scoringProvider}, ` +
    `${useBatchMode ? `batch mode: ${BATCH_SIZE}/call` : "single mode"}, ` +
    `${SCORING_CONCURRENCY} concurrent)`
  );

  const allScores = new Map<number, RelevanceScore>();

  if (useBatchMode) {
    // Batch mode: 8 papers per AI call — reduces 200 API calls to 25
    const batches: { papers: UnifiedPaper[]; offset: number }[] = [];
    for (let i = 0; i < papers.length; i += BATCH_SIZE) {
      batches.push({ papers: papers.slice(i, i + BATCH_SIZE), offset: i });
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
