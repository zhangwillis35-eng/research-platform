/**
 * Full-text fetcher — aggressively attempts to retrieve full text.
 *
 * Strategy chain (tries ALL until one succeeds):
 * 1. Europe PMC (free full text for biomedical + many Science/Nature papers)
 * 2. PubMed Central (NIH mandate = many top papers available)
 * 3. Semantic Scholar (TLDR + abstract + open access PDF)
 * 4. CORE.ac.uk (200M+ OA papers)
 * 5. Unpaywall all OA locations (green/bronze/gold)
 * 6. arXiv HTML (for preprints)
 * 7. Publisher HTML scrape (DOI redirect)
 * 8. Google Scholar cached version
 */
import { proxyFetch } from "@/lib/ai/proxy-fetch";

export interface FullTextResult {
  text: string;
  source: "europepmc" | "pmc" | "semantic_scholar" | "core" | "unpaywall" | "html_scrape" | "arxiv" | "cached";
  truncated: boolean;
  wordCount: number;
}

const MAX_TEXT_LENGTH = 20000; // 20K chars for deeper AI analysis

/**
 * Attempt to fetch full text for a paper.
 * Tries EVERY strategy until one succeeds.
 */
export async function fetchFullText(paper: {
  doi?: string;
  openAccessPdf?: string;
  unpaywallUrl?: string;
  title: string;
}, options?: { usePlaywright?: boolean }): Promise<FullTextResult | null> {
  const strategies: Array<() => Promise<FullTextResult | null>> = [];

  if (paper.doi) {
    // Top priority: Europe PMC (has full text for Science, Nature, Lancet, etc.)
    strategies.push(() => tryEuropePMC(paper.doi!));
    // PubMed Central
    strategies.push(() => tryPMC(paper.doi!));
    // Semantic Scholar (TLDR + abstract + check for OA PDF)
    strategies.push(() => trySemanticScholar(paper.doi!));
    // CORE.ac.uk
    strategies.push(() => tryCORE(paper.doi!));
    // Unpaywall — try ALL OA locations (not just best)
    strategies.push(() => tryUnpaywallAllLocations(paper.doi!));
  }

  // Open access PDF direct
  if (paper.openAccessPdf || paper.unpaywallUrl) {
    const url = paper.openAccessPdf || paper.unpaywallUrl!;
    strategies.push(() => tryHtmlVersion(url));
  }

  // Publisher HTML via DOI
  if (paper.doi) {
    strategies.push(() => tryPublisherHtml(paper.doi!));
  }

  // Institutional proxy (EZproxy) — works when user is on VPN
  if (paper.doi) {
    strategies.push(() => tryInstitutionalProxy(paper.doi!));
  }

  // Open Access Button — finds free versions via institutional repos
  if (paper.doi) {
    strategies.push(() => tryOpenAccessButton(paper.doi!));
  }

  // BASE (Bielefeld Academic Search Engine) — no key needed
  if (paper.doi) {
    strategies.push(() => tryBASE(paper.doi!));
  }

  // Google Scholar cache — often has full text snippets
  if (paper.title.length > 10) {
    strategies.push(() => tryGoogleScholarCache(paper.title));
  }

  // Title-based search on Europe PMC
  if (paper.title.length > 10) {
    strategies.push(() => tryEuropePMCByTitle(paper.title));
  }

  // Crossref abstract as last resort
  if (paper.doi) {
    strategies.push(() => tryCrossrefAbstract(paper.doi!));
  }

  // Playwright (headless browser) — optional, last resort for paywalled papers
  if (options?.usePlaywright && paper.doi) {
    strategies.push(async () => {
      try {
        const { fetchWithPlaywright } = await import("./playwright-fetcher");
        const result = await fetchWithPlaywright(paper.doi!);
        if (!result) return null;
        return {
          text: result.text,
          source: "html_scrape" as const,
          truncated: result.truncated,
          wordCount: result.wordCount,
        };
      } catch {
        return null;
      }
    });
  }

  // Try each strategy with per-strategy timeout (5s) and total timeout (15s)
  const totalDeadline = Date.now() + 15000; // 15s max per paper
  const STRATEGY_TIMEOUT = 5000; // 5s max per strategy

  for (const strategy of strategies) {
    if (Date.now() >= totalDeadline) {
      console.log(`[fulltext] Total timeout reached for: ${paper.title.slice(0, 50)}`);
      break;
    }

    try {
      const result = await Promise.race([
        strategy(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), STRATEGY_TIMEOUT)),
      ]);
      if (result && result.text.length > 200) return result;
    } catch {
      // Continue to next strategy
    }
  }

  return null;
}

