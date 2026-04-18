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
    per_page: String(limit),
    filter: filters.join(","),
    select:
      "id,doi,title,display_name,publication_year,cited_by_count,referenced_works_count,authorships,primary_location,abstract_inverted_index,open_access,topics",
  });

  // polite pool: add email for better rate limits
  if (process.env.OPENALEX_EMAIL) {
    params.set("mailto", process.env.OPENALEX_EMAIL);
  }

  const res = await fetch(`${BASE_URL}/works?${params}`);

  if (!res.ok) {
    throw new Error(`OpenAlex API error: ${res.status}`);
  }

  const data = await res.json();

  const papers: UnifiedPaper[] = (data.results ?? []).map(
    (w: Record<string, unknown>) => ({
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
    })
  );

  return {
    papers,
    total: (data.meta?.count as number) ?? papers.length,
    source: "openalex",
  };
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
