import type { UnifiedPaper, SearchOptions, SearchResult } from "./types";
import { searchSemanticScholar, batchLookupS2 } from "./semantic-scholar";
import { searchOpenAlex } from "./openalex";
import { searchGoogleScholar } from "./google-scholar";
import { searchArxiv } from "./arxiv";
import { searchCORE } from "./core";
import { searchWoS } from "./wos";
import { getJournalRanking } from "./journal-rankings";
import { getJournalMetadata, batchEnrichJournals } from "./journal-metadata";
import { batchFindOpenAccess } from "./unpaywall";
import { getEnv } from "@/lib/env";
import { fetchFullText } from "@/lib/research/fulltext-fetcher";
import { fetchWithRetry } from "@/lib/retry-fetch";

// Google Scholar is PRIMARY but costs SerpAPI credits; others are free
const DEFAULT_SOURCES: Array<UnifiedPaper["source"]> = [
  "google_scholar",  // Primary: best coverage, costs SerpAPI credits
  "semantic_scholar", // Free: citation data, open access PDFs, abstracts
  "openalex",         // Free: journal metrics, full metadata, abstracts
];

// Free-only sources (no SerpAPI cost)
const FREE_SOURCES: Array<UnifiedPaper["source"]> = [
  "semantic_scholar",
  "openalex",
];

/**
 * Search-only mode: just fetch + dedup, no enrichment.
 * Used by smartSearch to avoid repeated enrichment per query.
 */
export async function searchAllSourcesRaw(
  options: SearchOptions & { freeOnly?: boolean }
): Promise<{ papers: UnifiedPaper[]; results: SearchResult[] }> {
  const sources = options.freeOnly
    ? FREE_SOURCES
    : (options.sources ?? DEFAULT_SOURCES);

  // If explicit sources are passed (e.g. ["google_scholar"] only), skip extra sources
  const isExplicitSources = !!options.sources;
  const skipExtras = isExplicitSources && !sources.includes("semantic_scholar");

  const promises: Promise<SearchResult[]>[] = [
    Promise.all(
      sources.map((source) =>
        searchBySource(source, options).catch((err) => {
          console.error(`[${source}] search failed:`, err.message);
          return { papers: [], total: 0, source } as SearchResult;
        })
      )
    ),
  ];

  // Extra sources (arXiv, CORE, WoS) — skip if only Google Scholar was requested
  if (!skipExtras) {
    const extraPromises = Promise.all([
      searchArxiv({ ...options, limit: Math.min(options.limit ?? 10, 10) }).catch(() => ({
        papers: [] as UnifiedPaper[], total: 0, source: "openalex" as const,
      })),
      searchCORE(options.query, Math.min(options.limit ?? 10, 10)).catch(() => ({
        papers: [] as UnifiedPaper[], total: 0, source: "openalex" as const,
      })),
      searchWoS(options.query, Math.min(options.limit ?? 10, 10)).catch(() => ({
        papers: [] as UnifiedPaper[], total: 0, source: "openalex" as const,
      })),
    ]);
    promises.push(extraPromises);
  }

  const [results, extras] = await Promise.all(promises);

  if (extras) {
    for (const r of extras) {
      if (r.papers.length > 0) results.push(r);
    }
  }

  const allPapers = results.flatMap((r) => r.papers);
  const deduplicated = deduplicatePapers(allPapers);

  return { papers: deduplicated, results };
}

/**
 * Enrich a batch of deduplicated papers with journal rankings,
 * abstracts (4-pass pipeline), and open access links.
 * Should be called ONCE on the final merged set, not per-query.
 */
