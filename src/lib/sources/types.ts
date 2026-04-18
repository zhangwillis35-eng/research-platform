export interface Author {
  name: string;
  authorId?: string;
}

export interface UnifiedPaper {
  title: string;
  abstract?: string;
  authors: Author[];
  year?: number;
  venue?: string;
  citationCount: number;
  referenceCount: number;
  doi?: string;
  externalId?: string;
  source: "semantic_scholar" | "openalex" | "google_scholar" | "manual";
  pdfUrl?: string;
  openAccessPdf?: string;
  fieldsOfStudy?: string[];
  rawMetadata?: Record<string, unknown>;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  yearFrom?: number;
  yearTo?: number;
  fieldsOfStudy?: string[];
  sources?: Array<UnifiedPaper["source"]>;
}

export interface SearchResult {
  papers: UnifiedPaper[];
  total: number;
  source: UnifiedPaper["source"];
}
