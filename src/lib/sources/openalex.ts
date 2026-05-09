import type { UnifiedPaper, SearchOptions, SearchResult } from "./types";

const BASE_URL = "https://api.openalex.org";

export async function searchOpenAlex(
  options: SearchOptions
): Promise<SearchResult> {
  const { query, limit = 20, yearFrom, yearTo } = options;

  const filters: string[] = ["type:article"];
  if (yearFrom != null) filters.push(`from_publication_date:${yearFrom}-01-01`);
  if (yearTo != null) filters.push(`to_publication_date:${yearTo}-12-31`);

  const params = new URLSearchParams({
    search: query,
    per_page: String(Math.min(limit, 200)), // OpenAlex supports up to 200
    filter: filters.join(","),
    sort: "relevance_score:desc", // Relevance first — cited_by_count:desc returns unrelated high-cited papers
    select:
      "id,doi,title,display_name,publication_year,cited_by_count,referenced_works_count,authorships,primary_location,abstract_inverted_index,open_access,topics",
  });

  // polite pool: add email for better rate limits
  const email = (await import("@/lib/env")).getEnv("OPENALEX_EMAIL");
  if (email) {
    params.set("mailto", email);
  }

  const res = await fetch(`${BASE_URL}/works?${params}`);

  if (!res.ok) {
    throw new Error(`OpenAlex API error: ${res.status}`);
  }

  const data = await res.json();

  const papers: UnifiedPaper[] = (data.results ?? []).map(mapOpenAlexWork);

  return {
    papers,
    total: (data.meta?.count as number) ?? papers.length,
    source: "openalex",
  };
}

/**
 * Search OpenAlex specifically for high-impact venues (Nature, Science, etc.)
 * This supplements the main search to ensure top-tier journals aren't missed.
 */
