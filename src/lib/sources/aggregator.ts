import type { UnifiedPaper, SearchOptions, SearchResult } from "./types";
import { searchSemanticScholar } from "./semantic-scholar";
import { searchOpenAlex } from "./openalex";
import { searchGoogleScholar } from "./google-scholar";
import { getJournalRanking, getRankingBadges } from "./journal-rankings";
import { getJournalMetadata } from "./journal-metadata";
import { batchFindOpenAccess } from "./unpaywall";

// Google Scholar is PRIMARY, others supplement
const DEFAULT_SOURCES: Array<UnifiedPaper["source"]> = [
  "google_scholar",  // Primary: best coverage, most relevant
  "semantic_scholar", // Supplement: citation data, open access PDFs
  "openalex",         // Supplement: journal metrics, full metadata
];

export async function searchAllSources(
  options: SearchOptions
): Promise<{ papers: UnifiedPaper[]; results: SearchResult[] }> {
  const sources = options.sources ?? DEFAULT_SOURCES;

  const searches = sources.map((source) =>
    searchBySource(source, options).catch((err) => {
      console.error(`[${source}] search failed:`, err.message);
      return { papers: [], total: 0, source } as SearchResult;
    })
  );

  const results = await Promise.all(searches);
  const allPapers = results.flatMap((r) => r.papers);
  const deduplicated = deduplicatePapers(allPapers);

  // Enrich papers with journal rankings and tool links
  const enriched = enrichPapers(deduplicated);

  // Batch lookup Unpaywall for papers with DOIs but no PDF
  const doisNeedingPdf = enriched
    .filter((p) => p.doi && !p.openAccessPdf)
    .map((p) => p.doi!);

  if (doisNeedingPdf.length > 0) {
    const unpaywallResults = await batchFindOpenAccess(
      doisNeedingPdf.slice(0, 30) // limit to 30 for speed
    );
    for (const paper of enriched) {
      if (paper.doi && unpaywallResults.has(paper.doi)) {
        const oa = unpaywallResults.get(paper.doi)!;
        if (oa.isOpenAccess && oa.oaUrl) {
          paper.openAccessPdf = paper.openAccessPdf ?? oa.oaUrl;
          paper.unpaywallUrl = oa.oaUrl;
        }
      }
    }
  }

  return { papers: enriched, results };
}

function enrichPapers(papers: UnifiedPaper[]): UnifiedPaper[] {
  return papers.map((paper) => {
    const ranking = getJournalRanking(paper.venue);
    const badges = getRankingBadges(paper.venue);

    const journalMeta = getJournalMetadata(paper.venue);

    // Add SSCI/CAS badges
    if (journalMeta.ssci) badges.push("SSCI");
    if (journalMeta.casZone) badges.push(`中科院${journalMeta.casZone}`);
    if (journalMeta.sjrQuartile) badges.push(journalMeta.sjrQuartile);

    return {
      ...paper,
      journalRanking: { ...ranking, badges },
      journalMeta,
      connectedPapersUrl: paper.doi
        ? `https://www.connectedpapers.com/api/redirect/doi/${encodeURIComponent(paper.doi)}`
        : paper.title
          ? `https://www.connectedpapers.com/search?q=${encodeURIComponent(paper.title)}`
          : undefined,
    };
  });
}

function searchBySource(
  source: UnifiedPaper["source"],
  options: SearchOptions
): Promise<SearchResult> {
  switch (source) {
    case "semantic_scholar":
      return searchSemanticScholar(options);
    case "openalex":
      return searchOpenAlex(options);
    case "google_scholar":
      return searchGoogleScholar(options);
    default:
      return Promise.resolve({ papers: [], total: 0, source });
  }
}

function deduplicatePapers(papers: UnifiedPaper[]): UnifiedPaper[] {
  const seen = new Map<string, UnifiedPaper>();

  for (const paper of papers) {
    const key = getDeduplicationKey(paper);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, paper);
    } else {
      seen.set(key, mergePapers(existing, paper));
    }
  }

  return Array.from(seen.values());
}

function getDeduplicationKey(paper: UnifiedPaper): string {
  if (paper.doi) return `doi:${paper.doi.toLowerCase()}`;
  return `title:${normalizeTitle(paper.title)}`;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "")
    .slice(0, 100);
}

function mergePapers(a: UnifiedPaper, b: UnifiedPaper): UnifiedPaper {
  return {
    ...a,
    abstract: a.abstract ?? b.abstract,
    doi: a.doi ?? b.doi,
    year: a.year ?? b.year,
    venue: a.venue ?? b.venue,
    citationCount: Math.max(a.citationCount, b.citationCount),
    referenceCount: Math.max(a.referenceCount, b.referenceCount),
    openAccessPdf: a.openAccessPdf ?? b.openAccessPdf,
    pdfUrl: a.pdfUrl ?? b.pdfUrl,
    fieldsOfStudy: a.fieldsOfStudy ?? b.fieldsOfStudy,
  };
}