// ─── Europe PMC (BEST for top journals) ────────

async function tryEuropePMC(doi: string): Promise<FullTextResult | null> {
  try {
    // Step 1: Find the paper
    const searchRes = await proxyFetch(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:${encodeURIComponent(doi)}&format=json&resultType=core`,
      { headers: { Accept: "application/json" } }
    );
    if (!searchRes.ok) return null;
    const searchData = (await searchRes.json()) as {
      resultList?: { result?: Array<{ id?: string; source?: string; pmcid?: string; abstractText?: string }> };
    };

    const paper = searchData.resultList?.result?.[0];
    if (!paper) return null;

    // Step 2: Try to get full text XML
    if (paper.pmcid) {
      const ftRes = await proxyFetch(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/${paper.pmcid}/fullTextXML`,
      );
      if (ftRes.ok) {
        const xml = await ftRes.text();
        const text = extractTextFromXml(xml);
        if (text && text.length > 500) {
          return makeResult(text, "europepmc");
        }
      }
    }

    // Step 3: Fallback to abstract
    if (paper.abstractText && paper.abstractText.length > 100) {
      return makeResult(paper.abstractText, "europepmc");
    }

    return null;
  } catch {
    return null;
  }
}

async function tryEuropePMCByTitle(title: string): Promise<FullTextResult | null> {
  try {
    const query = encodeURIComponent(`TITLE:"${title.slice(0, 100)}"`);
    const res = await proxyFetch(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${query}&format=json&resultType=core&pageSize=1`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      resultList?: { result?: Array<{ pmcid?: string; abstractText?: string }> };
    };
    const paper = data.resultList?.result?.[0];
    if (!paper?.pmcid) {
      if (paper?.abstractText && paper.abstractText.length > 100) {
        return makeResult(paper.abstractText, "europepmc");
      }
      return null;
    }

    const ftRes = await proxyFetch(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/${paper.pmcid}/fullTextXML`,
    );
    if (!ftRes.ok) return null;
    const xml = await ftRes.text();
    const text = extractTextFromXml(xml);
    if (text && text.length > 500) return makeResult(text, "europepmc");
    return null;
  } catch {
    return null;
  }
}

// ─── PubMed Central ────────────────────────────

async function tryPMC(doi: string): Promise<FullTextResult | null> {
  try {
    // Convert DOI to PMCID
    const idRes = await proxyFetch(
      `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${encodeURIComponent(doi)}&format=json`,
    );
    if (!idRes.ok) return null;
    const idData = (await idRes.json()) as {
      records?: Array<{ pmcid?: string }>;
    };
    const pmcid = idData.records?.[0]?.pmcid;
    if (!pmcid) return null;

    // Fetch full text from PMC OA service
    const ftRes = await proxyFetch(
      `https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json/${pmcid}/unicode`,
    );
    if (!ftRes.ok) return null;

    const ftData = (await ftRes.json()) as {
      documents?: Array<{
        passages?: Array<{ text?: string; infons?: { type?: string } }>;
      }>;
    };

    const passages = ftData.documents?.[0]?.passages ?? [];
    const text = passages
      .filter((p) => p.text && (p.infons?.type === "paragraph" || p.infons?.type === "abstract" || p.infons?.type === "title"))
      .map((p) => p.text)
      .join("\n\n");

    if (text.length > 500) return makeResult(text, "pmc");
    return null;
  } catch {
    return null;
  }
}

