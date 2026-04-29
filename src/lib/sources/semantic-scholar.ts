import type { UnifiedPaper, SearchOptions, SearchResult } from "./types";
import { fetchWithRetry } from "@/lib/retry-fetch";
import { getEnv } from "@/lib/env";

const BASE_URL = "https://api.semanticscholar.org/graph/v1";
const REC_URL = "https://api.semanticscholar.org/recommendations/v1";
const FIELDS =
  "title,abstract,year,citationCount,referenceCount,authors,venue,externalIds,openAccessPdf,s2FieldsOfStudy,tldr";

function getHeaders(): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const apiKey = getEnv("SEMANTIC_SCHOLAR_API_KEY");
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

function mapPaper(p: Record<string, unknown>): UnifiedPaper {
  const tldr = p.tldr as { text?: string } | undefined;
  const abstract = (p.abstract as string) ?? tldr?.text;
  return {
    title: p.title as string,
    abstract,
    authors: ((p.authors as Array<{ name: string; authorId?: string }>) ?? []).map(
      (a) => ({ name: a.name, authorId: a.authorId })
    ),
    year: p.year as number | undefined,
    venue: p.venue as string | undefined,
    citationCount: (p.citationCount as number) ?? 0,
    referenceCount: (p.referenceCount as number) ?? 0,
    doi: (p.externalIds as Record<string, string>)?.DOI,
    externalId: p.paperId as string,
    source: "semantic_scholar" as const,
    pdfUrl: (p.openAccessPdf as { url?: string })?.url,
    openAccessPdf: (p.openAccessPdf as { url?: string })?.url,
    fieldsOfStudy: (
      (p.s2FieldsOfStudy as Array<{ category: string }>) ?? []
    ).map((f) => f.category),
    rawMetadata: p,
  };
}

// ─── Basic search ──────────────────────────────

export async function searchSemanticScholar(
  options: SearchOptions
): Promise<SearchResult> {
  const { query, limit = 20, yearFrom, yearTo } = options;

  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: FIELDS,
  });

  if (yearFrom != null || yearTo != null) {
    const from = yearFrom ?? "";
    const to = yearTo ?? "";
    params.set("year", `${from}-${to}`);
  }

  const res = await fetchWithRetry(`${BASE_URL}/paper/search?${params}`, {
    headers: getHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Semantic Scholar API error: ${res.status}`);
  }

  const data = await res.json();
  const papers = (data.data ?? []).map(mapPaper);

  return {
    papers,
    total: (data.total as number) ?? papers.length,
    source: "semantic_scholar",
  };
}

// ─── Recommendations (NLP-based similar papers) ──

export async function getRecommendations(
  paperIds: string[],
  limit: number = 10
): Promise<UnifiedPaper[]> {
  if (paperIds.length === 0) return [];

  try {
    const res = await fetchWithRetry(`${REC_URL}/papers/?fields=${FIELDS}&limit=${limit}`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ positivePaperIds: paperIds.slice(0, 5) }),
    });

    if (!res.ok) {
      console.error(`[s2-recommend] API error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    return (data.recommendedPapers ?? []).map(mapPaper);
  } catch (err) {
    console.error("[s2-recommend] failed:", (err as Error).message);
    return [];
  }
}

// ─── Get citing papers (who cited this paper) ────

export async function getCitingPapers(
  paperId: string,
  limit: number = 10
): Promise<UnifiedPaper[]> {
  try {
    const res = await fetchWithRetry(
      `${BASE_URL}/paper/${paperId}/citations?fields=${FIELDS}&limit=${limit}`,
      { headers: getHeaders() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data ?? [])
      .filter((d: { citingPaper: Record<string, unknown> }) => d.citingPaper?.title)
      .map((d: { citingPaper: Record<string, unknown> }) => mapPaper(d.citingPaper));
  } catch {
    return [];
  }
}

// ─── Get referenced papers (what this paper cites) ──

export async function getReferencedPapers(
  paperId: string,
  limit: number = 10
): Promise<UnifiedPaper[]> {
  try {
    const res = await fetchWithRetry(
      `${BASE_URL}/paper/${paperId}/references?fields=${FIELDS}&limit=${limit}`,
      { headers: getHeaders() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data ?? [])
      .filter((d: { citedPaper: Record<string, unknown> }) => d.citedPaper?.title)
      .map((d: { citedPaper: Record<string, unknown> }) => mapPaper(d.citedPaper));
  } catch {
    return [];
  }
}

// ─── Get paper details by DOI ─────────────────

export async function getPaperByDOI(doi: string): Promise<UnifiedPaper | null> {
  try {
    const res = await fetchWithRetry(
      `${BASE_URL}/paper/DOI:${encodeURIComponent(doi)}?fields=${FIELDS}`,
      { headers: getHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return mapPaper(data);
  } catch {
    return null;
  }
}

// ─── Batch lookup by DOIs or titles ─────────────

const BATCH_FIELDS =
  "title,abstract,year,citationCount,referenceCount,authors,venue,externalIds,openAccessPdf,s2FieldsOfStudy,tldr";

/**
 * Batch lookup papers by DOI or title via S2 /paper/batch endpoint.
 * Returns a Map keyed by the input identifier (DOI or title).
 * Up to 500 IDs per call.
 */
export async function batchLookupS2(
  identifiers: Array<{ doi?: string; title: string }>
): Promise<Map<string, UnifiedPaper>> {
  const results = new Map<string, UnifiedPaper>();
  if (identifiers.length === 0) return results;

  // Build IDs list: prefer DOI, fall back to title search
  const ids = identifiers.map((id) =>
    id.doi ? `DOI:${id.doi}` : `TITLE:${id.title}`
  );

  // S2 batch endpoint supports up to 500 IDs per call
  const BATCH_SIZE = 500;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const batchIdentifiers = identifiers.slice(i, i + BATCH_SIZE);

    try {
      const res = await fetchWithRetry(
        `${BASE_URL}/paper/batch?fields=${BATCH_FIELDS}`,
        {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ ids: batch }),
        },
        { maxRetries: 2, baseDelayMs: 2000 }
      );

      if (!res.ok) {
        console.error(`[s2-batch] API error: ${res.status}`);
        continue;
      }

      const data = (await res.json()) as Array<Record<string, unknown> | null>;

      for (let j = 0; j < data.length; j++) {
        const paper = data[j];
        if (!paper || !paper.title) continue;

        const mapped = mapPaper(paper);
        const orig = batchIdentifiers[j];
        // Key by DOI (lowercased) and by normalized title for lookup
        if (orig.doi) {
          results.set(orig.doi.toLowerCase(), mapped);
        }
        const titleKey = orig.title
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fff]/g, "")
          .slice(0, 80);
        if (titleKey.length >= 20) {
          results.set(titleKey, mapped);
        }
      }

      console.log(`[s2-batch] Enriched ${results.size} papers from batch of ${batch.length}`);
    } catch (err) {
      console.error("[s2-batch] failed:", (err as Error).message);
    }
  }

  return results;
}
