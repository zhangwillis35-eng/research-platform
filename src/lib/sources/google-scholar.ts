import type { UnifiedPaper, SearchOptions, SearchResult } from "./types";

const BASE_URL = "https://serpapi.com/search.json";

export async function searchGoogleScholar(
  options: SearchOptions
): Promise<SearchResult> {
  const { query, limit = 20, yearFrom, yearTo } = options;

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    throw new Error("SERPAPI_KEY is not configured");
  }

  const params = new URLSearchParams({
    engine: "google_scholar",
    q: query,
    api_key: apiKey,
    num: String(limit),
  });

  if (yearFrom != null) params.set("as_ylo", String(yearFrom));
  if (yearTo != null) params.set("as_yhi", String(yearTo));

  const res = await fetch(`${BASE_URL}?${params}`);

  if (!res.ok) {
    throw new Error(`SerpAPI error: ${res.status}`);
  }

  const data = await res.json();

  const papers: UnifiedPaper[] = (data.organic_results ?? []).map(
    (r: Record<string, unknown>) => {
      const info = (r.publication_info as { summary?: string }) ?? {};
      const authorNames = parseAuthorString(info.summary);

      return {
        title: r.title as string,
        abstract: r.snippet as string | undefined,
        authors: authorNames.map((name) => ({ name })),
        year: extractYear(info.summary),
        venue: extractVenue(info.summary),
        citationCount:
          (
            r.inline_links as {
              cited_by?: { total?: number };
            }
          )?.cited_by?.total ?? 0,
        referenceCount: 0,
        doi: undefined,
        externalId: r.result_id as string,
        source: "google_scholar" as const,
        pdfUrl: (
          r.resources as Array<{ link?: string; file_format?: string }>
        )?.find((res) => res.file_format === "PDF")?.link,
        openAccessPdf: (
          r.resources as Array<{ link?: string; file_format?: string }>
        )?.find((res) => res.file_format === "PDF")?.link,
        fieldsOfStudy: undefined,
        rawMetadata: r,
      };
    }
  );

  return {
    papers,
    total:
      (data.search_information?.total_results as number) ?? papers.length,
    source: "google_scholar",
  };
}

function parseAuthorString(summary?: string): string[] {
  if (!summary) return [];
  // Format: "Author1, Author2 - Journal, Year"
  const authorPart = summary.split(" - ")[0];
  if (!authorPart) return [];
  return authorPart
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !/^\d{4}$/.test(s));
}

function extractYear(summary?: string): number | undefined {
  if (!summary) return undefined;
  const match = summary.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0]) : undefined;
}

function extractVenue(summary?: string): string | undefined {
  if (!summary) return undefined;
  const parts = summary.split(" - ");
  return parts.length > 1 ? parts[1]?.split(",")[0]?.trim() : undefined;
}
