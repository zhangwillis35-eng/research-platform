/**
 * Journal blacklist/whitelist filter — applied post-search.
 *
 * Loads the project's journal filter configuration from DB,
 * then filters papers by normalized venue name matching.
 */

import { prisma } from "@/lib/db";
import { normalizeJournalName } from "./journal-rankings";

/**
 * Apply journal blacklist/whitelist filter to a set of papers.
 * Returns filtered papers and the count of removed papers.
 */
export async function applyJournalFilter<T extends { venue?: string | null }>(
  projectId: string,
  papers: T[]
): Promise<{ papers: T[]; removedCount: number }> {
  // Load project filter mode
  const project = await prisma.researchProject.findUnique({
    where: { id: projectId },
    select: { journalFilterMode: true },
  });

  const mode = project?.journalFilterMode;
  if (!mode || (mode !== "blacklist" && mode !== "whitelist")) {
    return { papers, removedCount: 0 };
  }

  // Load filter entries
  const filters = await prisma.journalFilter.findMany({
    where: { projectId, filterType: mode },
    select: { journalName: true },
  });

  if (filters.length === 0) {
    return { papers, removedCount: 0 };
  }

  // Build normalized lookup set
  const filterSet = new Set(
    filters.map((f) => normalizeJournalName(f.journalName))
  );

  const before = papers.length;

  const filtered = papers.filter((paper) => {
    if (!paper.venue) {
      // Papers without venue: keep in blacklist mode, exclude in whitelist mode
      return mode === "blacklist";
    }

    const normalized = normalizeJournalName(paper.venue);
    if (!normalized) return mode === "blacklist";

    const inList = filterSet.has(normalized);

    if (mode === "blacklist") {
      return !inList; // Keep papers NOT in the blacklist
    } else {
      return inList; // Keep papers IN the whitelist
    }
  });

  return {
    papers: filtered,
    removedCount: before - filtered.length,
  };
}
