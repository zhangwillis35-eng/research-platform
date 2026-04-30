/**
 * DBLP API — computer science bibliography search.
 *
 * Free, no key needed. Good for CS/IS papers.
 * Endpoint: https://dblp.org/search/publ/api
 */
import type { UnifiedPaper, SearchResult } from "./types";
import { proxyFetch } from "@/lib/ai/proxy-fetch";

const DBLP_BASE = "https://dblp.org/search/publ/api";

export async function searchDBLP(
  query: string,
  limit: number = 10
): Promise<SearchResult> {
  const safeLimit = Math.min(limit, 30);

  try {
    const params = new URLSearchParams({
      q: query,
      format: "json",
      h: String(safeLimit),
    });

    console.log(`[dblp] Searching: ${query.slice(0, 80)}...`);

    const res = await proxyFetch(`${DBLP_BASE}?${params}`, {
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.error(`[dblp] API error: ${res.status}`);
      return { papers: [], total: 0, source: "openalex" };
    }

    const data = await res.json();
    const hits = data.result?.hits?.hit ?? [];
    const total = parseInt(data.result?.hits?.["@total"] ?? "0", 10);

    const papers: UnifiedPaper[] = hits
      .filter((hit: Record<string, unknown>) => hit.info)
      .map((hit: Record<string, unknown>) => {
        const info = hit.info as Record<string, unknown>;

        const title = (info.title as string)?.replace(/<[^>]+>/g, "").replace(/\.$/, "").trim();
        if (!title) return null;

        // Authors can be a string or array of objects/strings
        const authors: { name: string }[] = [];
        const rawAuthors = (info.authors as Record<string, unknown>)?.author;
        if (rawAuthors) {
          if (Array.isArray(rawAuthors)) {
            for (const a of rawAuthors) {
              const name = typeof a === "string" ? a : (a as Record<string, unknown>)?.text as string;
              if (name) authors.push({ name });
            }
          } else if (typeof rawAuthors === "string") {
            authors.push({ name: rawAuthors });
          } else if (typeof rawAuthors === "object") {
            const name = (rawAuthors as Record<string, unknown>)?.text as string;
            if (name) authors.push({ name });
          }
        }

        const yearStr = info.year as string | undefined;
        const year = yearStr ? parseInt(yearStr, 10) : undefined;

        const venue = (info.venue as string) ?? undefined;
        const doi = (info.doi as string) ?? undefined;
        const url = (info.url as string) ?? undefined;

        return {
          title,
          authors,
          year: year && year > 1800 && year <= new Date().getFullYear() + 1 ? year : undefined,
          venue,
          citationCount: 0,
          referenceCount: 0,
          doi,
          externalId: (info.key as string) ?? undefined,
          source: "openalex" as const,
          pdfUrl: url ?? undefined,
        } satisfies UnifiedPaper;
      })
      .filter(Boolean) as UnifiedPaper[];

    console.log(`[dblp] Found ${papers.length} papers`);

    return { papers, total, source: "openalex" };
  } catch (err) {
    console.error("[dblp] search failed:", (err as Error).message);
    return { papers: [], total: 0, source: "openalex" };
  }
}
