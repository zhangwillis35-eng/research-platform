import type { UnifiedPaper, SearchOptions, SearchResult } from "./types";

const BASE_URL = "https://api.semanticscholar.org/graph/v1";
const FIELDS =
  "title,abstract,year,citationCount,referenceCount,authors,venue,externalIds,openAccessPdf,s2FieldsOfStudy";

export async function searchSemanticScholar(
  options: SearchOptions
): Promise<SearchResult> {
  const { query, limit = 20, yearFrom, yearTo } = options;

  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: FIELDS,
  });

  if (yearFrom != null || yearTo != null) {
    const from = yearFrom ?? "";
    const to = yearTo ?? "";
    params.set("year", `${from}-${to}`);
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }

  const res = await fetch(`${BASE_URL}/paper/search?${params}`, { headers });

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("Semantic Scholar rate limit exceeded. Try again later.");
    }
    throw new Error(`Semantic Scholar API error: ${res.status}`);
  }

  const data = await res.json();

  const papers: UnifiedPaper[] = (data.data ?? []).map(
    (p: Record<string, unknown>) => ({
      title: p.title as string,
      abstract: p.abstract as string | undefined,
      authors: ((p.authors as Array<{ name: string; authorId?: string }>) ?? []).map(
        (a) => ({ name: a.name, authorId: a.authorId })
      ),
      year: p.year as number | undefined,
      venue: p.venue as string | undefined,
      citationCount: (p.citationCount as number) ?? 0,
      referenceCount: (p.referenceCount as number) ?? 0,
      doi: (p.externalIds as Record<string, string>)?.DOI,
      externalId: p.paperId as string,
      source: "semantic_scholar" as const,
      pdfUrl: (p.openAccessPdf as { url?: string })?.url,
      openAccessPdf: (p.openAccessPdf as { url?: string })?.url,
      fieldsOfStudy: (
        (p.s2FieldsOfStudy as Array<{ category: string }>) ?? []
      ).map((f) => f.category),
      rawMetadata: p,
    })
  );

  return {
    papers,
    total: (data.total as number) ?? papers.length,
    source: "semantic_scholar",
  };
}
