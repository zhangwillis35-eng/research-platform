export interface Author {
  name: string;
  authorId?: string;
}

export interface JournalBadges {
  ft50: boolean;
  utd24: boolean;
  abs4star: boolean;
  badges: string[]; // ["UTD24", "FT50", "ABS 4*"]
}

export interface JournalMeta {
  impactFactor?: number;
  hIndex?: number;
  sjrQuartile?: "Q1" | "Q2" | "Q3" | "Q4";
  ssci: boolean;
  sci: boolean;
  casZone?: "一区" | "二区" | "三区" | "四区";
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
  // Enhanced fields
  journalRanking?: JournalBadges;
  journalMeta?: JournalMeta;
  connectedPapersUrl?: string;
  unpaywallUrl?: string;
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
