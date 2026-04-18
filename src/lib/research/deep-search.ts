/**
 * Deep research pipeline inspired by GPT-Researcher.
 * 1. Plan: decompose query into sub-questions
 * 2. Execute: parallel multi-source search for each sub-question
 * 3. Aggregate: deduplicate, rank, enrich with journal rankings
 */
import { searchAllSources } from "@/lib/sources/aggregator";
import type { UnifiedPaper } from "@/lib/sources/types";
import { planResearch, type ResearchPlan } from "./query-planner";
import type { AIProvider } from "@/lib/ai";

export interface DeepSearchResult {
  plan: ResearchPlan;
  papers: UnifiedPaper[];
  papersBySubQuestion: Record<string, UnifiedPaper[]>;
  stats: {
    totalFound: number;
    afterDedup: number;
    withOpenAccess: number;
    topJournals: number; // FT50/UTD24 count
    searchDurationMs: number;
  };
}

export async function deepSearch(
  topic: string,
  provider: AIProvider = "gemini"
): Promise<DeepSearchResult> {
  const startTime = Date.now();

  // Step 1: Plan — decompose into sub-questions
  const plan = await planResearch(topic, provider);

  // Step 2: Execute — parallel search for all queries
  const allQueries = [
    ...plan.searchQueries.precision.map((q) => `"${q}"`),
    ...plan.searchQueries.broad,
  ];

  const searchPromises = allQueries.map((query) =>
    searchAllSources({ query, limit: 15 }).catch(() => ({
      papers: [] as UnifiedPaper[],
      results: [],
    }))
  );

  const searchResults = await Promise.all(searchPromises);

  // Step 3: Aggregate — deduplicate across all searches
  const allPapers = searchResults.flatMap((r) => r.papers);
  const seen = new Map<string, UnifiedPaper>();
  for (const paper of allPapers) {
    const key = paper.doi?.toLowerCase() || paper.title?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 80);
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing || paper.citationCount > existing.citationCount) {
      seen.set(key, paper);
    }
  }

  const deduplicated = Array.from(seen.values());

  // Sort by citation count
  deduplicated.sort((a, b) => b.citationCount - a.citationCount);

  // Map papers to sub-questions (best effort via title matching)
  const papersBySubQuestion: Record<string, UnifiedPaper[]> = {};
  for (const [i, result] of searchResults.entries()) {
    const queryLabel = allQueries[i] ?? `query-${i}`;
    papersBySubQuestion[queryLabel] = result.papers.slice(0, 10);
  }

  const withOpenAccess = deduplicated.filter(
    (p) => p.openAccessPdf || p.unpaywallUrl
  ).length;
  const topJournals = deduplicated.filter(
    (p) => p.journalRanking?.ft50 || p.journalRanking?.utd24
  ).length;

  return {
    plan,
    papers: deduplicated,
    papersBySubQuestion,
    stats: {
      totalFound: allPapers.length,
      afterDedup: deduplicated.length,
      withOpenAccess,
      topJournals,
      searchDurationMs: Date.now() - startTime,
    },
  };
}
