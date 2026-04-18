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
    num: String(Math.min(limit, 20)), // GS max 20 per page
    hl: "en",
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
      const pubInfo = r.publication_info as {
        summary?: string;
        authors?: Array<{ name: string; author_id?: string }>;
      } | undefined;

      const inlineLinks = r.inline_links as {
        cited_by?: { total?: number; link?: string };
        related_pages_link?: string;
      } | undefined;

      const resources = r.resources as Array<{
        title?: string;
        file_format?: string;
        link?: string;
      }> | undefined;

      // Extract authors — prefer structured data, fallback to summary parsing
      const authors = pubInfo?.authors?.length
        ? pubInfo.authors.map((a) => ({ name: a.name, authorId: a.author_id }))
        : parseAuthorString(pubInfo?.summary).map((name) => ({ name }));

      // Extract venue (journal name) from summary: "Authors - Journal Name, Year - Publisher"
      const venue = extractVenue(pubInfo?.summary);
      const year = extractYear(pubInfo?.summary);
      const publisher = extractPublisher(pubInfo?.summary);

      // Find PDF link
      const pdfResource = resources?.find(
        (res) => res.file_format === "PDF" || res.link?.endsWith(".pdf")
      );

      return {
        title: r.title as string,
        abstract: r.snippet as string | undefined,
        authors,
        year,
        venue,
        citationCount: inlineLinks?.cited_by?.total ?? 0,
        referenceCount: 0,
        doi: extractDOI(r.link as string | undefined),
        externalId: r.result_id as string,
        source: "google_scholar" as const,
        pdfUrl: pdfResource?.link ?? (r.link as string | undefined),
        openAccessPdf: pdfResource?.link,
        fieldsOfStudy: undefined,
        rawMetadata: {
          ...r,
          _publisher: publisher,
          _googleScholarUrl: inlineLinks?.cited_by?.link,
        },
      };
    }
  );

  return {
    papers,
    total: (data.search_information?.total_results as number) ?? papers.length,
    source: "google_scholar",
  };
}

function parseAuthorString(summary?: string): string[] {
  if (!summary) return [];
  const authorPart = summary.split(" - ")[0];
  if (!authorPart) return [];
  return authorPart
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !/^\d{4}$/.test(s) && s.length < 40);
}

function extractYear(summary?: string): number | undefined {
  if (!summary) return undefined;
  const match = summary.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0]) : undefined;
}

function extractVenue(summary?: string): string | undefined {
  if (!summary) return undefined;
  // Format: "Author1, Author2 - Journal Name, Year - Publisher"
  const parts = summary.split(" - ");
  if (parts.length < 2) return undefined;
  // Second part is "Journal Name, Year" or just "Journal Name"
  const journalPart = parts[1];
  // Remove year from the end
  const cleaned = journalPart?.replace(/,?\s*\d{4}\s*$/, "").trim();
  return cleaned || undefined;
}

function extractPublisher(summary?: string): string | undefined {
  if (!summary) return undefined;
  const parts = summary.split(" - ");
  return parts.length >= 3 ? parts[2]?.trim() : undefined;
}

function extractDOI(link?: string): string | undefined {
  if (!link) return undefined;
  // Extract DOI from common academic URLs
  const doiMatch = link.match(/doi\.org\/(.+?)(?:\?|$)/);
  if (doiMatch) return doiMatch[1];
  // ScienceDirect PII to approximate (no DOI extraction possible)
  return undefined;
}
