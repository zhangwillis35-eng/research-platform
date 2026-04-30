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
  // ── Fast path: if we have a direct OA PDF link, try it first ──
  if (paper.openAccessPdf) {
    try {
      const result = await Promise.race([
        tryHtmlVersion(paper.openAccessPdf),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (result && result.text.length > 500) return result;
    } catch { /* continue */ }
  }

  // ── Tier 1: Race top 3 fastest strategies in parallel ──
  // First one to return valid text wins — no waiting for others
  const tier1: Array<() => Promise<FullTextResult | null>> = [];
  if (paper.doi) {
    tier1.push(() => tryEuropePMC(paper.doi!));
    tier1.push(() => trySemanticScholar(paper.doi!));
    tier1.push(() => tryCORE(paper.doi!));
  }

  if (tier1.length > 0) {
    try {
      const result = await raceForFirst(tier1, 6000);
      if (result) return result;
    } catch { /* continue */ }
  }

  // ── Tier 2: Race next batch (includes new sources) ──
  const tier2: Array<() => Promise<FullTextResult | null>> = [];
  if (paper.doi) {
    tier2.push(() => tryPMC(paper.doi!));
    tier2.push(() => tryUnpaywallAllLocations(paper.doi!));
    tier2.push(() => tryCrossrefTDM(paper.doi!)); // Publisher-authorized TDM links
    tier2.push(() => trySpringerOA(paper.doi!));   // Springer Nature OA XML
    tier2.push(() => tryOpenAlexOA(paper.doi!));   // Multiple OA locations
  }
  if (paper.unpaywallUrl) {
    tier2.push(() => tryHtmlVersion(paper.unpaywallUrl!));
  }

  if (tier2.length > 0) {
    try {
      const result = await raceForFirst(tier2, 6000);
      if (result) return result;
    } catch { /* continue */ }
  }

  // ── Tier 3: Slower fallbacks (sequential, short timeouts) ──
  const tier3: Array<() => Promise<FullTextResult | null>> = [];
  if (paper.doi) {
    tier3.push(() => tryPublisherHtml(paper.doi!));
    tier3.push(() => tryGrobid(paper));
    tier3.push(() => tryOpenAccessButton(paper.doi!));
  }
  if (paper.title.length > 10) {
    tier3.push(() => tryEuropePMCByTitle(paper.title));
  }

  for (const strategy of tier3) {
    try {
      const result = await Promise.race([
        strategy(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (result && result.text.length > 200) return result;
    } catch { /* continue */ }
  }

  return null;
}

/**
 * Race multiple strategies in parallel — first valid result wins.
 * All other promises are abandoned (not awaited) once we have a winner.
 */
async function raceForFirst(
  strategies: Array<() => Promise<FullTextResult | null>>,
  timeoutMs: number
): Promise<FullTextResult | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, timeoutMs);

    let pending = strategies.length;
    for (const strategy of strategies) {
      strategy()
        .then((result) => {
          if (!resolved && result && result.text.length > 200) {
            resolved = true;
            clearTimeout(timer);
            resolve(result);
          } else {
            pending--;
            if (!resolved && pending === 0) { resolved = true; clearTimeout(timer); resolve(null); }
          }
        })
        .catch(() => {
          pending--;
          if (!resolved && pending === 0) { resolved = true; clearTimeout(timer); resolve(null); }
        });
    }
  });
}

// ─── GROBID (ML-based structured PDF parsing) ────

