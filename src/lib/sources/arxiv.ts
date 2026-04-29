/**
 * arXiv API client — search preprints.
 *
 * arXiv API is free, no key needed, rate limit ~3 req/s.
 * Returns Atom XML, we parse it to UnifiedPaper.
 */
import type { UnifiedPaper, SearchOptions, SearchResult } from "./types";
import { proxyFetch } from "@/lib/ai/proxy-fetch";

const ARXIV_BASE = "https://export.arxiv.org/api/query";

export async function searchArxiv(
  options: SearchOptions
): Promise<SearchResult> {
  const { query, limit = 10 } = options;

  // Build arXiv search query
  // Strip quotes, OR operators, and other boolean syntax that arXiv doesn't understand
  const cleanQuery = query
    .replace(/["']/g, "")
    .replace(/\bOR\b/gi, " ")
    .replace(/\bAND\b/gi, " ")
    .trim();
  const words = cleanQuery.split(/\s+/).filter((w) => w.length >= 2);
  // Use max 4 keywords to avoid overly specific queries
  const topWords = words.slice(0, 4);
  const searchQuery = topWords.length > 1
    ? topWords.map((w) => `all:${w}`).join("+AND+")
    : `all:${topWords[0] || query}`;

  const url = `${ARXIV_BASE}?search_query=${searchQuery}&start=0&max_results=${Math.min(limit, 30)}&sortBy=relevance&sortOrder=descending`;

  console.log(`[arxiv] Searching: ${url.slice(0, 120)}...`);

  try {
    const res = await proxyFetch(url, {
      headers: {
        "User-Agent": "ScholarFlow/1.0 (Academic Research Tool)",
      },
    });

    if (!res.ok) {
      console.error(`[arxiv] API error: ${res.status}`);
      return { papers: [], total: 0, source: "openalex" }; // use openalex as fallback source type
    }

    const xml = await res.text();
    const papers = parseArxivXml(xml);
    console.log(`[arxiv] Found ${papers.length} preprints`);

    return {
      papers,
      total: papers.length,
      source: "openalex",
    };
  } catch (err) {
    console.error("[arxiv] search failed:", (err as Error).message);
    return { papers: [], total: 0, source: "openalex" };
  }
}

/**
 * Parse arXiv Atom XML response into UnifiedPaper array.
 */
function parseArxivXml(xml: string): UnifiedPaper[] {
  const papers: UnifiedPaper[] = [];

  // Extract <entry> blocks
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];

    const title = extractTag(entry, "title")?.replace(/\s+/g, " ").trim();
    if (!title) continue;

    const abstract = extractTag(entry, "summary")?.replace(/\s+/g, " ").trim();
    const published = extractTag(entry, "published"); // 2024-01-15T00:00:00Z
    const year = published ? parseInt(published.slice(0, 4)) : undefined;

    // Extract arXiv ID from <id> tag
    const idUrl = extractTag(entry, "id"); // http://arxiv.org/abs/2401.12345v1
    const arxivId = idUrl?.match(/abs\/(.+?)(?:v\d+)?$/)?.[1];

    // Extract DOI if present
    const doi = extractTagAttr(entry, "arxiv:doi");

    // Extract authors
    const authors: { name: string }[] = [];
    const authorRegex = /<author>\s*<name>([^<]+)<\/name>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(entry)) !== null) {
      authors.push({ name: authorMatch[1].trim() });
    }

    // Extract categories
    const categories: string[] = [];
    const catRegex = /term="([^"]+)"/g;
    let catMatch;
    while ((catMatch = catRegex.exec(entry)) !== null) {
      if (catMatch[1].includes(".")) { // arXiv categories have dots (cs.AI, q-fin.GN)
        categories.push(catMatch[1]);
      }
    }

    // PDF link
    const pdfLink = arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined;

    papers.push({
      title,
      abstract,
      authors,
      year,
      venue: `arXiv:${arxivId ?? "preprint"}`,
      citationCount: 0, // arXiv doesn't provide citation counts
      referenceCount: 0,
      doi: doi || undefined,
      externalId: arxivId,
      source: "openalex", // reuse for type compatibility
      pdfUrl: pdfLink,
      openAccessPdf: pdfLink,
      fieldsOfStudy: categories.length > 0 ? categories : undefined,
    });
  }

  return papers;
}

function extractTag(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match?.[1];
}

function extractTagAttr(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match?.[1]?.trim() || undefined;
}
