/**
 * CNKI (中国知网) search — via Google Scholar Serper API with site:cnki.net filter.
 *
 * Since CNKI has no public REST API, we use Serper to search Google Scholar
 * scoped to cnki.net domains, which effectively searches CNKI's indexed content.
 *
 * Queries MUST be in Chinese for best results.
 */
import type { UnifiedPaper, SearchOptions, SearchResult } from "./types";
import { getEnv } from "@/lib/env";
import { fetchWithRetry } from "@/lib/retry-fetch";

export async function searchCNKI(options: SearchOptions): Promise<SearchResult> {
  const serperKey = getEnv("SERPER_API_KEY");
  if (!serperKey) {
    console.log("[cnki] No SERPER_API_KEY, skipping");
    return { papers: [], total: 0, source: "cnki" as UnifiedPaper["source"] };
  }

  const { query, limit = 20, yearFrom, yearTo } = options;

  // Search Google Scholar scoped to CNKI
  const siteQuery = `site:cnki.net ${query}`;
  const papers = await fetchCNKIPage(siteQuery, serperKey, Math.min(limit, 20), 0, yearFrom, yearTo);

  // If we need more, fetch page 2
  let allPapers = papers ?? [];
  if (limit > 20 && allPapers.length >= 15) {
    const page2 = await fetchCNKIPage(siteQuery, serperKey, 20, 20, yearFrom, yearTo);
    if (page2) allPapers = [...allPapers, ...page2];
  }

  console.log(`[cnki] Returned ${allPapers.length} papers for query: ${query.slice(0, 50)}`);

  return {
    papers: allPapers,
    total: allPapers.length,
    source: "cnki" as UnifiedPaper["source"],
  };
}

async function fetchCNKIPage(
  q: string,
  apiKey: string,
  num: number,
  page: number,
  yearFrom?: number,
  yearTo?: number
): Promise<UnifiedPaper[] | null> {
  const body: Record<string, unknown> = { q, num };
  if (page > 0) body.page = Math.floor(page / 10) + 1;
  if (yearFrom != null) body.as_ylo = yearFrom;
  if (yearTo != null) body.as_yhi = yearTo;

  try {
    const res = await fetchWithRetry(
      "https://google.serper.dev/scholar",
      {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { maxRetries: 1, baseDelayMs: 1000, retryOn: [429, 503] }
    );

    if (!res.ok) return null;
    const data = await res.json();

    return (data.organic ?? []).map((r: Record<string, unknown>) => {
      const pubInfo = r.publicationInfo as string | undefined;
      const rawYear = (r.year as number | undefined) ?? extractYear(pubInfo);
      const year = rawYear && rawYear >= 1900 && rawYear <= new Date().getFullYear() + 1 ? rawYear : undefined;

      return {
        title: r.title as string,
        abstract: r.snippet as string | undefined,
        authors: parseChineseAuthors(pubInfo),
        year,
        venue: extractVenue(pubInfo),
        citationCount: (r.citedBy as number) ?? 0,
        referenceCount: 0,
        doi: undefined,
        externalId: undefined,
        source: "cnki" as const,
        pdfUrl: r.link as string | undefined,
        openAccessPdf: undefined,
        fieldsOfStudy: undefined,
      };
    });
  } catch (err) {
    console.error("[cnki] Search failed:", (err as Error).message);
    return null;
  }
}

function parseChineseAuthors(pubInfo?: string): { name: string }[] {
  if (!pubInfo) return [];
  // CNKI format: "作者1, 作者2 - 期刊名, 年份"
  const authorPart = pubInfo.split(" - ")[0] ?? "";
  return authorPart
    .split(/[,，、;；]/)
    .map((a) => a.trim())
    .filter((a) => a.length >= 2 && a.length <= 10)
    .map((name) => ({ name }));
}

function extractVenue(pubInfo?: string): string | undefined {
  if (!pubInfo) return undefined;
  const parts = pubInfo.split(" - ");
  if (parts.length >= 2) return parts[1]?.split(",")[0]?.trim();
  return undefined;
}

function extractYear(pubInfo?: string): number | undefined {
  if (!pubInfo) return undefined;
  const match = pubInfo.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0]) : undefined;
}
