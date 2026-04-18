import type { UnifiedPaper, SearchOptions, SearchResult } from "./types";
import { searchSemanticScholar } from "./semantic-scholar";
import { searchOpenAlex } from "./openalex";
import { searchGoogleScholar } from "./google-scholar";

const DEFAULT_SOURCES: Array<UnifiedPaper["source"]> = [
  "semantic_scholar",
  "openalex",
  "google_scholar",
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

  return { papers: deduplicated, results };
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
      // Keep the one with more metadata
      seen.set(key, mergePapers(existing, paper));
    }
  }

  return Array.from(seen.values());
}

function getDeduplicationKey(paper: UnifiedPaper): string {
  // Prefer DOI for deduplication
  if (paper.doi) return `doi:${paper.doi.toLowerCase()}`;

  // Fallback to normalized title
  return `title:${normalizeTitle(paper.title)}`;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "") // keep alphanumeric + Chinese
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