async function tryGrobid(paper: { doi?: string; openAccessPdf?: string; title: string }): Promise<FullTextResult | null> {
  try {
    const { isGrobidAvailable, parseWithGrobid } = await import("@/lib/sources/grobid");
    if (!(await isGrobidAvailable())) return null;

    const pdfUrl = paper.openAccessPdf || (paper.doi ? `https://doi.org/${paper.doi}` : null);
    if (!pdfUrl) return null;

    const result = await parseWithGrobid(pdfUrl);
    if (!result || result.fullText.length < 500) return null;

    return {
      text: result.fullText.slice(0, MAX_TEXT_LENGTH),
      source: "html_scrape" as const,
      truncated: result.fullText.length > MAX_TEXT_LENGTH,
      wordCount: result.wordCount,
    };
  } catch {
    return null;
  }
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

// ─── CrossRef TDM links (authorized full text from publishers) ────

async function tryCrossrefTDM(doi: string): Promise<FullTextResult | null> {
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
      message?: {
        abstract?: string;
        link?: Array<{
          URL: string;
          "content-type"?: string;
          "content-version"?: string;
          "intended-application"?: string;
        }>;
      };
    };

    // Try TDM links first — these are publisher-authorized full text URLs
    const links = data.message?.link ?? [];
    const tdmLinks = links.filter(l =>
      l["intended-application"] === "text-mining" ||
      l["content-type"]?.includes("xml") ||
      l["content-type"]?.includes("html") ||
      l["content-type"]?.includes("plain")
    );

    for (const tdm of tdmLinks.slice(0, 3)) {
      try {
        const tdmRes = await proxyFetch(tdm.URL, {
          headers: {
            "User-Agent": "ScholarFlow/1.0 (mailto:scholarflow@research.app)",
            Accept: tdm["content-type"] || "text/xml, text/html, text/plain",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!tdmRes.ok) continue;

        const contentType = tdmRes.headers.get("content-type") ?? "";
        const body = await tdmRes.text();

        if (contentType.includes("xml")) {
          const text = extractTextFromXml(body);
          if (text.length > 500) {
            console.log(`[fulltext] CrossRef TDM XML success for ${doi}`);
            return makeResult(text, "html_scrape");
          }
        } else if (contentType.includes("html")) {
          const text = extractTextFromHtml(body);
          if (text.length > 500) {
            console.log(`[fulltext] CrossRef TDM HTML success for ${doi}`);
            return makeResult(text, "html_scrape");
          }
        } else if (body.length > 500) {
          console.log(`[fulltext] CrossRef TDM text success for ${doi}`);
          return makeResult(body, "html_scrape");
        }
      } catch { continue; }
    }

    // Fallback to abstract
    const abstract = data.message?.abstract;
    if (!abstract || abstract.length < 100) return null;
    const cleaned = abstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return makeResult(cleaned, "html_scrape");
  } catch {
    return null;
  }
}

// ─── Springer Nature OpenAccess API ────────────

async function trySpringerOA(doi: string): Promise<FullTextResult | null> {
  // Only for Springer Nature DOIs (10.1007, 10.1038, 10.1186)
  if (!doi.startsWith("10.1007/") && !doi.startsWith("10.1038/") && !doi.startsWith("10.1186/")) {
    return null;
  }

  try {
    const { getEnv } = await import("@/lib/env");
    const apiKey = getEnv("SPRINGER_API_KEY");
    // Free API key from dev.springernature.com — no key = skip
    if (!apiKey) {
      // Try without key (limited access)
      const res = await proxyFetch(
        `https://api.springernature.com/openaccess/jats?q=doi:${encodeURIComponent(doi)}&p=1`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return null;
      const xml = await res.text();
      const text = extractTextFromXml(xml);
      if (text.length > 500) {
        console.log(`[fulltext] Springer OA success for ${doi}`);
        return makeResult(text, "html_scrape");
      }
      return null;
    }

    const res = await proxyFetch(
      `https://api.springernature.com/openaccess/jats?q=doi:${encodeURIComponent(doi)}&api_key=${apiKey}&p=1`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;

    const xml = await res.text();
    const text = extractTextFromXml(xml);
    if (text.length > 500) {
      console.log(`[fulltext] Springer OA success for ${doi}`);
      return makeResult(text, "html_scrape");
    }
    return null;
  } catch {
    return null;
  }
}

// ─── OpenAlex multiple OA locations ──────────────

async function tryOpenAlexOA(doi: string): Promise<FullTextResult | null> {
  try {
    const { getEnv } = await import("@/lib/env");
    const email = getEnv("OPENALEX_EMAIL");
    const params = new URLSearchParams({ filter: `doi:${doi}`, select: "open_access,best_oa_location,locations" });
    if (email) params.set("mailto", email);

    const res = await proxyFetch(`https://api.openalex.org/works?${params}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      results?: Array<{
        open_access?: { oa_url?: string };
        best_oa_location?: { pdf_url?: string; landing_page_url?: string };
        locations?: Array<{ pdf_url?: string; landing_page_url?: string; source?: { type?: string } }>;
      }>;
    };

    const work = data.results?.[0];
    if (!work) return null;

    // Try all OA locations (not just best)
    const urls: string[] = [];
    if (work.best_oa_location?.pdf_url) urls.push(work.best_oa_location.pdf_url);
    if (work.open_access?.oa_url) urls.push(work.open_access.oa_url);
    for (const loc of (work.locations ?? []).slice(0, 5)) {
      if (loc.pdf_url) urls.push(loc.pdf_url);
      if (loc.landing_page_url && loc.source?.type === "repository") urls.push(loc.landing_page_url);
    }

    // Deduplicate and try each
    const uniqueUrls = [...new Set(urls)];
    for (const url of uniqueUrls.slice(0, 4)) {
      const result = await tryHtmlVersion(url);
      if (result && result.text.length > 500) {
        console.log(`[fulltext] OpenAlex OA location success for ${doi}`);
        return result;
      }
    }
    return null;
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
  maxConcurrent: number = 20
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
