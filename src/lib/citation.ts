/**
 * Citation formatting — generates APA, MLA, Chicago, BibTeX from paper metadata.
 *
 * Uses citation-js for standard-compliant formatting.
 * Also provides a fast local APA formatter as fallback.
 */

export type CitationStyle = "apa" | "mla" | "chicago" | "bibtex" | "gb-t-7714";

interface PaperForCitation {
  title: string;
  authors: { name: string }[];
  year?: number;
  venue?: string;
  doi?: string;
  volume?: string;
  issue?: string;
  pages?: string;
}

/**
 * Format citation using citation-js (supports many styles).
 * Falls back to local formatter if citation-js fails.
 */
export async function formatCitation(
  paper: PaperForCitation,
  style: CitationStyle = "apa"
): Promise<string> {
  // Try citation-js for DOI-based formatting (most accurate)
  if (paper.doi) {
    try {
      const { Cite } = await import("@citation-js/core");
      await import("@citation-js/plugin-doi");
      await import("@citation-js/plugin-csl");

      const cite = await Cite.async(paper.doi);
      const template = styleToCSL(style);
      if (template) {
        const result = cite.format("bibliography", {
          format: "text",
          template,
          lang: "en-US",
        });
        if (result?.trim()) return result.trim();
      }

      // BibTeX
      if (style === "bibtex") {
        const result = cite.format("bibtex");
        if (result?.trim()) return result.trim();
      }
    } catch {
      // citation-js failed, use local formatter
    }
  }

  // Local fallback formatter
  return formatLocal(paper, style);
}

function styleToCSL(style: CitationStyle): string | null {
  switch (style) {
    case "apa":
      return "apa";
    case "mla":
      return "modern-language-association";
    case "chicago":
      return "chicago-author-date";
    case "gb-t-7714":
      return "chinese-gb7714-2005-numeric";
    default:
      return null;
  }
}

/**
 * Fast local APA/MLA/Chicago formatter (no external deps).
 */
function formatLocal(paper: PaperForCitation, style: CitationStyle): string {
  const authors = paper.authors ?? [];
  const year = paper.year ?? "n.d.";
  const title = paper.title;
  const journal = paper.venue ?? "";
  const doi = paper.doi ? `https://doi.org/${paper.doi}` : "";

  switch (style) {
    case "apa": {
      // APA 7th: Author, A. A., & Author, B. B. (Year). Title. Journal. DOI
      const authorStr = formatAuthorsAPA(authors);
      let citation = `${authorStr} (${year}). ${title}.`;
      if (journal) citation += ` *${journal}*.`;
      if (doi) citation += ` ${doi}`;
      return citation;
    }

    case "mla": {
      // MLA 9th: Author. "Title." Journal, Year. DOI.
      const authorStr = authors.length > 0 ? authors[0].name : "";
      const etAl = authors.length > 2 ? ", et al" : authors.length === 2 ? `, and ${authors[1].name}` : "";
      let citation = `${authorStr}${etAl}. "${title}."`;
      if (journal) citation += ` *${journal}*,`;
      citation += ` ${year}.`;
      if (doi) citation += ` ${doi}.`;
      return citation;
    }

    case "chicago": {
      // Chicago Author-Date: Author. Year. "Title." Journal.
      const authorStr = authors.length > 0 ? authors[0].name : "";
      const etAl = authors.length > 3 ? " et al." : "";
      let citation = `${authorStr}${etAl}. ${year}. "${title}."`;
      if (journal) citation += ` *${journal}*.`;
      if (doi) citation += ` ${doi}.`;
      return citation;
    }

    case "gb-t-7714": {
      // GB/T 7714: 作者. 题名[J]. 期刊, 年.
      const authorStr = authors.slice(0, 3).map((a) => a.name).join(", ");
      const etAl = authors.length > 3 ? ", 等" : "";
      let citation = `${authorStr}${etAl}. ${title}[J].`;
      if (journal) citation += ` ${journal},`;
      citation += ` ${year}.`;
      if (doi) citation += ` ${doi}.`;
      return citation;
    }

    case "bibtex": {
      const key = (authors[0]?.name?.split(" ").pop() ?? "unknown") + year;
      return `@article{${key},
  title = {${title}},
  author = {${authors.map((a) => a.name).join(" and ")}},
  journal = {${journal}},
  year = {${year}},${doi ? `\n  doi = {${paper.doi}},` : ""}
}`;
    }

    default:
      return `${authors.map((a) => a.name).join(", ")} (${year}). ${title}. ${journal}.`;
  }
}

function formatAuthorsAPA(authors: { name: string }[]): string {
  if (authors.length === 0) return "";

  const formatOne = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const lastName = parts[parts.length - 1];
    const initials = parts
      .slice(0, -1)
      .map((p) => p[0]?.toUpperCase() + ".")
      .join(" ");
    return `${lastName}, ${initials}`;
  };

  if (authors.length === 1) return formatOne(authors[0].name);
  if (authors.length === 2) {
    return `${formatOne(authors[0].name)}, & ${formatOne(authors[1].name)}`;
  }
  // 3+ authors: first author et al. in APA 7
  return `${formatOne(authors[0].name)}, et al.`;
}

/**
 * Batch format citations for multiple papers.
 */
export function batchFormatCitations(
  papers: PaperForCitation[],
  style: CitationStyle = "apa"
): Promise<string[]> {
  return Promise.all(papers.map((p) => formatCitation(p, style)));
}
