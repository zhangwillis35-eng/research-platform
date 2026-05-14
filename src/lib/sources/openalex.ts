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

// Known journal → OpenAlex source ID mapping
// Covers: Nature/Science family, FT50, UTD24, and other top journals
const JOURNAL_SOURCE_IDS: Record<string, string> = {
  // ── Nature / Science family ──
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
  // ── Accounting ──
  "the accounting review": "S160506855",
  "accounting review": "S160506855",
  "accounting organizations and society": "S198892436",
  "accounting, organizations and society": "S198892436",
  "contemporary accounting research": "S65924262",
  "journal of accounting and economics": "S62142384",
  "journal of accounting research": "S111116695",
  "review of accounting studies": "S11853582",
  // ── Economics ──
  "american economic review": "S23254222",
  "econometrica": "S95464858",
  "journal of political economy": "S95323914",
  "quarterly journal of economics": "S203860005",
  "the quarterly journal of economics": "S203860005",
  "review of economic studies": "S88935262",
  "the review of economic studies": "S88935262",
  // ── Entrepreneurship ──
  "entrepreneurship theory and practice": "S187626162",
  "journal of business venturing": "S66201313",
  // ── Finance ──
  "journal of finance": "S5353659",
  "the journal of finance": "S5353659",
  "journal of financial economics": "S149240962",
  "journal of financial and quantitative analysis": "S193228710",
  "review of financial studies": "S170137484",
  // ── Information Systems ──
  "information systems research": "S202812398",
  "journal of management information systems": "S9954729",
  "mis quarterly": "S57293258",
  // ── International Business ──
  "journal of international business studies": "S38024979",
  "journal of world business": "S143995394",
  // ── Management ──
  "academy of management annals": "S27614628",
  "academy of management journal": "S117778295",
  "academy of management review": "S24092667",
  "administrative science quarterly": "S143668711",
  "journal of management": "S91740795",
  "journal of management studies": "S56749031",
  "strategic management journal": "S102949365",
  // ── Marketing ──
  "journal of consumer psychology": "S163545350",
  "journal of consumer research": "S15424610",
  "journal of marketing": "S142990027",
  "journal of marketing research": "S6029591",
  "journal of the academy of marketing science": "S2735964968",
  "marketing science": "S154084757",
  // ── Operations ──
  "journal of operations management": "S142306484",
  "management science": "S33323087",
  "manufacturing & service operations management": "S81410195",
  "manufacturing and service operations management": "S81410195",
  "operations research": "S125775545",
  "production and operations management": "S149070780",
  // ── OB / HR ──
  "human resource management": "S134094273",
  "journal of applied psychology": "S182017137",
  "organizational behavior and human decision processes": "S64744539",
  "organization science": "S206124708",
  // ── Innovation / Strategy ──
  "research policy": "S68862796",
  "strategic entrepreneurship journal": "S31690342",
  // ── Psychology / Sociology ──
  "psychological science": "S58854535",
  "american sociological review": "S157620343",
  // ── General ──
  "harvard business review": "S86510944",
  "mit sloan management review": "S196034224",
  // ── INFORMS ──
  "informs journal on computing": "S165318533",
  // ── Other commonly searched ──
  "journal of business ethics": "S150700104",
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