export async function enrichPapersBatch(papers: UnifiedPaper[]): Promise<UnifiedPaper[]> {
  // Step 1: Journal rankings (sync, fast)
  const enriched = enrichPapers(papers);

  // Step 1.5: S2 cross-enrichment — fill abstracts/DOIs/PDFs for ALL papers missing them
  // S2 gives: abstract, TLDR, DOI, openAccessPdf, fieldsOfStudy, referenceCount
  const needS2Enrichment = enriched.filter(
    (p) => !p.abstract || p.abstract.length < 150 || !p.doi || !p.openAccessPdf
  );

  if (needS2Enrichment.length > 0) {
    console.log(`[aggregator] Cross-enriching ${needS2Enrichment.length} Serper papers via S2 batch...`);
    try {
      const s2Map = await batchLookupS2(
        needS2Enrichment.map((p) => ({ doi: p.doi, title: p.title }))
      );

      for (const paper of needS2Enrichment) {
        // Look up by DOI first, then by normalized title
        const byDoi = paper.doi ? s2Map.get(paper.doi.toLowerCase()) : undefined;
        const titleKey = paper.title
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fff]/g, "")
          .slice(0, 80);
        const s2 = byDoi || (titleKey.length >= 20 ? s2Map.get(titleKey) : undefined);

        if (s2) {
          // Fill missing fields from S2
          if (s2.abstract && s2.abstract.length > (paper.abstract?.length ?? 0)) {
            paper.abstract = s2.abstract;
          }
          if (!paper.doi && s2.doi) paper.doi = s2.doi;
          if (!paper.openAccessPdf && s2.openAccessPdf) paper.openAccessPdf = s2.openAccessPdf;
          if (!paper.pdfUrl && s2.pdfUrl) paper.pdfUrl = s2.pdfUrl;
          if (!paper.externalId && s2.externalId) paper.externalId = s2.externalId;
          if (!paper.fieldsOfStudy && s2.fieldsOfStudy) paper.fieldsOfStudy = s2.fieldsOfStudy;
          if (s2.referenceCount > paper.referenceCount) paper.referenceCount = s2.referenceCount;
          if (s2.citationCount > paper.citationCount) paper.citationCount = s2.citationCount;
        }
      }
      console.log(`[aggregator] S2 cross-enrichment complete: ${s2Map.size} matches`);
    } catch (err) {
      console.error("[aggregator] S2 cross-enrichment failed:", (err as Error).message);
    }
  }

  // Step 2: Batch enrich unknown journals + abstract pipeline + Unpaywall — ALL IN PARALLEL
  const unknownVenues = [...new Set(
    enriched.filter((p) => p.venue && !p.journalMeta?.impactFactor).map((p) => p.venue!)
  )];

  // Re-evaluate which papers still need abstracts after S2 enrichment
  const needAbstract = enriched.filter(
    (p) => !p.abstract || p.abstract.includes("…") || p.abstract.includes("...") || p.abstract.length < 150
  );

  const doisNeedingPdf = enriched.filter((p) => p.doi && !p.openAccessPdf).map((p) => p.doi!);

  // Run journal enrichment, abstract enrichment (passes 1-3 parallel), and Unpaywall ALL concurrently
  const [oaMetrics, , unpaywallResults] = await Promise.all([
    // Journal metadata from OpenAlex
    unknownVenues.length > 0
      ? batchEnrichJournals(unknownVenues)
      : Promise.resolve(new Map<string, { impactFactor?: number }>()),

    // Abstract enrichment — passes 1-3 in parallel, then pass 4 sequential
    enrichAbstracts(needAbstract),

    // Unpaywall open access links
    doisNeedingPdf.length > 0
      ? batchFindOpenAccess(doisNeedingPdf.slice(0, 30))
      : Promise.resolve(new Map<string, { isOpenAccess: boolean; oaUrl?: string }>()),
  ]);

  // Apply journal metrics
  for (const paper of enriched) {
    if (paper.venue && oaMetrics.has(paper.venue) && !paper.journalMeta?.impactFactor) {
      const extra = oaMetrics.get(paper.venue)!;
      if (paper.journalMeta) {
        paper.journalMeta.impactFactor = paper.journalMeta.impactFactor ?? extra.impactFactor;
      }
    }
  }

  // Apply Unpaywall results
  for (const paper of enriched) {
    if (paper.doi && unpaywallResults.has(paper.doi)) {
      const oa = unpaywallResults.get(paper.doi)!;
      if (oa.isOpenAccess && oa.oaUrl) {
        paper.openAccessPdf = paper.openAccessPdf ?? oa.oaUrl;
        paper.unpaywallUrl = oa.oaUrl;
      }
    }
  }

  return enriched;
}

