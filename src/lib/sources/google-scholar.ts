/**
 * Google Scholar search — dual provider with automatic fallback:
 *   1. Serper.dev (preferred — 2500 free credits, $0.001/call)
 *   2. SerpAPI (fallback — 100 free credits, $50/5000)
 *
 * Serper endpoint: POST https://google.serper.dev/scholar
 * Serper response: { organic: [{ title, link, snippet, year, citedBy, publicationInfo }] }
 *
 * SerpAPI endpoint: GET https://serpapi.com/search.json?engine=google_scholar
 * SerpAPI response: { organic_results: [{ title, link, snippet, publication_info, inline_links }] }
 */
import type { UnifiedPaper, SearchOptions, SearchResult } from "./types";
import { getEnv } from "@/lib/env";
import { fetchWithRetry } from "@/lib/retry-fetch";

// Track quota exhaustion per provider
const exhausted: Record<string, boolean> = {};

export async function searchGoogleScholar(
  options: SearchOptions
): Promise<SearchResult> {
  // Try Serper first, then SerpAPI
  const serperKey = getEnv("SERPER_API_KEY");
  const serpApiKey = getEnv("SERPAPI_KEY");

  if (serperKey && !exhausted.serper) {
    try {
      return await searchViaSerper(options, serperKey);
    } catch (err) {
      console.error("[google-scholar] Serper failed:", (err as Error).message);
      // Fall through to SerpAPI
    }
  }

  if (serpApiKey && !exhausted.serpapi) {
    try {
      return await searchViaSerpAPI(options, serpApiKey);
    } catch (err) {
      console.error("[google-scholar] SerpAPI failed:", (err as Error).message);
      throw err;
    }
  }

  throw new Error("Google Scholar 不可用 — 请配置 SERPER_API_KEY 或 SERPAPI_KEY");
}

// ─── Serper.dev ────────────────────────────────────

async function searchViaSerper(
  options: SearchOptions,
  apiKey: string
): Promise<SearchResult> {
  const { query, limit = 40, yearFrom, yearTo } = options;

  // Fetch page 1 (up to 20 results)
  const page1 = await fetchSerperPage(query, apiKey, 10, 0, yearFrom, yearTo);
  if (!page1) return { papers: [], total: 0, source: "google_scholar" };

  let allPapers = page1;

  // Fetch page 2 if we need more results (costs 1 extra Serper call)
  if (limit > 20 && page1.length >= 10) {
    const page2 = await fetchSerperPage(query, apiKey, 10, page1.length, yearFrom, yearTo);
    if (page2) allPapers = [...page1, ...page2];
  }

  console.log(`[google-scholar] Serper returned ${allPapers.length} papers (${limit > 20 ? "2 pages" : "1 page"})`);

  return {
    papers: allPapers,
    total: allPapers.length,
    source: "google_scholar",
  };
}

async function fetchSerperPage(
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

  const res = await fetchWithRetry(
    "https://google.serper.dev/scholar",
    {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    { maxRetries: 2, baseDelayMs: 2000, retryOn: [429, 503] }
  );

  if (res.status === 403 || res.status === 429) {
    exhausted.serper = true;
    return null;
  }
  if (!res.ok) return null;

  const data = await res.json();
  if (data.message?.includes("Unauthorized") || data.statusCode === 403) {
    exhausted.serper = true;
    return null;
  }

  return (data.organic ?? []).map(
    (r: Record<string, unknown>) => {
      const pubInfo = r.publicationInfo as string | undefined;
      const authors = parseAuthorString(pubInfo);
      const venue = extractVenue(pubInfo);
      const rawYear = (r.year as number | undefined) ?? extractYear(pubInfo);
      // Validate year — Serper sometimes returns arXiv ID prefix (e.g., 2110) as year
      const year = rawYear && rawYear >= 1900 && rawYear <= new Date().getFullYear() + 1 ? rawYear : extractYear(pubInfo);

      return {
        title: r.title as string,
        abstract: r.snippet as string | undefined,
        authors: authors.map((name) => ({ name })),
        year,
        venue,
        citationCount: (r.citedBy as number) ?? 0,
        referenceCount: 0,
        doi: extractDOI(r.link as string | undefined),
        externalId: undefined,
        source: "google_scholar" as const,
        pdfUrl: r.link as string | undefined,
        openAccessPdf: undefined,
        fieldsOfStudy: undefined,
      };
    }
  );
}

// ─── SerpAPI (fallback) ───────────────────────────

async function searchViaSerpAPI(
  options: SearchOptions,
  apiKey: string
): Promise<SearchResult> {
  const { query, limit = 20, yearFrom, yearTo } = options;

  const params = new URLSearchParams({
    engine: "google_scholar",
    q: query,
    api_key: apiKey,
    num: String(Math.min(limit, 20)),
    hl: "en",
  });

  if (yearFrom != null) params.set("as_ylo", String(yearFrom));
  if (yearTo != null) params.set("as_yhi", String(yearTo));

  const res = await fetchWithRetry(
    `https://serpapi.com/search.json?${params}`,
    {},
    { maxRetries: 2, baseDelayMs: 2000, retryOn: [429, 503] }
  );

  if (!res.ok) {
    throw new Error(`SerpAPI error: ${res.status}`);
  }

  const data = await res.json();

  if (data.error?.includes("run out of searches") || data.error?.includes("Invalid API key")) {
    exhausted.serpapi = true;
    throw new Error("SerpAPI quota exhausted");
  }

  const papers: UnifiedPaper[] = (data.organic_results ?? []).map(
    (r: Record<string, unknown>) => {
      const pubInfo = r.publication_info as {
        summary?: string;
        authors?: Array<{ name: string; author_id?: string }>;
      } | undefined;

      const inlineLinks = r.inline_links as {
        cited_by?: { total?: number; link?: string };
        versions?: { total?: number; link?: string };
        cached_page_link?: string;
      } | undefined;

      const resources = r.resources as Array<{
        file_format?: string;
        link?: string;
      }> | undefined;

      const authors = pubInfo?.authors?.length
        ? pubInfo.authors.map((a) => ({ name: a.name, authorId: a.author_id }))
        : parseAuthorString(pubInfo?.summary).map((name) => ({ name }));

      const venue = extractVenue(pubInfo?.summary);
      const year = extractYear(pubInfo?.summary);

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
      };
    }
  );

  console.log(`[google-scholar] SerpAPI returned ${papers.length} papers`);

  return {
    papers,
    total: (data.search_information?.total_results as number) ?? papers.length,
    source: "google_scholar",
  };
}

// ─── Shared helpers ───────────────────────────────

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
  const parts = summary.split(" - ");
  if (parts.length < 2) return undefined;
  const journalPart = parts[1];
  const cleaned = journalPart?.replace(/,?\s*\d{4}\s*$/, "").trim();
  return cleaned || undefined;
}

function extractDOI(link?: string): string | undefined {
  if (!link) return undefined;
  const doiMatch = link.match(/doi\.org\/(.+?)(?:\?|$)/);
  return doiMatch ? doiMatch[1] : undefined;
}
