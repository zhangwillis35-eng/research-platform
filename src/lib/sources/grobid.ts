/**
 * GROBID client — structured PDF parsing via ML.
 * GROBID extracts title, abstract, body sections, references from scientific PDFs.
 * Deployed as a Docker sidecar service.
 */

import { proxyFetch } from "@/lib/ai/proxy-fetch";

const GROBID_URL = process.env.GROBID_URL || "http://localhost:8070";

export interface GrobidResult {
  title?: string;
  abstract?: string;
  authors: string[]; // paper's own authors
  sections: Array<{ heading: string; text: string }>;
  references: Array<{ title: string; authors: string[]; year?: number; doi?: string }>;
  fullText: string; // concatenated body text
  wordCount: number;
}

/**
 * Check if GROBID service is available.
 */
export async function isGrobidAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${GROBID_URL}/api/isalive`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    console.log("[grobid] Service not available");
    return false;
  }
}

/**
 * Parse a PDF with GROBID into structured text.
 * @param pdfSource - URL string or PDF Buffer
 */
export async function parseWithGrobid(pdfSource: string | Buffer): Promise<GrobidResult | null> {
  try {
    // Step 1: Get PDF as ArrayBuffer
    let pdfArrayBuffer: ArrayBuffer;
    if (typeof pdfSource === "string") {
      console.log(`[grobid] Downloading PDF from: ${pdfSource.slice(0, 80)}`);
      const res = await proxyFetch(pdfSource, {
        headers: {
          "User-Agent": "ScholarFlow/1.0 (Academic Research Tool; mailto:scholarflow@research.app)",
          Accept: "application/pdf,*/*",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.log(`[grobid] PDF download failed: HTTP ${res.status}`);
        return null;
      }
      const contentType = res.headers.get("content-type") ?? "";
      // If the response is HTML (not PDF), skip
      if (contentType.includes("text/html")) {
        console.log("[grobid] Got HTML instead of PDF, skipping");
        return null;
      }
      pdfArrayBuffer = await res.arrayBuffer();
    } else {
      pdfArrayBuffer = pdfSource.buffer.slice(pdfSource.byteOffset, pdfSource.byteOffset + pdfSource.byteLength) as ArrayBuffer;
    }

    if (pdfArrayBuffer.byteLength < 1000) {
      console.log("[grobid] PDF too small, skipping");
      return null;
    }

    console.log(`[grobid] Sending ${(pdfArrayBuffer.byteLength / 1024).toFixed(0)}KB PDF to GROBID`);

    // Step 2: Send to GROBID via multipart/form-data
    const formData = new FormData();
    const blob = new Blob([pdfArrayBuffer], { type: "application/pdf" });
    formData.append("input", blob, "paper.pdf");

    const grobidRes = await fetch(`${GROBID_URL}/api/processFulltextDocument`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!grobidRes.ok) {
      console.log(`[grobid] Processing failed: HTTP ${grobidRes.status}`);
      return null;
    }

    const teiXml = await grobidRes.text();
    console.log(`[grobid] Got TEI XML: ${(teiXml.length / 1024).toFixed(0)}KB`);

    // Step 3: Parse TEI XML
    return parseTeiXml(teiXml);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    console.log(`[grobid] Error: ${msg.slice(0, 100)}`);
    return null;
  }
}

/**
 * Parse TEI XML from GROBID into structured result.
 */
function parseTeiXml(xml: string): GrobidResult {
  // Extract title
  const titleMatch = xml.match(/<title[^>]*type="main"[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]).trim() : undefined;

  // Extract abstract
  const abstractMatch = xml.match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/i);
  const abstract = abstractMatch ? stripTags(abstractMatch[1]).trim() : undefined;

  // Extract paper's own authors from teiHeader
  const authors: string[] = [];
  const headerMatch = xml.match(/<teiHeader[^>]*>([\s\S]*?)<\/teiHeader>/i);
  if (headerMatch) {
    const authorRegex = /<author[^>]*>([\s\S]*?)<\/author>/gi;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(headerMatch[1])) !== null) {
      const forename = authorMatch[1].match(/<forename[^>]*>([\s\S]*?)<\/forename>/i);
      const surname = authorMatch[1].match(/<surname[^>]*>([\s\S]*?)<\/surname>/i);
      const name = [forename?.[1], surname?.[1]].filter(Boolean).join(" ").trim();
      if (name) authors.push(stripTags(name));
    }
  }

  // Extract body sections
  const sections: Array<{ heading: string; text: string }> = [];
  const bodyMatch = xml.match(/<body>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    const bodyContent = bodyMatch[1];

    // Match <div> elements which represent sections
    const divRegex = /<div[^>]*>([\s\S]*?)<\/div>/gi;
    let divMatch;
    while ((divMatch = divRegex.exec(bodyContent)) !== null) {
      const divContent = divMatch[1];

      // Extract heading
      const headMatch = divContent.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
      const heading = headMatch ? stripTags(headMatch[1]).trim() : "";

      // Extract paragraphs
      const paragraphs: string[] = [];
      const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      let pMatch;
      while ((pMatch = pRegex.exec(divContent)) !== null) {
        const text = stripTags(pMatch[1]).trim();
        if (text.length > 0) {
          paragraphs.push(text);
        }
      }

      if (paragraphs.length > 0) {
        sections.push({
          heading,
          text: paragraphs.join("\n\n"),
        });
      }
    }
  }

  // Extract references
  const references: Array<{ title: string; authors: string[]; year?: number; doi?: string }> = [];
  const biblMatch = xml.match(/<listBibl>([\s\S]*?)<\/listBibl>/i);
  if (biblMatch) {
    const biblContent = biblMatch[1];
    const refRegex = /<biblStruct[^>]*>([\s\S]*?)<\/biblStruct>/gi;
    let refMatch;
    while ((refMatch = refRegex.exec(biblContent)) !== null) {
      const refContent = refMatch[1];

      // Reference title
      const refTitleMatch = refContent.match(/<title[^>]*level="a"[^>]*>([\s\S]*?)<\/title>/i)
        || refContent.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const refTitle = refTitleMatch ? stripTags(refTitleMatch[1]).trim() : "";

      // Authors
      const authors: string[] = [];
      const authorRegex = /<persName[^>]*>([\s\S]*?)<\/persName>/gi;
      let authorMatch;
      while ((authorMatch = authorRegex.exec(refContent)) !== null) {
        const forename = authorMatch[1].match(/<forename[^>]*>([\s\S]*?)<\/forename>/i);
        const surname = authorMatch[1].match(/<surname[^>]*>([\s\S]*?)<\/surname>/i);
        const name = [forename?.[1], surname?.[1]].filter(Boolean).join(" ").trim();
        if (name) authors.push(name);
      }

      // Year
      const yearMatch = refContent.match(/<date[^>]*when="(\d{4})/i);
      const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

      // DOI
      const doiMatch = refContent.match(/<idno[^>]*type="DOI"[^>]*>([\s\S]*?)<\/idno>/i);
      const doi = doiMatch ? stripTags(doiMatch[1]).trim() : undefined;

      if (refTitle) {
        references.push({ title: refTitle, authors, year, doi });
      }
    }
  }

  // Build full text
  const parts: string[] = [];
  if (title) parts.push(title);
  if (abstract) parts.push(`Abstract: ${abstract}`);
  for (const section of sections) {
    if (section.heading) parts.push(`\n${section.heading}`);
    parts.push(section.text);
  }
  const fullText = parts.join("\n\n");
  const wordCount = fullText.split(/\s+/).length;

  console.log(`[grobid] Parsed: ${sections.length} sections, ${references.length} refs, ${authors.length} authors, ${wordCount} words`);

  return {
    title,
    abstract,
    authors,
    sections,
    references,
    fullText,
    wordCount,
  };
}

/**
 * Strip XML/HTML tags from a string.
 */
function stripTags(text: string): string {
  return text
    .replace(/<ref[^>]*>[^<]*<\/ref>/gi, "") // remove inline references
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