/**
 * Abstract enrichment: passes 1-3 run concurrently, pass 4 (Google Scholar) runs after.
 */
async function enrichAbstracts(needAbstract: UnifiedPaper[]): Promise<void> {
  if (needAbstract.length === 0) return;

  const s2ApiKey = getEnv("SEMANTIC_SCHOLAR_API_KEY");

  // Passes 1-3: CrossRef + Semantic Scholar + OpenAlex — ALL IN PARALLEL
  await Promise.all([
    // Pass 1: CrossRef (DOI-based)
    Promise.all(
      needAbstract.filter((p) => p.doi).slice(0, 25).map(async (paper) => {
        try {
          const res = await fetch(
            `https://api.crossref.org/works/${encodeURIComponent(paper.doi!)}`,
            {
              signal: AbortSignal.timeout(5000),
              headers: { "User-Agent": "ScholarFlow/1.0 (mailto:scholarflow@research.app)" },
            }
          );
          if (!res.ok) return;
          const data = await res.json();
          const crAbstract = data.message?.abstract;
          if (crAbstract && crAbstract.length > (paper.abstract?.length ?? 0)) {
            paper.abstract = crAbstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          }
        } catch { /* skip */ }
      })
    ),

    // Pass 2: Semantic Scholar (DOI or title search) — with retry on 429
    Promise.all(
      needAbstract.slice(0, 20).map(async (paper) => {
        try {
          const endpoint = paper.doi
            ? `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(paper.doi)}?fields=abstract,tldr`
            : `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(paper.title.slice(0, 100))}&limit=1&fields=abstract,tldr,title`;
          const headers: HeadersInit = {};
          if (s2ApiKey) headers["x-api-key"] = s2ApiKey;
          const res = await fetchWithRetry(endpoint, { headers }, { maxRetries: 2, baseDelayMs: 1500 });
          if (!res.ok) return;
          const data = await res.json();
          let s2Abstract = data.abstract;
          let s2Tldr = (data.tldr as { text?: string } | undefined)?.text;
          if (!s2Abstract && data.data?.[0]) {
            s2Abstract = data.data[0].abstract;
            s2Tldr = data.data[0].tldr?.text;
          }
          const best = s2Abstract ?? s2Tldr;
          if (best && best.length > (paper.abstract?.length ?? 0)) {
            paper.abstract = best;
          }
        } catch { /* skip */ }
      })
    ),

    // Pass 3: OpenAlex (title search, inverted index)
    Promise.all(
      needAbstract.slice(0, 15).map(async (paper) => {
        try {
          const params = new URLSearchParams({
            search: paper.title.slice(0, 120),
            per_page: "1",
            select: "abstract_inverted_index,title",
          });
          const oaEmail = getEnv("OPENALEX_EMAIL");
          if (oaEmail) params.set("mailto", oaEmail);
          const res = await fetch(`https://api.openalex.org/works?${params}`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) return;
          const data = await res.json();
          const work = data.results?.[0];
          if (!work?.abstract_inverted_index) return;
          const entries: [string, number[]][] = Object.entries(work.abstract_inverted_index);
          const words: string[] = [];
          for (const [word, positions] of entries) {
            for (const pos of positions as number[]) words[pos] = word;
          }
          const oaAbstract = words.join(" ").trim();
          if (oaAbstract.length > (paper.abstract?.length ?? 0)) {
            paper.abstract = oaAbstract;
          }
        } catch { /* skip */ }
      })
    ),

    // Pass 4: Springer direct HTML access (Springer doesn't block server fetch)
    // Other publishers (Elsevier/Wiley/T&F) return 403 — don't waste time on them
    Promise.all(
      needAbstract
        .filter((p) => p.doi && p.doi.startsWith("10.1007/")) // Springer DOIs only
        .slice(0, 8)
        .map(async (paper) => {
          try {
            const res = await fetch(`https://link.springer.com/article/${paper.doi}`, {
              headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", Accept: "text/html" },
              redirect: "follow",
              signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) return;
            const html = await res.text();
            const abstractMatch = html.match(
              /<div[^>]*class="[^"]*(?:abstract|Abstract)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
            ) ?? html.match(
              /<section[^>]*(?:id|class)="[^"]*(?:abstract|Abstract)[^"]*"[^>]*>([\s\S]*?)<\/section>/i
            );
            if (abstractMatch) {
              const extracted = abstractMatch[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
              if (extracted.length > (paper.abstract?.length ?? 0) && extracted.length > 100) {
                paper.abstract = extracted;
              }
            }
          } catch { /* skip */ }
        })
    ),
  ]);

  // Pass 5: Full-text fetcher — last resort for papers STILL missing abstracts
  // Uses 10+ strategies: Europe PMC, PubMed Central, CORE, Unpaywall, arXiv,
  // publisher HTML, institutional proxy, Open Access Button, BASE, etc.
  // Extracts abstract from full text when found.
  const finalNeedAbstract = needAbstract
    .filter((p) => !p.abstract || p.abstract.length < 100)
    .slice(0, 8);

  if (finalNeedAbstract.length > 0) {
    // Run with concurrency limit to avoid overwhelming external services
    const queue = [...finalNeedAbstract];
    const CONCURRENCY = 3;

    async function worker() {
      while (queue.length > 0) {
        const paper = queue.shift();
        if (!paper) break;
        try {
          const result = await fetchFullText({
            doi: paper.doi,
            openAccessPdf: paper.openAccessPdf,
            unpaywallUrl: paper.unpaywallUrl,
            title: paper.title,
          });
          if (result && result.text.length > 100) {
            // Extract first ~1500 chars as abstract (usually the abstract + intro)
            const text = result.text;
            // Try to find abstract section boundary
            const abstractEnd = text.match(/\b(?:introduction|1\.\s|keywords|key\s*words)\b/i);
            const abstractText = abstractEnd
              ? text.slice(0, abstractEnd.index).trim()
              : text.slice(0, 1500).trim();

            if (abstractText.length > (paper.abstract?.length ?? 0)) {
              paper.abstract = abstractText.slice(0, 2000);
              paper.openAccessPdf = paper.openAccessPdf ?? (paper.doi ? `https://doi.org/${paper.doi}` : undefined);
            }
          }
        } catch { /* skip */ }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, finalNeedAbstract.length) }, () => worker()));
  }
}