export async function searchOpenAlexTopVenues(
  query: string,
  options?: { yearFrom?: number; yearTo?: number; limit?: number }
): Promise<UnifiedPaper[]> {
  const { yearFrom, yearTo, limit = 10 } = options ?? {};

  // OpenAlex source IDs for top multidisciplinary journals
  // Nature, Science, PNAS, Nature Human Behaviour, Nature Communications,
  // Science Advances, Management Science, Strategic Management Journal
  const topSourceIds = [
    "S137773608", // Nature
    "S3880285",   // Science
    "S125754415", // PNAS
    "S2764899367", // Nature Human Behaviour
    "S4210174836", // Nature Communications
    "S4306402567", // Science Advances
    "S161191863",  // Management Science
    "S125375875",  // Strategic Management Journal
    "S25712954",   // Academy of Management Review
    "S15055356",   // Academy of Management Journal
    "S134382235",  // Journal of Financial Economics
    "S144561400",  // Review of Financial Studies
    "S17744743",   // Journal of Political Economy
    "S201607505",  // Quarterly Journal of Economics
  ];

  const filters: string[] = [
    "type:article",
    `primary_location.source.id:${topSourceIds.join("|")}`,
  ];
  if (yearFrom != null) filters.push(`from_publication_date:${yearFrom}-01-01`);
  if (yearTo != null) filters.push(`to_publication_date:${yearTo}-12-31`);

  const params = new URLSearchParams({
    search: query,
    per_page: String(limit),
    filter: filters.join(","),
    sort: "relevance_score:desc",
    select:
      "id,doi,title,display_name,publication_year,cited_by_count,referenced_works_count,authorships,primary_location,abstract_inverted_index,open_access,topics",
  });

  const email = (await import("@/lib/env")).getEnv("OPENALEX_EMAIL");
  if (email) params.set("mailto", email);

  try {
    const res = await fetch(`${BASE_URL}/works?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).map(mapOpenAlexWork);
  } catch {
    return [];
  }
}

function mapOpenAlexWork(w: Record<string, unknown>): UnifiedPaper {
  return {
    title: (w.display_name ?? w.title) as string,
    abstract: invertedIndexToText(
      w.abstract_inverted_index as Record<string, number[]> | null
    ),
    authors: (
      (w.authorships as Array<{
        author: { display_name: string; id: string };
      }>) ?? []
    ).map((a) => ({
      name: a.author.display_name,
      authorId: a.author.id,
    })),
    year: w.publication_year as number | undefined,
    venue: (
      w.primary_location as {
        source?: { display_name?: string };
      } | null
    )?.source?.display_name,
    citationCount: (w.cited_by_count as number) ?? 0,
    referenceCount: (w.referenced_works_count as number) ?? 0,
    doi: w.doi
      ? (w.doi as string).replace("https://doi.org/", "")
      : undefined,
    externalId: w.id as string,
    source: "openalex" as const,
    pdfUrl: (w.open_access as { oa_url?: string })?.oa_url,
    openAccessPdf: (w.open_access as { oa_url?: string })?.oa_url,
    fieldsOfStudy: (
      (w.topics as Array<{ display_name: string }>) ?? []
    )
      .slice(0, 5)
      .map((t) => t.display_name),
    rawMetadata: w,
  };
}

// Known journal → OpenAlex source ID mapping (from weekly-digest)
const JOURNAL_SOURCE_IDS: Record<string, string> = {
  "nature": "S137773608",
  "science": "S3880285",
  "nature machine intelligence": "S2912241403",
  "nature computational science": "S4210228084",
  "nature human behaviour": "S2764866340",
  "nature communications": "S64187185",
  "nature electronics": "S4210239724",
  "science advances": "S2737427234",
  "science robotics": "S4210213233",
  "pnas": "S125754415",
  "proceedings of the national academy of sciences": "S125754415",
  "management science": "S33323087",
  "mis quarterly": "S57293258",
  "information systems research": "S202812398",
  "academy of management journal": "S117778295",
  "academy of management review": "S24092667",
  "organization science": "S206124708",
  "strategic management journal": "S102949365",
  "journal of marketing": "S142990027",
  "journal of consumer research": "S15424610",
  "marketing science": "S154084757",
  "journal of marketing research": "S6029591",
  "journal of management": "S91740795",
  "journal of applied psychology": "S182017137",
  "journal of business ethics": "S150700104",
  "research policy": "S68862796",
  "journal of management studies": "S56749031",
  "journal of the academy of marketing science": "S2735964968",
  "harvard business review": "S86510944",
};

/**
 * Search OpenAlex for papers in SPECIFIC journals.
 * Uses source ID filter (display_name.search doesn't work reliably).
 */
export async function searchOpenAlexByJournals(
  query: string,
  journalNames: string[],
  options: { yearFrom?: number; yearTo?: number; limit?: number } = {}
): Promise<UnifiedPaper[]> {
  const { yearFrom, yearTo, limit = 50 } = options;

  // Resolve journal names to source IDs
  const sourceIds: string[] = [];
  const unknownJournals: string[] = [];
  for (const name of journalNames) {
    const id = JOURNAL_SOURCE_IDS[name.toLowerCase()];
    if (id) {
      sourceIds.push(id);
    } else {
      unknownJournals.push(name);
    }
  }

  // For unknown journals, look up source IDs via OpenAlex API
  if (unknownJournals.length > 0) {
    await Promise.all(
      unknownJournals.map(async (name) => {
        try {
          const res = await fetch(
            `${BASE_URL}/sources?search=${encodeURIComponent(name)}&per_page=1&select=id`,
            { signal: AbortSignal.timeout(5000) }
          );
          if (!res.ok) return;
          const data = await res.json();
          const id = data.results?.[0]?.id?.replace("https://openalex.org/", "");
          if (id) sourceIds.push(id);
        } catch { /* skip */ }
      })
    );
  }

  if (sourceIds.length === 0) return [];

  // Search with source ID filter (pipe = OR)
  const allPapers: UnifiedPaper[] = [];
  const BATCH = 10; // OpenAlex supports up to ~50 source IDs per pipe
  for (let i = 0; i < sourceIds.length; i += BATCH) {
    const batch = sourceIds.slice(i, i + BATCH);
    try {
      const filters = [
        "type:article",
        `primary_location.source.id:${batch.join("|")}`,
      ];
      if (yearFrom) filters.push(`from_publication_date:${yearFrom}-01-01`);
      if (yearTo) filters.push(`to_publication_date:${yearTo}-12-31`);

      const params = new URLSearchParams({
        search: query,
        per_page: String(Math.min(limit, 50)),
        filter: filters.join(","),
        sort: "relevance_score:desc",
        select: "id,doi,title,display_name,publication_year,cited_by_count,referenced_works_count,authorships,primary_location,abstract_inverted_index,open_access,topics",
      });

      const email = (await import("@/lib/env")).getEnv("OPENALEX_EMAIL");
      if (email) params.set("mailto", email);

      const res = await fetch(`${BASE_URL}/works?${params}`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;

      const data = await res.json();
      for (const w of data.results ?? []) {
        allPapers.push(mapOpenAlexWork(w));
      }
    } catch { /* skip */ }
  }

  return allPapers;
}

function invertedIndexToText(
  index: Record<string, number[]> | null | undefined
): string | undefined {
  if (!index) return undefined;
  const words: [number, string][] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) {
      words.push([pos, word]);
    }
  }
  words.sort((a, b) => a[0] - b[0]);
  return words.map((w) => w[1]).join(" ");
}
