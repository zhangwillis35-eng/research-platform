/**
 * CORE.ac.uk API — largest open access research papers aggregator.
 *
 * Free API: https://api.core.ac.uk/v3/
 * Rate limit: 10 req/s (with API key), 1 req/10s (without)
 * Provides: search, full text, metadata
 */
import type { UnifiedPaper, SearchResult } from "./types";
import { fetchWithRetry } from "@/lib/retry-fetch";
import { getEnv } from "@/lib/env";

const CORE_BASE = "https://api.core.ac.uk/v3";

function getHeaders(): HeadersInit {
  const key = getEnv("CORE_API_KEY");
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

// ─── Search papers ─────────────────────────────

export async function searchCORE(
  query: string,
  limit: number = 10
): Promise<SearchResult> {
  const apiKey = getEnv("CORE_API_KEY");
  if (!apiKey) {
    console.log("[core] No CORE_API_KEY set — skipping CORE search. Get a free key at https://core.ac.uk/services/api");
    return { papers: [], total: 0, source: "openalex" };
  }

  try {
    const params = new URLSearchParams({
      q: query,
      limit: String(Math.min(limit, 20)),
      scroll: "false",
    });

    const res = await fetchWithRetry(`${CORE_BASE}/search/works?${params}`, {
      headers: getHeaders(),
    });

    if (res.status === 401 || res.status === 403) {
      console.error("[core] API key invalid or expired. Check CORE_API_KEY in .env");
      return { papers: [], total: 0, source: "openalex" };
    }

    if (!res.ok) {
      console.error(`[core] API error: ${res.status}`);
      return { papers: [], total: 0, source: "openalex" };
    }

    const data = (await res.json()) as {
      totalHits?: number;
      results?: Array<Record<string, unknown>>;
    };

    const papers: UnifiedPaper[] = (data.results ?? [])
      .filter((w) => w.title)
      .map((w) => {
        const doi = w.doi as string | undefined;
        const year = w.yearPublished as number | undefined;
        const authors = ((w.authors as Array<{ name?: string }>) ?? [])
          .filter((a) => a.name)
          .map((a) => ({ name: a.name! }));

        return {
          title: w.title as string,
          abstract: (w.abstract as string) ?? undefined,
          authors,
          year,
          venue: (w.publisher as string) ?? (w.journals as Array<{ title?: string }>)?.[0]?.title ?? undefined,
          citationCount: (w.citationCount as number) ?? 0,
          referenceCount: 0,
          doi: doi?.replace("https://doi.org/", "") ?? undefined,
          externalId: String(w.id ?? ""),
          source: "openalex" as const, // reuse for type compatibility
          pdfUrl: (w.downloadUrl as string) ?? (w.sourceFulltextUrls as string[])?.[0] ?? undefined,
          openAccessPdf: (w.downloadUrl as string) ?? undefined,
          fieldsOfStudy: ((w.fieldOfStudy as string) ? [w.fieldOfStudy as string] : undefined),
        };
      });

    console.log(`[core] Found ${papers.length} papers`);

    return {
      papers,
      total: data.totalHits ?? papers.length,
      source: "openalex",
    };
  } catch (err) {
    console.error("[core] search failed:", (err as Error).message);
    return { papers: [], total: 0, source: "openalex" };
  }
}

// ─── Get full text for a paper ──────────────────

export async function getCOREFullText(
  coreId: string
): Promise<string | null> {
  try {
    const res = await fetchWithRetry(`${CORE_BASE}/works/${coreId}`, {
      headers: getHeaders(),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { fullText?: string };
    return data.fullText ?? null;
  } catch {
    return null;
  }
}

// ─── Search for full text by DOI ────────────────

export async function getCOREFullTextByDOI(
  doi: string
): Promise<{ fullText: string; downloadUrl?: string } | null> {
  try {
    const res = await fetchWithRetry(
      `${CORE_BASE}/search/works?q=doi:"${encodeURIComponent(doi)}"&limit=1`,
      { headers: getHeaders() }
    );

    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ id?: number; fullText?: string; downloadUrl?: string }>;
    };

    const result = data.results?.[0];
    if (!result) return null;

    // If full text is in search result, return it
    if (result.fullText) {
      return { fullText: result.fullText, downloadUrl: result.downloadUrl ?? undefined };
    }

    // Otherwise fetch full details
    if (result.id) {
      const fullText = await getCOREFullText(String(result.id));
      if (fullText) return { fullText, downloadUrl: result.downloadUrl ?? undefined };
    }

    return null;
  } catch {
    return null;
  }
}