/**
 * Full pipeline: search + enrich. Used by direct API calls (/api/papers/search).
 */
export async function searchAllSources(
  options: SearchOptions
): Promise<{ papers: UnifiedPaper[]; results: SearchResult[] }> {
  const { papers: raw, results } = await searchAllSourcesRaw(options);
  const enriched = await enrichPapersBatch(raw);
  return { papers: enriched, results };
}

function enrichPapers(papers: UnifiedPaper[]): UnifiedPaper[] {
  return papers.map((paper) => {
    const ranking = getJournalRanking(paper.venue);
    const journalMeta = getJournalMetadata(paper.venue);

    // Build badges — UTD24/FT50 first, then classification badges
    const badges: string[] = [];
    if (ranking.utd24) badges.push("UTD24");
    if (ranking.ft50) badges.push("FT50");
    if (journalMeta.absRating) badges.push(`ABS ${journalMeta.absRating}`);
    if (journalMeta.ssci) badges.push("SSCI");
    if (journalMeta.sci) badges.push("SCI");
    if (journalMeta.cssci) badges.push("CSSCI");
    if (journalMeta.pkuCore && !journalMeta.cssci) badges.push("北大核心");
    if (journalMeta.jcrQuartile) badges.push(`JCR ${journalMeta.jcrQuartile}`);
    if (journalMeta.sjrQuartile) badges.push(`SJR ${journalMeta.sjrQuartile}`);
    if (journalMeta.abdcRating) badges.push(`ABDC ${journalMeta.abdcRating}`);
    if (journalMeta.ccfRating) badges.push(`CCF ${journalMeta.ccfRating}`);
    if (journalMeta.casZone) badges.push(`中科院${journalMeta.casZone}`);
    if (journalMeta.fms) badges.push("FMS");
    if (journalMeta.conference) {
      badges.push(`${journalMeta.conference.tier}会议`);
    }
    // arXiv preprint detection
    if (paper.venue?.toLowerCase().startsWith("arxiv")) {
      badges.push("arXiv");
    }

    return {
      ...paper,
      journalRanking: { ...ranking, badges },
      journalMeta,
      connectedPapersUrl: paper.doi
        ? `https://www.connectedpapers.com/api/redirect/doi/${encodeURIComponent(paper.doi)}`
        : paper.title
          ? `https://www.connectedpapers.com/search?q=${encodeURIComponent(paper.title)}`
          : undefined,
    };
  });
}

