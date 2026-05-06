/**
 * PubMed E-utilities API — biomedical literature search.
 *
 * Free, no key needed for <3 req/s. Optional NCBI_API_KEY for 10 req/s.
 * Flow: esearch (get PMIDs) → efetch (get full metadata as XML).
 */
import type { UnifiedPaper, SearchOptions, SearchResult } from "./types";
import { proxyFetch } from "@/lib/ai/proxy-fetch";
import { getEnv } from "@/lib/env";

const ESEARCH_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const EFETCH_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

export async function searchPubMed(
  options: SearchOptions
): Promise<SearchResult> {
  const { query, limit = 20, yearFrom, yearTo } = options;
  const safeLimit = Math.min(limit, 50);

  try {
    // Step 1: esearch to get PMIDs
    const searchParams = new URLSearchParams({
      db: "pubmed",
      term: query,
      retmax: String(safeLimit),
      retmode: "json",
      sort: "relevance",
      tool: "scholarflow",
      email: "scholarflow@research.app",
    });

    if (yearFrom) searchParams.set("mindate", `${yearFrom}/01/01`);
    if (yearTo) searchParams.set("maxdate", `${yearTo}/12/31`);
    if (yearFrom || yearTo) searchParams.set("datetype", "pdat");

    const apiKey = getEnv("NCBI_API_KEY");
    if (apiKey) searchParams.set("api_key", apiKey);

    console.log(`[pubmed] Searching: ${query.slice(0, 80)}...`);

    const searchRes = await proxyFetch(`${ESEARCH_BASE}?${searchParams}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!searchRes.ok) {
      console.error(`[pubmed] esearch error: ${searchRes.status}`);
      return { papers: [], total: 0, source: "openalex" };
    }

    const searchData = await searchRes.json();
    const pmids: string[] = searchData.esearchresult?.idlist ?? [];
    const total = parseInt(searchData.esearchresult?.count ?? "0", 10);

    if (pmids.length === 0) {
      console.log("[pubmed] No results found");
      return { papers: [], total: 0, source: "openalex" };
    }

    // Step 2: efetch to get full metadata
    const fetchParams = new URLSearchParams({
      db: "pubmed",
      id: pmids.join(","),
      rettype: "xml",
      retmode: "xml",
      tool: "scholarflow",
      email: "scholarflow@research.app",
    });
    if (apiKey) fetchParams.set("api_key", apiKey);

    const fetchRes = await proxyFetch(`${EFETCH_BASE}?${fetchParams}`, {
      signal: AbortSignal.timeout(6000),
    });

    if (!fetchRes.ok) {
      console.error(`[pubmed] efetch error: ${fetchRes.status}`);
      return { papers: [], total: 0, source: "openalex" };
    }

    const xml = await fetchRes.text();
    const papers = parsePubMedXml(xml);

    console.log(`[pubmed] Found ${papers.length} papers`);

    return { papers, total, source: "openalex" };
  } catch (err) {
    console.error("[pubmed] search failed:", (err as Error).message);
    return { papers: [], total: 0, source: "openalex" };
  }
}

function parsePubMedXml(xml: string): UnifiedPaper[] {
  const papers: UnifiedPaper[] = [];

  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;

  while ((match = articleRegex.exec(xml)) !== null) {
    const article = match[1];

    const title = extractTag(article, "ArticleTitle")?.replace(/<[^>]+>/g, "").trim();
    if (!title) continue;

    const abstract = extractTag(article, "AbstractText")?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    // Year
    const pubDateBlock = extractTag(article, "PubDate");
    const yearStr = pubDateBlock ? extractTag(pubDateBlock, "Year") : undefined;
    const year = yearStr ? parseInt(yearStr, 10) : undefined;

    // Journal
    const journalBlock = extractTag(article, "Journal");
    const venue = journalBlock ? extractTag(journalBlock, "Title") : undefined;

    // Authors
    const authors: { name: string }[] = [];
    const authorRegex = /<Author[^>]*>([\s\S]*?)<\/Author>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(article)) !== null) {
      const authorXml = authorMatch[1];
      const lastName = extractTag(authorXml, "LastName");
      const foreName = extractTag(authorXml, "ForeName");
      if (lastName) {
        authors.push({ name: foreName ? `${foreName} ${lastName}` : lastName });
      }
    }

    // IDs: DOI and PMID
    let doi: string | undefined;
    let pmid: string | undefined;
    let pmcId: string | undefined;

    const idRegex = /<ArticleId\s+IdType="([^"]+)">([^<]+)<\/ArticleId>/g;
    let idMatch;
    while ((idMatch = idRegex.exec(article)) !== null) {
      const idType = idMatch[1];
      const idValue = idMatch[2].trim();
      if (idType === "doi") doi = idValue;
      else if (idType === "pubmed") pmid = idValue;
      else if (idType === "pmc") pmcId = idValue;
    }

    // If no PMID from ArticleId, try PMID tag
    if (!pmid) {
      const pmidTag = article.match(/<PMID[^>]*>(\d+)<\/PMID>/);
      if (pmidTag) pmid = pmidTag[1];
    }

    // Open access PDF link
    const openAccessPdf = pmcId
      ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcId}/`
      : undefined;

    papers.push({
      title,
      abstract,
      authors,
      year: year && year > 1800 && year <= new Date().getFullYear() + 1 ? year : undefined,
      venue,
      citationCount: 0,
      referenceCount: 0,
      doi,
      externalId: pmid,
      source: "openalex",
      pdfUrl: openAccessPdf,
      openAccessPdf,
    });
  }

  return papers;
}

function extractTag(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match?.[1];
}
