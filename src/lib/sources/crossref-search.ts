/**
 * CrossRef search API — authoritative DOI metadata.
 *
 * Free, polite pool with email for faster rate limits.
 * THE authoritative source for DOI resolution and citation metadata.
 */
import type { UnifiedPaper, SearchOptions, SearchResult } from "./types";
import { proxyFetch } from "@/lib/ai/proxy-fetch";

const CROSSREF_BASE = "https://api.crossref.org/works";

export async function searchCrossRef(
  options: SearchOptions
): Promise<SearchResult> {
  const { query, limit = 20, yearFrom, yearTo } = options;
  const safeLimit = Math.min(limit, 50);

  try {
    const params = new URLSearchParams({
      query: query,
      rows: String(safeLimit),
    });

    // Date filters
    const filters: string[] = [];
    if (yearFrom) filters.push(`from-pub-date:${yearFrom}`);
    if (yearTo) filters.push(`until-pub-date:${yearTo}`);
    if (filters.length > 0) params.set("filter", filters.join(","));

    console.log(`[crossref] Searching: ${query.slice(0, 80)}...`);

    const res = await proxyFetch(`${CROSSREF_BASE}?${params}`, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "ScholarFlow/1.0 (mailto:scholarflow@research.app)",
        "mailto": "scholarflow@research.app",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.error(`[crossref] API error: ${res.status}`);
      return { papers: [], total: 0, source: "openalex" };
    }

    const data = await res.json();
    const items = data.message?.items ?? [];
    const total = data.message?.["total-results"] ?? 0;

    const papers: UnifiedPaper[] = items
      .filter((item: Record<string, unknown>) => item.title)
      .map((item: Record<string, unknown>) => {
        const titleArr = item.title as string[] | undefined;
        const title = titleArr?.[0]?.replace(/<[^>]+>/g, "").trim();
        if (!title) return null;

        // Authors
        const authors: { name: string }[] = [];
        const rawAuthors = item.author as Array<{ given?: string; family?: string }> | undefined;
        if (rawAuthors) {
          for (const a of rawAuthors) {
            const name = a.given && a.family
              ? `${a.given} ${a.family}`
              : a.family ?? a.given;
            if (name) authors.push({ name });
          }
        }

        // Journal
        const containerTitle = item["container-title"] as string[] | undefined;
        const venue = containerTitle?.[0] ?? undefined;

        // Year from published-print or published-online
        let year: number | undefined;
        const published = (item["published-print"] ?? item["published-online"] ?? item.published) as {
          "date-parts"?: number[][];
        } | undefined;
        if (published?.["date-parts"]?.[0]?.[0]) {
          year = published["date-parts"][0][0];
        }

        // DOI
        const doi = (item.DOI as string) ?? undefined;

        // Citation count
        const citationCount = (item["is-referenced-by-count"] as number) ?? 0;
        const referenceCount = (item["references-count"] as number) ?? 0;

        // Abstract (CrossRef sometimes has it, with JATS tags)
        let abstract = (item.abstract as string) ?? undefined;
        if (abstract) {
          abstract = abstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }

        // Open access link
        const links = item.link as Array<{ URL?: string; "content-type"?: string }> | undefined;
        const pdfLink = links?.find((l) => l["content-type"]?.includes("pdf"))?.URL;

        return {
          title,
          abstract,
          authors,
          year: year && year > 1800 && year <= new Date().getFullYear() + 1 ? year : undefined,
          venue,
          citationCount,
          referenceCount,
          doi,
          source: "openalex" as const,
          pdfUrl: pdfLink ?? undefined,
        } satisfies UnifiedPaper;
      })
      .filter(Boolean) as UnifiedPaper[];

    console.log(`[crossref] Found ${papers.length} papers`);

    return { papers, total, source: "openalex" };
  } catch (err) {
    console.error("[crossref] search failed:", (err as Error).message);
    return { papers: [], total: 0, source: "openalex" };
  }
}