// ─── Semantic Scholar ──────────────────────────

async function trySemanticScholar(doi: string): Promise<FullTextResult | null> {
  try {
    const res = await proxyFetch(
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=tldr,abstract,openAccessPdf`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      abstract?: string;
      tldr?: { text?: string };
      openAccessPdf?: { url?: string };
    };

    const parts: string[] = [];
    if (data.abstract) parts.push(data.abstract);
    if (data.tldr?.text) parts.push(`TL;DR: ${data.tldr.text}`);

    // If S2 has an OA PDF link we haven't tried, fetch it
    if (data.openAccessPdf?.url && parts.join("").length < 1000) {
      const htmlResult = await tryHtmlVersion(data.openAccessPdf.url);
      if (htmlResult) return htmlResult;
    }

    if (parts.length === 0) return null;
    return makeResult(parts.join("\n\n"), "semantic_scholar");
  } catch {
    return null;
  }
}

// ─── CORE.ac.uk ────────────────────────────────

async function tryCORE(doi: string): Promise<FullTextResult | null> {
  try {
    const { getCOREFullTextByDOI } = await import("@/lib/sources/core");
    const result = await getCOREFullTextByDOI(doi);
    if (!result?.fullText || result.fullText.length < 200) return null;
    return makeResult(result.fullText, "core");
  } catch {
    return null;
  }
}

// ─── Unpaywall — try ALL OA locations ──────────

async function tryUnpaywallAllLocations(doi: string): Promise<FullTextResult | null> {
  try {
    const res = await proxyFetch(
      `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=scholarflow@research.app`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      oa_locations?: Array<{
        url?: string;
        url_for_landing_page?: string;
        url_for_pdf?: string;
        host_type?: string;
        version?: string;
      }>;
    };

    const locations = data.oa_locations ?? [];
    // Try each location — repositories first (more likely to have full HTML), then publisher
    const sorted = [...locations].sort((a, b) => {
      if (a.host_type === "repository" && b.host_type !== "repository") return -1;
      if (b.host_type === "repository" && a.host_type !== "repository") return 1;
      return 0;
    });

    for (const loc of sorted.slice(0, 4)) {
      const url = loc.url_for_landing_page || loc.url || loc.url_for_pdf;
      if (!url) continue;
      const result = await tryHtmlVersion(url);
      if (result) {
        result.source = "unpaywall";
        return result;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── HTML version extraction ───────────────────

async function tryHtmlVersion(url: string): Promise<FullTextResult | null> {
  try {
    let htmlUrl = url;
    if (url.includes("arxiv.org/pdf/")) {
      htmlUrl = url.replace("/pdf/", "/html/"); // arXiv now has HTML versions
    } else if (url.includes("ncbi.nlm.nih.gov") && url.endsWith(".pdf")) {
      htmlUrl = url.replace(".pdf", "");
    }

    const res = await proxyFetch(htmlUrl, {
      headers: {
        "User-Agent": "ScholarFlow/1.0 (Academic Research Tool; mailto:scholarflow@research.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("xhtml")) return null;

    const html = await res.text();
    const text = extractTextFromHtml(html);
    if (!text || text.length < 200) return null;

    const source = url.includes("arxiv") ? "arxiv" as const : "html_scrape" as const;
    return makeResult(text, source);
  } catch {
    return null;
  }
}

// ─── Publisher HTML via DOI ────────────────────

async function tryPublisherHtml(doi: string): Promise<FullTextResult | null> {
  try {
    const res = await proxyFetch(`https://doi.org/${doi}`, {
      headers: {
        "User-Agent": "ScholarFlow/1.0 (Academic Research Tool; mailto:scholarflow@research.app)",
        Accept: "text/html",
      },
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    const html = await res.text();
    const text = extractTextFromHtml(html);
    if (!text || text.length < 300) return null;

    return makeResult(text, "html_scrape");
  } catch {
    return null;
  }
}

// ─── Institutional EZproxy ─────────────────────

/**
 * Institutional access via campus network IP authentication.
 *
 * Most Chinese universities (清华/北大/复旦/交大/中大等) use IP-based auth:
 * - On campus network → publisher recognizes IP → grants full access
 * - Off campus → need VPN first, then same IP-based auth
 *
 * Key requirement: the request must NOT go through a foreign proxy.
 * VeloceMan/Clash rules must set publisher domains to DIRECT.
 */
async function tryInstitutionalProxy(doi: string): Promise<FullTextResult | null> {
  try {
    const enabled = process.env.EZPROXY_ENABLED === "true";
    if (!enabled) return null;

    // Direct DOI resolution — if on campus/VPN, publisher will grant access via IP
    const url = `https://doi.org/${doi}`;
    console.log(`[institutional] Trying direct access: ${url}`);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
        Accept: "text/html,application/xhtml+xml,application/xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      console.log(`[institutional] HTTP ${res.status} — might not have campus IP access`);
      return null;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("xhtml")) return null;

    const html = await res.text();

    // Check if we got a paywall / login page
    if (
      html.includes("Access through your institution") ||
      html.includes("Buy this article") ||
      html.includes("Sign in to access") ||
      (html.includes("login") && html.includes("password") && html.length < 10000)
    ) {
      console.log("[institutional] Paywall detected — not on campus network or VPN");
      return null;
    }

    const text = extractTextFromHtml(html);
    if (!text || text.length < 500) return null;

    console.log(`[institutional] Got content: ${text.length} chars`);
    return makeResult(text, "html_scrape");
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!msg.includes("ECONNREFUSED") && !msg.includes("ENOTFOUND") && !msg.includes("timeout")) {
      console.log(`[institutional] Error: ${msg.slice(0, 80)}`);
    }
    return null;
  }
}

