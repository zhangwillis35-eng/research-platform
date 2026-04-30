/**
 * bioRxiv/medRxiv API — preprint search for biology and medicine.
 *
 * Free, no key needed. All papers are open access.
 * Search endpoint: https://api.biorxiv.org/search/{query}/na/na/0/{limit}
 */
import type { UnifiedPaper, SearchResult } from "./types";
import { proxyFetch } from "@/lib/ai/proxy-fetch";

const BIORXIV_SEARCH = "https://api.biorxiv.org/search";

export async function searchBioRxiv(
  query: string,
  limit: number = 10
): Promise<SearchResult> {
  const safeLimit = Math.min(limit, 30);

  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `${BIORXIV_SEARCH}/${encodedQuery}/na/na/0/${safeLimit}`;

    console.log(`[biorxiv] Searching: ${query.slice(0, 80)}...`);

    const res = await proxyFetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.error(`[biorxiv] API error: ${res.status}`);
      return { papers: [], total: 0, source: "openalex" };
    }

    const data = await res.json();
    const collection = data.collection ?? [];

    if (collection.length === 0) {
      console.log("[biorxiv] No results found");
      return { papers: [], total: 0, source: "openalex" };
    }

    const papers: UnifiedPaper[] = collection
      .filter((item: Record<string, unknown>) => item.title)
      .map((item: Record<string, unknown>) => {
        const title = (item.title as string)?.trim();
        if (!title) return null;

        const abstract = (item.abstract as string)?.trim() ?? undefined;
        const doi = (item.doi as string) ?? undefined;
        const dateStr = item.date as string | undefined;
        const year = dateStr ? parseInt(dateStr.slice(0, 4), 10) : undefined;
        const category = (item.category as string) ?? undefined;
        const server = (item.server as string) ?? "biorxiv";

        // Parse authors: "LastName, F.; LastName2, G." format
        const authors: { name: string }[] = [];
        const authorsStr = item.authors as string | undefined;
        if (authorsStr) {
          const parts = authorsStr.split(";").map((s) => s.trim()).filter(Boolean);
          for (const part of parts) {
            authors.push({ name: part });
          }
        }

        // All bioRxiv/medRxiv papers are open access
        const pdfUrl = doi ? `https://www.biorxiv.org/content/${doi}v1.full.pdf` : undefined;

        const venue = server === "medrxiv" ? "medRxiv" : "bioRxiv";

        return {
          title,
          abstract,
          authors,
          year: year && year > 1800 && year <= new Date().getFullYear() + 1 ? year : undefined,
          venue,
          citationCount: 0,
          referenceCount: 0,
          doi,
          source: "openalex" as const,
          pdfUrl,
          openAccessPdf: pdfUrl,
          fieldsOfStudy: category ? [category] : undefined,
        } satisfies UnifiedPaper;
      })
      .filter(Boolean) as UnifiedPaper[];

    console.log(`[biorxiv] Found ${papers.length} papers`);

    return {
      papers,
      total: data.messages?.[0]?.total ?? papers.length,
      source: "openalex",
    };
  } catch (err) {
    console.error("[biorxiv] search failed:", (err as Error).message);
    return { papers: [], total: 0, source: "openalex" };
  }
}
