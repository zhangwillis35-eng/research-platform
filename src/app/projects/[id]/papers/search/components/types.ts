// Shared types, constants and pure helpers for the literature search page.
// Extracted verbatim from page.tsx — no logic changes.

export interface Author {
  name: string;
}

export interface JournalBadges {
  ft50: boolean;
  utd24: boolean;
  abs4star: boolean;
  badges: string[];
}

export interface JournalMeta {
  impactFactor?: number;
  sjrQuartile?: string;
  jcrQuartile?: string;
  absRating?: string;
  abdcRating?: string;
  ccfRating?: string;
  ssci: boolean;
  sci: boolean;
  cssci: boolean;
  pkuCore: boolean;
  fms: boolean;
  casZone?: string;
}

export interface Paper {
  title: string;
  abstract?: string;
  authors: Author[];
  year?: number;
  venue?: string;
  citationCount: number;
  doi?: string;
  source: string;
  openAccessPdf?: string;
  unpaywallUrl?: string;
  connectedPapersUrl?: string;
  journalRanking?: JournalBadges;
  journalMeta?: JournalMeta;
  relevanceScore?: number;
  relevanceReason?: string;
  relevanceKeyMatch?: string[];
  relevanceContribution?: string;
  relevanceMethodology?: string;
  relevanceInnovation?: string;
  relevanceDataSource?: string;
  hasFullText?: boolean;
}

export interface SearchMeta {
  total: number;
  sources: Array<{ source: string; count: number }>;
}

export interface SearchStats {
  total: number;
  totalBeforeFilter: number;
  totalBeforeRelevance: number;
  byQuery: Record<string, number>;
  durationMs: number;
  relevanceScored: boolean;
  withFullText?: number;
  withAbstractOnly?: number;
}

export type SortBy = "citations" | "year_desc" | "year_asc" | "relevance";

export interface SearchFilters {
  minABS?: string;
  minCASZone?: string;
  minJCR?: string;
  minCCF?: string;
  requireSSCI?: boolean;
  requireSCI?: boolean;
  requireCSSCI?: boolean;
  requirePKUCore?: boolean;
  requireFMS?: boolean;
  requireHighQuality?: boolean;
  minIF?: number;
  minCitations?: number;
  yearFrom?: number;
  yearTo?: number;
  requireUTD24?: boolean;
  requireFT50?: boolean;
}

export interface SearchPlan {
  translatedInput?: string;
  queryIntent?: "TOPICAL" | "RELATIONAL" | "METHODOLOGICAL" | "REVIEW";
  keyTerms: string[];
  synonyms: Record<string, string[]>;
  precisionQueries: string[];
  broadQueries: string[];
  filters: SearchFilters;
}

export interface SearchHistoryItem {
  id: string;
  query: string;
  translatedQuery?: string;
  keyTerms?: string[];
  paperCount: number;
  provider?: string;
  createdAt: string;
}

export interface SearchProgressStep {
  phase: string;
  message: string;
  done: boolean;
}

export interface AnalysisRecord {
  type: "variables" | "review" | "ideas";
  content: string;
  timestamp: string;
  paperCount: number;
}

export interface FullTextPanelState {
  paperIndex: number;
  loading: boolean;
  text?: string;
  source?: string;
  wordCount?: number;
  error?: string;
}

export const sourceLabels: Record<string, string> = {
  semantic_scholar: "Semantic Scholar",
  openalex: "OpenAlex",
  google_scholar: "Google Scholar",
};

export const sourceColors: Record<string, string> = {
  semantic_scholar: "bg-blue-100 text-blue-800",
  openalex: "bg-green-100 text-green-800",
  google_scholar: "bg-orange-100 text-orange-800",
};

export const rankingColors: Record<string, string> = {
  // Top-tier lists
  UTD24: "bg-red-600 text-white",
  FT50: "bg-amber-500 text-white",
  FMS: "bg-rose-500 text-white",
  // Indexing
  SSCI: "bg-blue-600 text-white",
  SCI: "bg-cyan-600 text-white",
  CSSCI: "bg-blue-500 text-white",
  "北大核心": "bg-blue-400 text-white",
  // JCR分区
  "JCR Q1": "bg-emerald-600 text-white",
  "JCR Q2": "bg-emerald-500 text-white",
  "JCR Q3": "bg-yellow-600 text-white",
  "JCR Q4": "bg-gray-400 text-white",
  // SJR分区
  "SJR Q1": "bg-teal-600 text-white",
  "SJR Q2": "bg-teal-500 text-white",
  "SJR Q3": "bg-yellow-500 text-white",
  "SJR Q4": "bg-gray-400 text-white",
  // ABS
  "ABS 4*": "bg-purple-700 text-white",
  "ABS 4": "bg-purple-600 text-white",
  "ABS 3": "bg-indigo-500 text-white",
  "ABS 2": "bg-sky-500 text-white",
  "ABS 1": "bg-slate-400 text-white",
  // ABDC
  "ABDC A*": "bg-violet-700 text-white",
  "ABDC A": "bg-violet-500 text-white",
  "ABDC B": "bg-violet-400 text-white",
  "ABDC C": "bg-violet-300 text-white",
  // CCF
  "CCF A": "bg-orange-600 text-white",
  "CCF B": "bg-orange-500 text-white",
  "CCF C": "bg-orange-400 text-white",
  // 中科院分区
  "中科院一区": "bg-red-700 text-white",
  "中科院二区": "bg-orange-600 text-white",
  "中科院三区": "bg-sky-600 text-white",
  "中科院四区": "bg-gray-400 text-white",
  // Conferences
  "Top会议": "bg-rose-600 text-white",
  "A会议": "bg-pink-500 text-white",
  "B会议": "bg-pink-400 text-white",
  // Preprints
  "预印本": "bg-gray-500 text-white",
};

// ─── Variable Relation Visualization ─────────────────────────
export interface VariableRelation {
  independentVar: string;
  dependentVar: string;
  mediators?: string[];
  moderators?: string[];
  direction?: string;
  effectSize?: string;
  sampleContext?: string;
  sources?: number[];
}

export const directionColors: Record<string, string> = {
  positive: "text-emerald-600 bg-emerald-50 border-emerald-200",
  negative: "text-red-600 bg-red-50 border-red-200",
  mixed: "text-amber-600 bg-amber-50 border-amber-200",
  nonsignificant: "text-gray-500 bg-gray-50 border-gray-200",
};

export const directionLabels: Record<string, string> = {
  positive: "正向",
  negative: "负向",
  mixed: "混合",
  nonsignificant: "不显著",
};

export function sortPapers(papers: Paper[], sortBy: SortBy): Paper[] {
  const sorted = [...papers];
  switch (sortBy) {
    case "citations":
      return sorted.sort((a, b) => b.citationCount - a.citationCount);
    case "year_desc":
      return sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    case "year_asc":
      return sorted.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
    case "relevance":
    default:
      return sorted.sort(
        (a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)
      );
  }
}

export function getRelevanceColor(score: number): string {
  if (score >= 8) return "text-emerald-600 bg-emerald-50 border-emerald-200";
  if (score >= 6) return "text-blue-600 bg-blue-50 border-blue-200";
  if (score >= 4) return "text-amber-600 bg-amber-50 border-amber-200";
  return "text-gray-500 bg-gray-50 border-gray-200";
}

export function getRelevanceLabel(score: number): string {
  if (score >= 9) return "完全匹配";
  if (score >= 7) return "高度相关";
  if (score >= 5) return "一般相关";
  if (score >= 3) return "边缘相关";
  return "不相关";
}