// ─── Open Access Button ────────────────────────

async function tryOpenAccessButton(doi: string): Promise<FullTextResult | null> {
  try {
    const res = await proxyFetch(
      `https://api.openaccessbutton.org/find?id=${encodeURIComponent(doi)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string; source?: string };
    if (!data.url) return null;

    // Try to fetch the found URL
    const htmlResult = await tryHtmlVersion(data.url);
    if (htmlResult) {
      htmlResult.source = "html_scrape";
      return htmlResult;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── BASE (Bielefeld Academic Search Engine) ────

async function tryBASE(doi: string): Promise<FullTextResult | null> {
  try {
    const res = await proxyFetch(
      `https://api.base-search.net/cgi-bin/BaseHttpSearchInterface.fcgi?func=PerformSearch&query=doi:${encodeURIComponent(doi)}&format=json&hits=1`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      response?: { docs?: Array<{ dclink?: string; dcdescription?: string }> };
    };

    const doc = data.response?.docs?.[0];
    if (!doc) return null;

    // Try the repository link
    if (doc.dclink) {
      const htmlResult = await tryHtmlVersion(doc.dclink);
      if (htmlResult) return htmlResult;
    }

    // Use the description (abstract) if available
    if (doc.dcdescription && doc.dcdescription.length > 200) {
      return makeResult(doc.dcdescription, "html_scrape");
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Google Scholar cache ──────────────────────

async function tryGoogleScholarCache(title: string): Promise<FullTextResult | null> {
  try {
    // Use SerpAPI to get Google Scholar cached/related versions
    const { getEnv } = await import("@/lib/env");
    const serpKey = getEnv("SERPAPI_KEY");
    if (!serpKey) return null;

    const params = new URLSearchParams({
      engine: "google_scholar",
      q: `"${title.slice(0, 100)}"`,
      api_key: serpKey,
      num: "1",
    });

    const res = await proxyFetch(`https://serpapi.com/search.json?${params}`);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      organic_results?: Array<{
        snippet?: string;
        link?: string;
        resources?: Array<{ link?: string; file_format?: string }>;
      }>;
    };

    const result = data.organic_results?.[0];
    if (!result) return null;

    // Try to fetch the linked page for more content
    if (result.link) {
      const htmlResult = await tryHtmlVersion(result.link);
      if (htmlResult && htmlResult.text.length > 500) return htmlResult;
    }

    // Try PDF resources
    const pdfResource = result.resources?.find((r) => r.file_format === "PDF" || r.link?.endsWith(".pdf"));
    if (pdfResource?.link) {
      const htmlResult = await tryHtmlVersion(pdfResource.link);
      if (htmlResult) return htmlResult;
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Crossref abstract ─────────────────────────

async function tryCrossrefAbstract(doi: string): Promise<FullTextResult | null> {
  try {
    const res = await proxyFetch(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      {
        headers: {
          "User-Agent": "ScholarFlow/1.0 (mailto:scholarflow@research.app)",
        },
      }
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      message?: { abstract?: string };
    };

    const abstract = data.message?.abstract;
    if (!abstract || abstract.length < 100) return null;

    // Crossref abstracts often have JATS XML tags
    const cleaned = abstract
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return makeResult(cleaned, "html_scrape");
  } catch {
    return null;
  }
}

// ─── XML full text extraction (PMC/Europe PMC) ──

function extractTextFromXml(xml: string): string {
  // Remove XML tags but keep text content
  // Target: <body> section which has the actual paper content
  const bodyMatch = xml.match(/<body[\s\S]*?>([\s\S]*?)<\/body>/i);
  const content = bodyMatch ? bodyMatch[1] : xml;

  return content
    .replace(/<xref[^>]*>[^<]*<\/xref>/gi, "") // remove references like [1]
    .replace(/<table-wrap[\s\S]*?<\/table-wrap>/gi, "") // remove tables
    .replace(/<fig[\s\S]*?<\/fig>/gi, "") // remove figures
    .replace(/<supplementary-material[\s\S]*?<\/supplementary-material>/gi, "")
    .replace(/<\/?(?:sec|p|title|abstract)[^>]*>/gi, "\n") // convert sections to newlines
    .replace(/<[^>]+>/g, " ") // strip remaining tags
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

// ─── HTML text extraction (improved) ───────────

function extractTextFromHtml(html: string): string {
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")
    .replace(/<table[\s\S]*?<\/table>/gi, "");

  // Try academic-specific selectors
  const selectors = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*class="[^"]*(?:article-body|paper-body|fulltext|main-content|content-inner|article__body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id="[^"]*(?:article-body|full-text|main-text|body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*class="[^"]*(?:article|body|content)[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
  ];

  for (const selector of selectors) {
    const match = cleaned.match(selector);
    if (match && match[1].length > 500) {
      cleaned = match[1];
      break;
    }
  }

  const text = cleaned
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

// ─── Helpers ───────────────────────────────────

function makeResult(text: string, source: FullTextResult["source"]): FullTextResult {
  const truncated = text.length > MAX_TEXT_LENGTH;
  const finalText = text.slice(0, MAX_TEXT_LENGTH);
  return {
    text: finalText,
    source,
    truncated,
    wordCount: finalText.split(/\s+/).length,
  };
}

/**
 * Batch fetch full text for multiple papers.
 */
export async function batchFetchFullText(
  papers: Array<{
    doi?: string;
    openAccessPdf?: string;
    unpaywallUrl?: string;
    title: string;
  }>,
  maxConcurrent: number = 4
): Promise<Map<string, FullTextResult>> {
  const results = new Map<string, FullTextResult>();
  const queue = [...papers];

  async function worker() {
    while (queue.length > 0) {
      const paper = queue.shift();
      if (!paper) break;
      const key = paper.doi || paper.title;
      const result = await fetchFullText(paper);
      if (result) {
        results.set(key, result);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrent, papers.length) },
    () => worker()
  );
  await Promise.all(workers);

  return results;
}
