/**
 * Web of Science integration.
 *
 * WoS has 3 API tiers:
 * 1. Starter API (free, limited) — basic metadata, 1 req/s, needs Clarivate account
 * 2. Expanded API — full access, requires institutional subscription
 * 3. Lite API — intermediate
 *
 * We use the Starter API (free): https://developer.clarivate.com/apis/wos-starter
 * Requires API key from: https://developer.clarivate.com
 *
 * If no WoS API key, we fall back to OpenAlex which indexes most WoS papers.
 */
import type { UnifiedPaper, SearchResult } from "./types";
import { proxyFetch } from "@/lib/ai/proxy-fetch";
import { getEnv } from "@/lib/env";

const WOS_BASE = "https://api.clarivate.com/apis/wos-starter/v1";

export async function searchWoS(
  query: string,
  limit: number = 10
): Promise<SearchResult> {
  const apiKey = getEnv("WOS_API_KEY");

  if (!apiKey) {
    console.log("[wos] No WOS_API_KEY configured, skipping WoS search");
    return { papers: [], total: 0, source: "openalex" };
  }

  try {
    const params = new URLSearchParams({
      q: query,
      limit: String(Math.min(limit, 50)),
      page: "1",
      db: "WOS",
    });

    const res = await proxyFetch(`${WOS_BASE}/documents?${params}`, {
      headers: {
        "X-ApiKey": apiKey,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.error(`[wos] API error: ${res.status}`);
      return { papers: [], total: 0, source: "openalex" };
    }

    const data = (await res.json()) as {
      metadata?: { total?: number };
      hits?: Array<Record<string, unknown>>;
    };

    const papers: UnifiedPaper[] = (data.hits ?? []).map((hit) => {
      const source = hit.source as Record<string, unknown> | undefined;
      const names = hit.names as { authors?: Array<{ wosStandard?: string; displayName?: string }> } | undefined;

      return {
        title: (source?.title as string) ?? "",
        abstract: undefined, // Starter API doesn't include abstracts
        authors: (names?.authors ?? []).map((a) => ({
          name: a.displayName ?? a.wosStandard ?? "",
        })),
        year: source?.publishYear as number | undefined,
        venue: (source?.sourceTitle as string) ?? undefined,
        citationCount: (hit.citations as Array<{ count?: number }>)?.[0]?.count ?? 0,
        referenceCount: 0,
        doi: (hit.identifiers as { doi?: string })?.doi ?? undefined,
        externalId: (hit.uid as string) ?? undefined,
        source: "openalex" as const,
        fieldsOfStudy: undefined,
      };
    });

    console.log(`[wos] Found ${papers.length} papers`);
    return { papers, total: data.metadata?.total ?? papers.length, source: "openalex" };
  } catch (err) {
    console.error("[wos] search failed:", (err as Error).message);
    return { papers: [], total: 0, source: "openalex" };
  }
}