function searchBySource(
  source: UnifiedPaper["source"],
  options: SearchOptions
): Promise<SearchResult> {
  switch (source) {
    case "semantic_scholar":
      return searchSemanticScholar(options);
    case "openalex":
      return searchOpenAlex(options);
    case "google_scholar":
      return searchGoogleScholar(options);
    default:
      return Promise.resolve({ papers: [], total: 0, source });
  }
}

function deduplicatePapers(papers: UnifiedPaper[]): UnifiedPaper[] {
  const seen = new Map<string, UnifiedPaper>();

  for (const paper of papers) {
    const key = getDeduplicationKey(paper);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, paper);
    } else {
      seen.set(key, mergePapers(existing, paper));
    }
  }

  return Array.from(seen.values());
}

function getDeduplicationKey(paper: UnifiedPaper): string {
  // Always generate a title key as primary dedup — DOI is supplementary
  // This fixes cases where same paper from different sources has DOI in one but not the other
  const titleKey = normalizeTitle(paper.title);
  if (titleKey.length >= 20) return `title:${titleKey}`;
  if (paper.doi) return `doi:${paper.doi.toLowerCase()}`;
  return `title:${titleKey}`;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/<[^>]+>/g, "") // strip HTML tags like <i>
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "")
    .slice(0, 80);
}

function mergePapers(a: UnifiedPaper, b: UnifiedPaper): UnifiedPaper {
  // Always keep the LONGEST abstract (S2/OpenAlex have full abstracts, GS only has snippets)
  const bestAbstract = (a.abstract?.length ?? 0) >= (b.abstract?.length ?? 0) ? a.abstract : b.abstract;
  return {
    ...a,
    abstract: bestAbstract ?? a.abstract ?? b.abstract,
    doi: a.doi ?? b.doi,
    year: a.year ?? b.year,
    venue: a.venue ?? b.venue,
    citationCount: Math.max(a.citationCount, b.citationCount),
    referenceCount: Math.max(a.referenceCount, b.referenceCount),
    openAccessPdf: a.openAccessPdf ?? b.openAccessPdf,
    pdfUrl: a.pdfUrl ?? b.pdfUrl,
    fieldsOfStudy: a.fieldsOfStudy ?? b.fieldsOfStudy,
  };
}
